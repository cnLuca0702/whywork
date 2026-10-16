import os from 'node:os'
import {app} from 'electron'
import {watchConflict,watchError} from '../services/watch-paths'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { register, type SysContext } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
interface WatchFolder {id:string;dir:string;enabled:number;status:string;state:string;imported:number;failed:number;last_scan_at:number|null}
const watchers=new Map<string,fs.FSWatcher>(), paused=new Set<string>()
const timers=new Map<string,ReturnType<typeof setTimeout>>()
const running=new Map<string,Promise<number>>()
let generation=0
function ensureTable():void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS watch_folders(id TEXT PRIMARY KEY,dir TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1,status TEXT DEFAULT '未扫描');
    CREATE TABLE IF NOT EXISTS watch_items(folder_id TEXT NOT NULL,file TEXT NOT NULL,hash TEXT NOT NULL,note_ids TEXT NOT NULL,PRIMARY KEY(folder_id,file));`)
  const columns=new Set((getDb().prepare('PRAGMA table_info(watch_folders)').all() as {name:string}[]).map(c=>c.name))
  for(const [name,type] of Object.entries({state:"TEXT DEFAULT 'watching'",imported:'INTEGER DEFAULT 0',failed:'INTEGER DEFAULT 0',last_scan_at:'INTEGER'}))if(!columns.has(name))getDb().exec(`ALTER TABLE watch_folders ADD COLUMN ${name} ${type}`)
}
function state(id:string,value:string,status:string,ctx?:Pick<SysContext,'emit'>){getDb().prepare('UPDATE watch_folders SET state=?,status=? WHERE id=?').run(value,status,id);ctx?.emit('watch.changed',{id,state:value,status})}
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
  try{return await work}catch(e){state(id,'error',watchError(e),ctx);throw e}finally{if(running.get(id)===work)running.delete(id)}
}
async function scan(id:string,ctx:Pick<SysContext,'emit'>):Promise<number> {
  const row=rows().find(r=>r.id===id);if(!row)throw new Error('监控目录不存在')
  if(paused.has(id))return 0
  const epoch=generation,ws=getWorkspacePath()
  const {collectImportable,importFile,relinkLocalImages,validateEmbeddedImages}=await import('../services/importer')
  const {createNote,updateNoteBody,getNote}=await import('../db/repos/notes')
  let imported=0,failed=0
  state(id,'scanning','扫描中',ctx)
  fs.readdirSync(row.dir)
  const files=collectImportable(row.dir)
  state(id,'importing','导入中',ctx)
  for(const file of files) {
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
              if(r.scannedPdf){const {attachScannedPdf}=await import('../services/ocr-index');attachScannedPdf(note.note_id,r.scannedPdf)}
        ids.push(note.note_id);imported++
      }
      getDb().prepare('INSERT INTO watch_items(folder_id,file,hash,note_ids) VALUES(?,?,?,?) ON CONFLICT(folder_id,file) DO UPDATE SET hash=excluded.hash,note_ids=excluded.note_ids').run(id,file,hash,JSON.stringify(ids))
    }catch(e){failed++;ctx.emit('watch.item_failed',{id,file:path.basename(file),error:watchError(e)})}
  }
  if(epoch===generation){getDb().prepare('UPDATE watch_folders SET imported=?,failed=?,last_scan_at=? WHERE id=?').run(imported,failed,Date.now(),id);state(id,paused.has(id)?'paused':failed?'error':'watching',paused.has(id)?'已暂停':`监控中（本次 ${imported}，失败 ${failed}）`,ctx)}
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
    state(id,'watching','监控中',ctx)
  }catch(e){state(id,'error',watchError(e),ctx)}
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
    suggested_folders:{handler:async()=>({items:(['downloads','documents','desktop'] as const).map(kind=>({kind,dir:app.getPath(kind)})).filter(r=>fs.existsSync(r.dir)&&fs.statSync(r.dir).isDirectory())})},
    folders_add:{schema:z.object({dir:z.string().min(1),confirmMerge:z.boolean().default(false)}),handler:async(p:{dir:string;confirmMerge:boolean},ctx)=>{
      ensureTable();const {dir,children}=watchConflict(p.dir,getWorkspacePath(),os.homedir(),rows())
      if(children.length&&!p.confirmMerge)return {needsConfirm:{dir,children}}
      const id=crypto.randomUUID()
      for(const child of children){paused.add(child.id);stopWatcher(child.id);const task=running.get(child.id);if(task)await task}
      getDb().transaction(()=>{
        getDb().prepare('INSERT INTO watch_folders(id,dir) VALUES(?,?)').run(id,dir)
        for(const child of children){
          getDb().prepare('INSERT OR IGNORE INTO watch_items(folder_id,file,hash,note_ids) SELECT ?,file,hash,note_ids FROM watch_items WHERE folder_id=?').run(id,child.id)
          getDb().prepare('DELETE FROM watch_items WHERE folder_id=?').run(child.id)
          getDb().prepare('DELETE FROM watch_folders WHERE id=?').run(child.id);paused.delete(child.id)
        }
      })();startWatcher(id,ctx);return{id}
    }},
    folders_remove:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{
      stopWatcher(p.id);paused.add(p.id)
      const task=running.get(p.id);if(task)await task
      getDb().prepare('DELETE FROM watch_items WHERE folder_id=?').run(p.id)
      getDb().prepare('DELETE FROM watch_folders WHERE id=?').run(p.id);paused.delete(p.id);return{ok:true}
    }},
    pause:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{paused.add(p.id);stopWatcher(p.id);getDb().prepare("UPDATE watch_folders SET enabled=0,state='paused',status=? WHERE id=?").run('已暂停',p.id);return{ok:true}}},
    resume:{schema:z.object({id:z.string()}),handler:async(p:{id:string},ctx)=>{paused.delete(p.id);getDb().prepare('UPDATE watch_folders SET enabled=1 WHERE id=?').run(p.id);startWatcher(p.id,ctx);return{ok:true,imported:await scanNow(p.id,ctx)}}},
    scan_now:{schema:z.object({id:z.string()}),handler:async(p:{id:string},ctx)=>({imported:await scanNow(p.id,ctx)})}
  })
}
