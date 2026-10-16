import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {getDb} from '../db/client'
import {getNote,upsertFts} from '../db/repos/notes'
import {getWorkspacePath} from '../syscalls/app'
import {getSetting} from '../syscalls/settings'
import {resolveWorkspacePath} from '../security/paths'
import {ocrImage} from '../syscalls/media'
import {loadPdfJs} from './importer'
interface Task {workspace:string;resourceId:string;noteId:string;path:string;mime:string}
const queue:Task[]=[],states=new Map<string,{state:string;done:number;total:number;error?:string}>();let running=false
const key=(task:Task)=>task.workspace+'\0'+task.resourceId
function available(){return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE name='resource_ocr'").get()}
export function ocrImages(noteId:string){if(!available())return [];return getDb().prepare('SELECT r.resource_id AS resourceId,coalesce(o.text,\'\') AS ocrText FROM resources r LEFT JOIN resource_ocr o ON o.resource_id=r.resource_id WHERE r.note_id=? AND (r.mime LIKE \'image/%\' OR r.mime=\'application/pdf\')').all(noteId) as {resourceId:string;ocrText:string}[]}
export function ocrStatus(noteId:string){const workspace=getWorkspacePath();const images=ocrImages(noteId);return {items:images.map(r=>({resourceId:r.resourceId,...(states.get(workspace+'\0'+r.resourceId)??{state:r.ocrText?'done':'pending',done:0,total:0})}))}}
export function syncImageResources(noteId:string,body:string){
 if(!available()||getNote(noteId)?.deleted_at!==null)return
 const db=getDb(),paths=new Set<string>()
 for(const m of body.matchAll(/!\[[^\]]*\]\(whywork-res:\/\/([^\s)]+)\)/g)){
  try{const rel=decodeURIComponent(m[1]!);if(!/\.(png|jpe?g|webp|gif|bmp)$/i.test(rel))continue;const abs=resolveWorkspacePath(rel);if(!fs.statSync(abs).isFile())continue;paths.add(rel)
   const old=db.prepare('SELECT resource_id FROM resources WHERE note_id=? AND relative_path=?').get(noteId,rel)
   if(!old)db.prepare('INSERT INTO resources(resource_id,note_id,relative_path,mime,size,created_at,ocr_managed) VALUES(?,?,?,?,?,?,1)').run(crypto.randomUUID(),noteId,rel,'image/'+path.extname(rel).slice(1),fs.statSync(abs).size,Date.now())
   else db.prepare('UPDATE resources SET ocr_managed=1 WHERE note_id=? AND relative_path=?').run(noteId,rel)
  }catch{/* missing/outside resource stays unindexed */}
 }
 for(const r of db.prepare('SELECT resource_id,relative_path FROM resources WHERE note_id=? AND ocr_managed=1').all(noteId) as {resource_id:string;relative_path:string}[]){if(!paths.has(r.relative_path))db.prepare('DELETE FROM resources WHERE resource_id=?').run(r.resource_id)}
 enqueueResources(noteId)
}
export function enqueueResources(noteId:string){
 if(!available()||getSetting('media.ocrEnabled')==='false')return
 for(const r of getDb().prepare("SELECT r.resource_id,r.relative_path,r.mime FROM resources r LEFT JOIN resource_ocr o ON o.resource_id=r.resource_id WHERE r.note_id=? AND o.resource_id IS NULL AND (r.mime LIKE 'image/%' OR r.mime='application/pdf')").all(noteId) as {resource_id:string;relative_path:string;mime:string}[]){
  const task={workspace:getWorkspacePath(),noteId,resourceId:r.resource_id,path:r.relative_path,mime:r.mime}
  if(states.has(key(task)))continue;states.set(key(task),{state:'queued',done:0,total:1});queue.push(task)
 }
 if(!running)setImmediate(()=>void drain())
}
export function attachScannedPdf(noteId:string,input:string){
 const rel=`resources/${noteId}/source.pdf`,abs=resolveWorkspacePath(rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.copyFileSync(input,abs)
 getDb().prepare('INSERT INTO resources(resource_id,note_id,relative_path,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),noteId,rel,'application/pdf',fs.statSync(abs).size,Date.now());enqueueResources(noteId)
}
async function drain(){
 if(running)return;running=true
 try{while(queue.length){
  const task=queue.shift()!,state=states.get(key(task))!
  if(getWorkspacePath()!==task.workspace||getSetting('media.ocrEnabled')==='false'){states.delete(key(task));continue}
  const exists=()=>getWorkspacePath()===task.workspace&&getNote(task.noteId)?.deleted_at===null&&!!getDb().prepare('SELECT 1 FROM resources WHERE resource_id=?').get(task.resourceId)
  if(!exists()){states.delete(key(task));continue}
  state.state='running'
  try{
   const input=resolveWorkspacePath(task.path);let text='',engine='tesseract.js',items:{page:number;text:string}[]=[]
   if(task.mime==='application/pdf'){
    const pdfjs=await loadPdfJs(),{createCanvas}=await import('@napi-rs/canvas'),pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(input))}).promise
    try{if(pdf.numPages>200)throw new Error('扫描PDF超过200页，请拆分后导入');state.total=pdf.numPages
     for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
      if(!exists()||getSetting('media.ocrEnabled')==='false')throw new Error('OCR已停止')
      const page=await pdf.getPage(pageNo),base=page.getViewport({scale:1})
      // Avoid enlarging a single scanned image beyond its native resolution:
      // interpolated glyph edges can reduce OCR accuracy, especially for digits.
      let scale=Math.min(2,Math.sqrt(12000000/(base.width*base.height)))
      const ops=await page.getOperatorList(),images=ops.fnArray.flatMap((fn,i)=>fn===pdfjs.OPS.paintImageXObject?[ops.argsArray[i]]:[])
      if(images.length===1){try{const img=page.objs.get(images[0]![0]) as {width:number;height:number};if(img.width>0&&img.height>0)scale=Math.min(scale,Math.max(img.width/base.width,img.height/base.height))}catch{/* retain bounded render scale */}}
      const viewport=page.getViewport({scale}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
      await page.render({canvasContext:canvas.getContext('2d') as never,canvas:canvas as never,viewport}).promise
      const tmp=resolveWorkspacePath('.whywork/tmp/ocr-'+crypto.randomUUID()+'.png',true);fs.mkdirSync(path.dirname(tmp),{recursive:true});fs.writeFileSync(tmp,canvas.toBuffer('image/png'))
      try{const result=await ocrImage(tmp);items.push({page:pageNo,text:result.text});engine=result.engine;state.done=pageNo}finally{fs.rmSync(tmp,{force:true});page.cleanup()}
     }
     text=items.map(i=>`第${i.page}页\n${i.text}`).join('\n')
    }finally{await pdf.cleanup()}
   }else{const result=await ocrImage(input);text=result.text;engine=result.engine;state.done=1}
   if(!exists()||getSetting('media.ocrEnabled')==='false')continue
   getDb().prepare('INSERT OR REPLACE INTO resource_ocr(resource_id,text,items,engine,created_at) VALUES(?,?,?,?,?)').run(task.resourceId,text,JSON.stringify(items),engine,Date.now());state.state='done';upsertFts(task.noteId)
  }catch(e){state.state='error';state.error=e instanceof Error?e.message:String(e)}
 }}finally{running=false}
}
