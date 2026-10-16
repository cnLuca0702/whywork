import crypto from 'node:crypto'
import {getDb} from '../db/client'
import {getNote,createNote,updateNoteBody} from '../db/repos/notes'
import {parseFrontmatter,readNoteFile} from '../db/notes-file'
import {resolveWorkspacePath} from '../security/paths'
import {getWorkspacePath} from '../syscalls/app'
import {getSetting} from '../syscalls/settings'
import {transcribeAudio} from '../syscalls/media'
import {backgroundText} from '../providers/background'
import type {SysContext} from '../syscalls/registry'
interface Recording {note_id:string;path:string;key_points:string;language:string;transcript_note_id:string|null;minutes_note_id:string|null}
const transcribing=new Set<string>(),minutes=new Map<string,AbortController>()
function recording(id:string){const row=getDb().prepare('SELECT * FROM saved_recordings WHERE note_id=?').get(id) as Recording|undefined;if(!row||getNote(id)?.deleted_at!==null)throw new Error('录音笔记不存在');return row}
function linkNotes(row:Recording){
 const ids=[row.note_id,row.transcript_note_id,row.minutes_note_id].filter((id):id is string=>!!id&&getNote(id)?.deleted_at===null)
 const db=getDb();db.transaction(()=>{for(const source of ids)for(const target of ids){if(source===target)continue
  if(!db.prepare('SELECT 1 FROM links WHERE source_note_id=? AND target_note_id=?').get(source,target))db.prepare('INSERT INTO links(id,source_note_id,target_text,target_note_id,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),source,getNote(target)!.title,target,Date.now())
 }})()
}
export function pendingTranscriptions(){const items=(getDb().prepare('SELECT r.note_id AS noteId,n.title,r.path FROM saved_recordings r JOIN notes n ON n.note_id=r.note_id WHERE n.deleted_at IS NULL AND (r.transcript_note_id IS NULL OR NOT EXISTS(SELECT 1 FROM notes t WHERE t.note_id=r.transcript_note_id AND t.deleted_at IS NULL))').all());return {items,total:items.length}}
export async function transcribeRecording(id:string,language:string|undefined,ctx:SysContext){
 const workspace=getWorkspacePath(),key=workspace+'\0'+id,row=recording(id)
 if(row.transcript_note_id&&getNote(row.transcript_note_id)?.deleted_at===null)return {noteId:row.transcript_note_id,text:parseFrontmatter(readNoteFile(getNote(row.transcript_note_id)!.relative_path)).body,model:'saved'}
 if(transcribing.has(key))throw new Error('该录音正在转写')
 transcribing.add(key)
 try{
  const lang=language??row.language??getSetting('media.transcriptionLanguage')??'auto'
  const result=await transcribeAudio(resolveWorkspacePath(row.path),lang==='auto'?undefined:lang.split('-')[0])
  if(getWorkspacePath()!==workspace)throw new Error('工作区已切换，转写未写入')
  recording(id)
  if(!result.text.trim())throw new Error('转写服务未返回文本')
  const note=createNote({title:`转写-${getNote(id)!.title}`,body:result.text,source:'meeting_transcript'})
  getDb().prepare('UPDATE saved_recordings SET transcript_note_id=? WHERE note_id=?').run(note.note_id,id)
  row.transcript_note_id=note.note_id;linkNotes(row);ctx.emit('notes.changed',{kind:'transcribe',noteIds:[id,note.note_id]})
  return {...result,noteId:note.note_id,recordingNoteId:id}
 }finally{transcribing.delete(key)}
}
export function cancelMinutes(id:string){minutes.get(getWorkspacePath()+'\0'+id)?.abort()}
export async function generateMinutes(id:string,template:'general'|'interview'|'lecture',ctx:SysContext){
 const workspace=getWorkspacePath(),key=workspace+'\0'+id,row=recording(id)
 if(minutes.has(key))throw new Error('纪要正在生成')
 const transcript=row.transcript_note_id?getNote(row.transcript_note_id):undefined
 if(!transcript||transcript.deleted_at!==null)throw new Error('请先转写录音')
 const controller=new AbortController();minutes.set(key,controller)
 try{
  const text=await backgroundText(`根据转写稿与用户要点整理${template==='interview'?'访谈':template==='lecture'?'讲座':'通用会议'}纪要，包含概览、决定、待办；没有的信息标为未提及，不编造。词典只用于纠正专有名词。`,`${parseFrontmatter(readNoteFile(transcript.relative_path)).body.slice(0,48000)}\n\n用户要点：${row.key_points}\n专有名词：${getSetting('media.dictionary')??''}`,AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]),delta=>ctx.emit('media.minutes',{recordingNoteId:id,delta,finished:false}))
  controller.signal.throwIfAborted();if(getWorkspacePath()!==workspace)throw new Error('工作区已切换');recording(id)
  const old=row.minutes_note_id?getNote(row.minutes_note_id):undefined
  let noteId:string
  if(old&&old.deleted_at===null){updateNoteBody(old.note_id,{body:text});noteId=old.note_id}else{noteId=createNote({title:`纪要-${getNote(id)!.title}`,body:text,source:'meeting_overview'}).note_id}
  getDb().prepare('UPDATE saved_recordings SET minutes_note_id=? WHERE note_id=?').run(noteId,id);row.minutes_note_id=noteId;linkNotes(row)
  ctx.emit('notes.changed',{kind:'minutes',noteIds:[id,transcript.note_id,noteId]});ctx.emit('media.minutes',{recordingNoteId:id,finished:true,noteId});return {noteId}
 }catch(e){ctx.emit('media.minutes',{recordingNoteId:id,finished:true,error:e instanceof Error?e.message:String(e)});throw e}finally{minutes.delete(key)}
}
