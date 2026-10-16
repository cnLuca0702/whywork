import crypto from 'node:crypto'
import {getWorkspacePath} from '../syscalls/app'
import {getDb} from '../db/client'
import {getNote,upsertFts,listNotes,searchNotes} from '../db/repos/notes'
import {parseFrontmatter,readNoteFile,sha256} from '../db/notes-file'
import {backgroundText,backgroundModel} from '../providers/background'
import type {SysContext} from '../syscalls/registry'
import {z} from 'zod'
import {searchLocalNotes} from '../syscalls/search'
const active=new Map<string,AbortController>()
const batches=new Map<string,{controller:AbortController;workspace:string}>()
const resultSchema=z.object({summary:z.string().min(1).max(2000),keywords:z.array(z.string().max(100)).max(30),topic:z.string().max(200)})
export async function summarize(noteId:string,ctx:SysContext,signal?:AbortSignal){
 const workspace=getWorkspacePath(),key=workspace+'\0'+noteId
 if(active.has(key))throw new Error('这篇笔记正在生成摘要')
 const note=getNote(noteId);if(!note||note.deleted_at!==null)throw new Error('笔记不存在或已删除')
 const raw=readNoteFile(note.relative_path),hash=sha256(raw),controller=new AbortController()
 active.set(key,controller)
 try{
  const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(90_000),...(signal?[signal]:[])])
  const output=await backgroundText('为笔记生成摘要，只输出 JSON：{"summary":"120字内摘要","keywords":["关键词"],"topic":"主题"}',`# ${note.title}\n\n${parseFrontmatter(raw).body.slice(0,12000)}`,combined)
  combined.throwIfAborted()
  if(getWorkspacePath()!==workspace)throw new Error('工作区已切换，摘要未写入')
  const current=getNote(noteId)
  if(!current||current.deleted_at!==null||current.relative_path!==note.relative_path||sha256(readNoteFile(current.relative_path))!==hash)throw new Error('笔记已变化，请重新生成摘要')
  const match=/\{[\s\S]*\}/.exec(output);if(!match)throw new Error('模型输出无法解析')
  const parsed=resultSchema.parse(JSON.parse(match[0]))
  getDb().transaction(()=>{
   getDb().prepare('UPDATE notes SET summary=?,keywords=?,topic=?,processed=1 WHERE note_id=?').run(parsed.summary,JSON.stringify(parsed.keywords),parsed.topic,noteId)
   upsertFts(noteId)
  })()
  ctx.emit('notes.changed',{kind:'summarize',noteId});return parsed
 }finally{active.delete(key)}
}
export function cancelSummary(noteId:string){active.get(getWorkspacePath()+'\0'+noteId)?.abort()}
export async function startSummaryBatch(filter:Parameters<typeof listNotes>[0],ctx:SysContext,search:{query?:string;searchMode?:'fts'|'text'}={}){
 await backgroundModel()
 const workspace=getWorkspacePath(),batchId=crypto.randomUUID(),controller=new AbortController()
 if([...batches.values()].some(b=>b.workspace===workspace))throw new Error('已有批量处理正在运行')
 const targetFilter={...filter,unprocessed:true}
 const notes=search.query?.trim()?(await searchLocalNotes(search.query.trim(),search.searchMode??'fts',targetFilter,Number.MAX_SAFE_INTEGER)).items.map(hit=>hit.note):listNotes(targetFilter,'modified',-1,0).items
 batches.set(batchId,{controller,workspace})
 setImmediate(()=>void (async()=>{
  const failed:{noteId:string;reason:string}[]=[];let done=0
  try{for(const note of notes){
   if(controller.signal.aborted||getWorkspacePath()!==workspace)break
   ctx.emit('summarize.progress',{batchId,total:notes.length,done,current:note.title,failed,finished:false})
   try{await summarize(note.note_id,ctx,controller.signal)}catch(e){if(controller.signal.aborted)break;failed.push({noteId:note.note_id,reason:e instanceof Error?e.message:String(e)})}
   done++
  }}finally{batches.delete(batchId);ctx.emit('summarize.progress',{batchId,total:notes.length,done,failed,finished:true,cancelled:controller.signal.aborted||getWorkspacePath()!==workspace})}
 })())
 return {batchId,total:notes.length}
}
export function cancelSummaryBatch(batchId:string){const batch=batches.get(batchId);if(batch?.workspace===getWorkspacePath())batch.controller.abort()}
export function relatedNotes(noteId:string,limit:number){
 const note=getNote(noteId);if(!note||note.deleted_at!==null)throw new Error('笔记不存在')
 let words:string[]=[];try{words=JSON.parse(note.keywords??'[]')}catch{/* old text metadata */}
 if(!Array.isArray(words)||!words.length)words=note.title.split(/[\s，。；、,.!?]+/)
 const found=new Map<string,{noteId:string;title:string;snippet:string}>()
 for(const word of words.filter(w=>typeof w==='string'&&w.trim()).slice(0,12)){
  for(const hit of searchNotes(word,limit+1)){if(hit.noteId!==noteId&&getNote(hit.noteId)?.deleted_at===null)found.set(hit.noteId,hit)}
 }
 return {items:[...found.values()].slice(0,limit)}
}
