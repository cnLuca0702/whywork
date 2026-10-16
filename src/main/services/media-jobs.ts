import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
import {getDb} from '../db/client'
import {getWorkspacePath} from '../syscalls/app'
import {getSetting} from '../syscalls/settings'
import {resolveWorkspacePath} from '../security/paths'
import {createNote,getNote,updateNoteBody} from '../db/repos/notes'
import {backgroundText} from '../providers/background'
import {transcribeAudio} from '../syscalls/media'
import type {SysContext} from '../syscalls/registry'
interface Job {id:string;url:string;state:string;error:string|null;note_id:string|null;transcript_id:string|null;overview_id:string|null;created_at:number;updated_at:number}
const initialized=new WeakSet<object>()
function tables(){const db=getDb();if(initialized.has(db))return
 db.exec('CREATE TABLE IF NOT EXISTS media_jobs(id TEXT PRIMARY KEY,url TEXT NOT NULL,state TEXT NOT NULL,error TEXT,note_id TEXT,transcript_id TEXT,overview_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)')
 db.prepare("UPDATE media_jobs SET state='failed',error=?,updated_at=? WHERE state NOT IN ('done','failed','cancelled')").run('上次任务已中断，可手动重试',Date.now());initialized.add(db)
}
function downloader(){const file=getSetting('media.downloaderPath');if(!file||!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error('请在设置 → 媒体中指定已安装的 yt-dlp 下载器可执行文件路径');fs.accessSync(file,fs.constants.X_OK);return file}
export function parseSubtitles(raw:string){return raw.split(/\r?\n/).filter(line=>line.trim()&&!/^WEBVTT|^NOTE|^Kind:|^Language:|^\d+$|-->/.test(line)).map(line=>line.replace(/<[^>]+>/g,'').replaceAll('&amp;','&').trim()).filter((line,i,all)=>line&&line!==all[i-1]).join('\n')}
export function runDownloader(executable:string,args:string[],signal:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],shell:false,signal});let stdout='',stderr='',settled=false
  const done=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(stdout)}
  const timer=setTimeout(()=>{child.kill('SIGKILL');done(new Error('下载器超时'))},300000)
  child.stdout.on('data',chunk=>{stdout+=String(chunk);if(stdout.length>10000000){child.kill('SIGKILL');done(new Error('下载器输出过大'))}})
  child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000)})
  child.on('error',error=>done(error));child.on('exit',code=>done(code===0?undefined:new Error(`下载器失败（${code}）：${stderr}`)))
 })
}
const pending:{id:string;workspace:string;ctx:SysContext}[]=[],controllers=new Map<string,AbortController>();let draining=false
function row(id:string){return getDb().prepare('SELECT * FROM media_jobs WHERE id=?').get(id) as Job|undefined}
function update(id:string,state:string,ctx:SysContext,error:string|null=null){getDb().prepare('UPDATE media_jobs SET state=?,error=?,updated_at=? WHERE id=?').run(state,error,Date.now(),id);ctx.emit('media.job',row(id))}
export function mediaJobs(){tables();return {items:getDb().prepare('SELECT * FROM media_jobs ORDER BY created_at DESC LIMIT 200').all()}}
export function addMediaUrls(urls:string[],ctx:SysContext){
 downloader();tables();const workspace=getWorkspacePath(),ids:string[]=[]
 getDb().transaction(()=>{for(const raw of urls){const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持无登录凭据的HTTP(S)链接');const id=crypto.randomUUID();getDb().prepare('INSERT INTO media_jobs(id,url,state,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,url.href,'waiting',Date.now(),Date.now());ids.push(id)}})()
 for(const id of ids){pending.push({id,workspace,ctx});ctx.emit('media.job',row(id))}setImmediate(()=>void drain());return {jobIds:ids}
}
export function cancelMediaJob(id:string,ctx:SysContext){tables();if(!row(id))throw new Error('任务不存在');controllers.get(getWorkspacePath()+'\0'+id)?.abort();update(id,'cancelled',ctx);return {ok:true}}
export function retryMediaJob(id:string,ctx:SysContext){if(controllers.has(getWorkspacePath()+'\0'+id))throw new Error('任务仍在停止，请稍后重试');downloader();tables();const job=row(id);if(!job||!['failed','cancelled'].includes(job.state))throw new Error('只能重试失败或已取消的任务');update(id,'waiting',ctx);pending.push({id,workspace:getWorkspacePath(),ctx});setImmediate(()=>void drain());return {ok:true}}
async function drain(){if(draining)return;draining=true;try{while(pending.length){const task=pending.shift()!;if(task.workspace!==getWorkspacePath()||row(task.id)?.state!=='waiting')continue;await execute(task)}}finally{draining=false}}
async function execute({id,workspace,ctx}:{id:string;workspace:string;ctx:SysContext}){
 const ac=new AbortController(),key=workspace+'\0'+id;controllers.set(key,ac)
 const guard=()=>{ac.signal.throwIfAborted();if(getWorkspacePath()!==workspace)throw new Error('工作区已切换')}
 try{
  const job=row(id)!,bin=downloader(),rel=`resources/media-jobs/${id}`,dir=resolveWorkspacePath(rel);fs.mkdirSync(dir,{recursive:true})
  update(id,'parsing',ctx)
  const common=['--ignore-config','--no-playlist','--playlist-items','1','--no-progress','--max-filesize','50M','--socket-timeout','30','--restrict-filenames']
  const metadata=await runDownloader(bin,[...common,'--skip-download','--write-subs','--write-auto-subs','--sub-langs','zh.*,en.*','--sub-format','vtt','--dump-single-json','-o',path.join(dir,'source.%(ext)s'),'--',job.url],ac.signal);guard()
  const info=JSON.parse(metadata.trim().split('\n').filter(Boolean).at(-1)??'{}') as {title?:string;playlist_title?:string;playlist_count?:number;entries?:{title?:string}[]}
  const title=info.title??info.entries?.[0]?.title??job.url,notice=info.playlist_title?`\n这是合集《${info.playlist_title}》，共${info.playlist_count??'未知'}集，本次只处理一集。`:''
  if(!job.note_id||getNote(job.note_id)?.deleted_at!==null){job.note_id=createNote({title,body:`来源：${job.url}${notice}`,source:'video'}).note_id;getDb().prepare('UPDATE media_jobs SET note_id=? WHERE id=?').run(job.note_id,id)}
  const subtitles=fs.readdirSync(dir).find(f=>f.endsWith('.vtt'));let text=''
  if(subtitles)text=parseSubtitles(fs.readFileSync(resolveWorkspacePath(path.join(rel,subtitles)),'utf8'))
  if(!text){
   update(id,'downloading',ctx);await runDownloader(bin,[...common,'-f','bestaudio','-o',path.join(dir,'source.%(ext)s'),'--',job.url],ac.signal);guard()
   const file=fs.readdirSync(dir).find(f=>/^source\.(webm|m4a|mp3|ogg|wav|flac|mp4)$/.test(f));if(!file)throw new Error('下载器未产出支持的音频')
   const audio=resolveWorkspacePath(path.join(rel,file));if(fs.statSync(audio).size>50*1024*1024)throw new Error('音频超过50MB，请提交更短内容')
   update(id,'transcribing',ctx);text=(await transcribeAudio(audio,undefined,ac.signal)).text;guard()
  }
  if(!text.trim())throw new Error('未取得字幕或转写文本')
  update(id,'transcribing',ctx)
  if(!job.transcript_id||getNote(job.transcript_id)?.deleted_at!==null){job.transcript_id=createNote({title:`转写-${title}`,body:text,source:'meeting_transcript'}).note_id;getDb().prepare('UPDATE media_jobs SET transcript_id=? WHERE id=?').run(job.transcript_id,id)}
  ctx.emit('notes.changed',{kind:'media',noteIds:[job.note_id,job.transcript_id]});update(id,'minutes',ctx)
  const overview=await backgroundText('根据字幕生成概览、关键结论和待办；不编造没有出现的信息。',text.slice(0,48000),AbortSignal.any([ac.signal,AbortSignal.timeout(180000)]));guard()
  if(!job.overview_id||getNote(job.overview_id)?.deleted_at!==null){job.overview_id=createNote({title:`概览-${title}`,body:overview,source:'meeting_overview'}).note_id;getDb().prepare('UPDATE media_jobs SET overview_id=? WHERE id=?').run(job.overview_id,id)}else updateNoteBody(job.overview_id,{body:overview})
  const ids=[job.note_id,job.transcript_id,job.overview_id] as string[]
  for(const source of ids)for(const target of ids)if(source!==target)getDb().prepare('INSERT OR IGNORE INTO links(id,source_note_id,target_note_id,target_text,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),source,target,getNote(target)!.title,Date.now())
  update(id,'done',ctx);ctx.emit('notes.changed',{kind:'media',noteIds:ids})
 }catch(e){if(getWorkspacePath()===workspace)update(id,ac.signal.aborted?'cancelled':'failed',ctx,e instanceof Error?e.message:String(e))}finally{controllers.delete(key)}
}
