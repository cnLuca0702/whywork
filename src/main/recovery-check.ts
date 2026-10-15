import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {getDb,resetDb} from './db/client'
import {createNote,getNote,updateNoteBody,searchNotes,createCollection,addNoteToCollection,listNoteCollections,setNoteStatus} from './db/repos/notes'
import {parseFrontmatter,readNoteFile} from './db/notes-file'

export function recoveryRoot():string {
  const root=process.env.WHYWORK_RECOVERY_ROOT,token=process.env.WHYWORK_RECOVERY_TOKEN
  if(!root||!token||!/^[a-f0-9]{32}$/.test(token))throw new Error('Missing isolated recovery test identity')
  const real=fs.realpathSync(root),tmp=fs.realpathSync(os.tmpdir())
  if(path.dirname(real)!==tmp||!path.basename(real).startsWith('whywork-process-check-')||fs.readFileSync(path.join(real,'owner'),'utf8')!==token)throw new Error('Invalid isolated recovery test root')
  return real
}

/** Tests committed data across genuine process exits, not unsaved UI buffers. */
export async function runRecoveryPhase(root:string):Promise<'quit'|'wait'> {
  const phase=process.env.WHYWORK_RECOVERY_PHASE,stateFile=path.join(root,'state.json')
  if(phase==='prepare') {
    const note=createNote({title:'进程恢复合成样本',body:'RECOVERY_NORMAL_MARKER'})
    setNoteStatus(note.note_id,{favorite:true})
    addNoteToCollection(note.note_id,createCollection('恢复合成集合').id)
    fs.writeFileSync(stateFile,JSON.stringify({noteId:note.note_id}))
    resetDb();console.log('[RECOVERY] NORMAL_READY');return 'quit'
  }
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8')) as {noteId:string}
  if(phase==='crash-write') {
    getDb().pragma('wal_autocheckpoint = 0')
    updateNoteBody(state.noteId,{title:'进程恢复合成样本',body:'RECOVERY_CRASH_COMMITTED_MARKER [[合成链接]]'})
    // Parent kills only this spawned worker after the committed-write signal.
    console.log('[RECOVERY] CRASH_READY')
    setInterval(()=>undefined,1000)
    return 'wait'
  }
  assert(['verify-normal','verify-crash'].includes(phase??''),'Unknown recovery phase')
  const note=getNote(state.noteId);assert(note)
  assert.equal(note.favorite,1)
  assert.equal(listNoteCollections(state.noteId)[0]?.title,'恢复合成集合')
  const marker=phase==='verify-normal'?'RECOVERY_NORMAL_MARKER':'RECOVERY_CRASH_COMMITTED_MARKER'
  assert(parseFrontmatter(readNoteFile(note.relative_path)).body.includes(marker))
  assert(searchNotes(marker,10).some(hit=>hit.noteId===state.noteId))
  assert.equal(getDb().pragma('integrity_check',{simple:true}),'ok')
  if(phase==='verify-crash')assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM links WHERE source_note_id=? AND target_text=?').get(state.noteId,'合成链接') as {n:number}).n,1)
  resetDb();console.log('[RECOVERY] '+phase+' PASS');return 'quit'
}
