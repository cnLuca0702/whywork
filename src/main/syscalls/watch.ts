import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { register, type SysContext } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
interface WatchFolder {id:string;dir:string;enabled:number;status:string}
const watchers=new Map<string,fs.FSWatcher>(), paused=new Set<string>()
const timers=new Map<string,ReturnType<typeof setTimeout>>()
const running=new Map<string,Promise<number>>()
let generation=0
function ensureTable():void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS watch_folders(id TEXT PRIMARY KEY,dir TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1,status TEXT DEFAULT '未扫描');
    CREATE TABLE IF NOT EXISTS watch_items(folder_id TEXT NOT NULL,file TEXT NOT NULL,hash TEXT NOT NULL,note_ids TEXT NOT NULL,PRIMARY KEY(folder_id,file));`)
}
function rows():WatchFolder[]{ensureTable();return getDb().prepare('SELECT * FROM watch_folders ORDER BY dir').all() as WatchFolder[]}
function stopWatcher(id:string):void {
  watchers.get(id)?.close();watchers.delete(id)
  const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id)
}
export function closeWatchers():void {
  generation++;for(const id of watchers.keys())stopWatcher(id);paused.clear()
}
export async function scanNow(id:string,ctx:Pick<SysContext,'emit'>):Promise<number> {
  const existing=running.get(id);if(existing)return existing
  const work=scan(id,ctx);running.set(id,work)
  try{return await work}finally{if(running.get(id)===work)running.delete(id)}
}
async function scan(id:string,ctx:Pick<SysContext,'emit'>):Promise<number> {
  const row=rows().find(r=>r.id===id);if(!row)throw new Error('监控目录不存在')
  if(paused.has(id))return 0
  const epoch=generation,ws=getWorkspacePath()
  const {collectImportable,importFile,relinkLocalImages,validateEmbeddedImages}=await import('../services/importer')
  const {createNote,updateNoteBody,getNote}=await import('../db/repos/notes')
  let imported=0,failed=0
  for(const file of collectImportable(row.dir)) {
    await new Promise<void>(resolve=>setImmediate(resolve))
    if(paused.has(id)||epoch!==generation||!rows().some(r=>r.id===id))break
    try {
      const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      const previous=getDb().prepare('SELECT hash,note_ids FROM watch_items WHERE folder_id=? AND file=?').get(id,file) as {hash:string;note_ids:string}|undefined
      const previousIds=previous?JSON.parse(previous.note_ids) as string[]:[]
      if(previous?.hash===hash && previousIds.every(n=>getNote(n)?.deleted_at===null))continue
      const results=await importFile(file)
      if(paused.has(id)||epoch!==generation||!rows().some(r=>r.id===id))break
      const ids:string[]=[]
      for(const [index,r] of results.entries()) {
        validateEmbeddedImages(r.markdown)
        const old=previousIds[index]?getNote(previousIds[index]!):undefined
        const note=old&&!old.deleted_at?old:createNote({title:r.title,body:r.markdown,source:r.source})
        const resourceDir=path.join('resources',note.note_id)
        const body=relinkLocalImages(r.markdown,note.note_id,r.baseDir,ws,resourceDir)
        updateNoteBody(note.note_id,{title:r.title,body:`${body}\n\n<!-- source-path: ${path.relative(ws,file)} -->`})
        getDb().prepare('UPDATE notes SET resource_dir=? WHERE note_id=?').run(resourceDir,note.note_id)
        ids.push(note.note_id);imported++
      }
      getDb().prepare('INSERT INTO watch_items(folder_id,file,hash,note_ids) VALUES(?,?,?,?) ON CONFLICT(folder_id,file) DO UPDATE SET hash=excluded.hash,note_ids=excluded.note_ids').run(id,file,hash,JSON.stringify(ids))
    }catch(e){failed++;ctx.emit('watch.item_failed',{id,file:path.basename(file),error:e instanceof Error?e.message:String(e)})}
  }
  if(epoch===generation)getDb().prepare('UPDATE watch_folders SET status=? WHERE id=?').run(paused.has(id)?'已暂停':`监控中（本次 ${imported}，失败 ${failed}）`,id)
  if(imported)ctx.emit('notes.changed',{kind:'watch',imported})
  return imported
}
function startWatcher(id:string,ctx:Pick<SysContext,'emit'>):void {
  const row=rows().find(r=>r.id===id);if(!row)return
  stopWatcher(id)
  try {
    watchers.set(id,fs.watch(row.dir,{recursive:true},()=>{
      if(paused.has(id))return
      const prev=timers.get(id);if(prev)clearTimeout(prev)
      timers.set(id,setTimeout(()=>{
        timers.delete(id)
        void scanNow(id,ctx).catch(e=>ctx.emit('watch.error',{id,error:String(e)}))
      },800))
    }))
    getDb().prepare('UPDATE watch_folders SET status=? WHERE id=?').run('监控中',id)
  }catch(e){getDb().prepare('UPDATE watch_folders SET status=? WHERE id=?').run(`监控失败：${String(e)}`,id)}
}
export function restoreWatchers(ctx:Pick<SysContext,'emit'>):void {
  for(const row of rows()) {
    if(!row.enabled){paused.add(row.id);continue}
    paused.delete(row.id);startWatcher(row.id,ctx)
    void scanNow(row.id,ctx).catch(e=>ctx.emit('watch.error',{id:row.id,error:String(e)}))
  }
}
export function registerWatchDomain():void {
  register('watch',{
    folders_list:{handler:async()=>({items:rows().map(r=>({...r,enabled:!!r.enabled}))})},
    folders_add:{schema:z.object({dir:z.string().min(1)}),handler:async(p:{dir:string},ctx)=>{
      ensureTable();const dir=fs.realpathSync(p.dir)
      if(!fs.statSync(dir).isDirectory())throw new Error('目录不存在')
      const ws=fs.realpathSync(getWorkspacePath())
      if(dir===ws||dir.startsWith(ws+path.sep)||ws.startsWith(dir+path.sep))throw new Error('不能监控包含工作区的目录或工作区内部目录')
      const old=rows().find(r=>r.dir===dir),id=old?.id??crypto.randomUUID()
      getDb().prepare('INSERT OR IGNORE INTO watch_folders(id,dir) VALUES(?,?)').run(id,dir)
      getDb().prepare('UPDATE watch_folders SET enabled=1 WHERE id=?').run(id);paused.delete(id)
      startWatcher(id,ctx);return{id}
    }},
    folders_remove:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{
      stopWatcher(p.id);paused.add(p.id)
      const task=running.get(p.id);if(task)await task
      getDb().prepare('DELETE FROM watch_items WHERE folder_id=?').run(p.id)
      getDb().prepare('DELETE FROM watch_folders WHERE id=?').run(p.id);paused.delete(p.id);return{ok:true}
    }},
    pause:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{paused.add(p.id);stopWatcher(p.id);getDb().prepare('UPDATE watch_folders SET enabled=0,status=? WHERE id=?').run('已暂停',p.id);return{ok:true}}},
    resume:{schema:z.object({id:z.string()}),handler:async(p:{id:string},ctx)=>{paused.delete(p.id);getDb().prepare('UPDATE watch_folders SET enabled=1 WHERE id=?').run(p.id);startWatcher(p.id,ctx);return{ok:true,imported:await scanNow(p.id,ctx)}}},
    scan_now:{schema:z.object({id:z.string()}),handler:async(p:{id:string},ctx)=>({imported:await scanNow(p.id,ctx)})}
  })
}
