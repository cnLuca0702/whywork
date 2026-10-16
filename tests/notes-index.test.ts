import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:'',db:null as unknown}))
vi.mock('electron',()=>({app:{getPath:()=>'/synthetic'},shell:{}}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
vi.mock('../src/main/agent/vault',()=>({snapshotBeforeWrite:()=>undefined}))
vi.mock('../src/main/db/client',()=>({getDb:()=>mock.db,dbPath:()=>'',resetDb:()=>{}}))
import Database from 'better-sqlite3'
import {DDL_STATEMENTS} from '../src/main/db/ddl'
import * as repo from '../src/main/db/repos/notes'
beforeAll(()=>{
 mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-index-'))
 const db=new Database(':memory:');db.pragma('foreign_keys = ON');for(const stmt of DDL_STATEMENTS)db.exec(stmt);mock.db=db
})
afterAll(()=>{
 (mock.db as {close():void}).close()
 fs.rmSync(mock.ws,{recursive:true,force:true})
})
it('pads CJK characters so unicode61 can match them as phrases',()=>{
 expect(repo.cjkPad('青禾项目 v2')).toBe('青 禾 项 目 v2')
 expect(repo.cjkPad('plain ascii')).toBe('plain ascii')
})
it('finds a CJK phrase through the FTS path and reports the fts source',()=>{
 const n=repo.createNote({title:'青禾项目纪要',body:'青禾预算为80万元'})
 const hits=repo.searchNotes('青禾预算',10)
 expect(hits.find(h=>h.noteId===n.note_id)?.source).toBe('fts')
})
it('lists CJK queries from the notes view with the same tokenization as search',()=>{
 const n=repo.createNote({title:'列表检索',body:'乌兰巴托的会议安排在周三'})
 const {items}=repo.listNotes({},'modified',20,0,'乌兰巴托')
 expect(items.map(i=>i.note_id)).toContain(n.note_id)
})
it('matches a CJK term that sits inside a longer run of body text',()=>{
 const n=repo.createNote({title:'无标题关键词',body:'这里记录了苏州仓库的库存盘点结果'})
 const hit=repo.searchNotes('库存',10).find(h=>h.noteId===n.note_id)
 expect(hit?.source).toBe('fts')
 expect(hit?.snippet).toContain('库')
})
it('shows CJK snippets without the indexing spaces inserted between characters',()=>{
 const n=repo.createNote({title:'片段显示',body:'南京港口装卸流程第三版'})
 const hit=repo.searchNotes('港口装卸',10).find(h=>h.noteId===n.note_id)
 expect(hit).toBeDefined()
 expect(hit?.snippet).toContain('港口装卸')
})
it('does not throw on FTS operator characters in user queries',()=>{
 repo.createNote({title:'operator guard',body:'literal text'})
 expect(()=>repo.searchNotes('a" OR "b',10)).not.toThrow()
 expect(()=>repo.listNotes({},'modified',10,0,'NEAR( AND *')).not.toThrow()
})
it('soft delete releases the original path so the same title can be imported again',()=>{
 const first=repo.createNote({title:'同名回收',body:'first'})
 const originalPath=first.relative_path
 repo.softDeleteNote(first.note_id,'')
 // The vault moves the file to a tombstone; mirror that so the original path is free.
 fs.rmSync(path.join(mock.ws,originalPath))
 const deleted=repo.getNote(first.note_id)
 expect(deleted?.deleted_at).not.toBeNull()
 expect(deleted?.relative_path).toBe(`__deleted__/${first.note_id}`)
 const second=repo.createNote({title:'同名回收',body:'second'})
 expect(second.relative_path).toBe(originalPath)
})
it('soft-deleted notes leave the FTS index and no longer appear in search',()=>{
 const n=repo.createNote({title:'待删除索引',body:'DELETE_ME_MARKER 测试'})
 expect(repo.searchNotes('DELETE_ME_MARKER',10).some(h=>h.noteId===n.note_id)).toBe(true)
 repo.softDeleteNote(n.note_id,'')
 expect(repo.searchNotes('DELETE_ME_MARKER',10).some(h=>h.noteId===n.note_id)).toBe(false)
})
it('restore re-indexes a soft-deleted note under its restored path',()=>{
 const n=repo.createNote({title:'恢复索引',body:'RESTORE_MARKER 正文'})
 repo.softDeleteNote(n.note_id,'')
 // Restore moves the tombstone file back into the workspace before re-indexing.
 const restored=path.join(path.dirname(n.relative_path),`restored-${n.note_id}.md`)
 fs.renameSync(path.join(mock.ws,n.relative_path),path.join(mock.ws,restored))
 repo.restoreNote(n.note_id,restored)
 const row=repo.getNote(n.note_id)
 expect(row?.deleted_at).toBeNull()
 expect(row?.relative_path).toBe(restored)
 expect(repo.searchNotes('RESTORE_MARKER',10).some(h=>h.noteId===n.note_id)).toBe(true)
})
it('hard delete removes the FTS row without leaving a ghost hit',()=>{
 const n=repo.createNote({title:'硬删除',body:'HARD_DELETE_MARKER'})
 repo.hardDeleteNoteRow(n.note_id)
 expect(repo.searchNotes('HARD_DELETE_MARKER',10)).toEqual([])
})
it('excludes the note being edited from its own related-note search',()=>{
 const n=repo.createNote({title:'自引用',body:'SELF_REF_MARKER'})
 expect(repo.searchNotes('SELF_REF_MARKER',10,{excludeNoteId:n.note_id})).toEqual([])
})
