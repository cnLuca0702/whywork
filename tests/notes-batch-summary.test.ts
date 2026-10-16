import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:'',db:null as unknown,background:vi.fn()}))
vi.mock('electron',()=>({app:{getPath:()=>'/synthetic'},shell:{}}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
vi.mock('../src/main/db/client',()=>({getDb:()=>mock.db,dbPath:()=>'',resetDb:()=>{}}))
vi.mock('../src/main/providers/background',()=>({backgroundText:mock.background,backgroundModel:async()=>({})}))
import Database from 'better-sqlite3'
import {DDL_STATEMENTS,migrateDb} from '../src/main/db/ddl'
import * as repo from '../src/main/db/repos/notes'
import {registerNotesDomain} from '../src/main/syscalls/notes'
import {invokeSys} from '../src/main/syscalls/registry'
import {summarize,cancelSummary,relatedNotes,startSummaryBatch,cancelSummaryBatch} from '../src/main/services/summaries'
const events:{topic:string;payload:unknown}[]=[]
const ctx={source:'user' as const,win:()=>null,emit:(topic:string,payload:unknown)=>events.push({topic,payload})}
async function call<T>(action:string,payload:unknown){const r=await invokeSys(action,payload,ctx);if(!r.ok)throw new Error(r.error.message);return r.data as T}
beforeAll(()=>{mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-batch-'));const db=new Database(':memory:');db.pragma('foreign_keys = ON');for(const stmt of DDL_STATEMENTS)db.exec(stmt);migrateDb(db);mock.db=db;registerNotesDomain()})
afterAll(()=>{(mock.db as Database.Database).close();fs.rmSync(mock.ws,{recursive:true,force:true})})
it('applies status and collection batches with isolated item failures and real snapshots',async()=>{
 const note=repo.createNote({title:'批处理',body:'body'})
 const result=await call<{success:string[];failed:unknown[]}>('notes.batch_set_status',{noteIds:[note.note_id,'missing'],favorite:true})
 expect(result.success).toEqual([note.note_id]);expect(result.failed).toHaveLength(1);expect(repo.getNote(note.note_id)?.favorite).toBe(1)
 const added=await call<{success:string[];failed:unknown[]}>('collections.batch_add',{noteIds:[note.note_id,'missing'],collectionTitle:'测试集合'})
 expect(added.success).toHaveLength(1);expect(added.failed).toHaveLength(1);expect(repo.listNoteCollections(note.note_id)[0]?.title).toBe('测试集合')
 expect((mock.db as Database.Database).prepare("SELECT count(*) AS n FROM vault_changes WHERE op='modify'").get()).toEqual({n:2})
})
it('deletes and restores valid notes while reporting missing ids',async()=>{
 const note=repo.createNote({title:'批量回收',body:'recover me'})
 const deleted=await call<{failed:unknown[]}>('notes.batch_delete',{noteIds:[note.note_id,'missing']});expect(deleted.failed).toHaveLength(1);expect(repo.getNote(note.note_id)?.deleted_at).not.toBeNull()
 await call('notes.batch_restore',{noteIds:[note.note_id]});expect(repo.getNote(note.note_id)?.deleted_at).toBeNull()
})
it('combines source, date and status filters before paginating',()=>{
 const a=repo.createNote({title:'A FILTER_TARGET',body:'FILTER_TARGET',source:'page'}),b=repo.createNote({title:'B FILTER_TARGET',body:'FILTER_TARGET',source:'page'})
 repo.createNote({title:'C FILTER_TARGET',body:'FILTER_TARGET',source:'manual'})
 repo.setNoteStatus(a.note_id,{favorite:true});repo.setNoteStatus(b.note_id,{favorite:true})
 const r=repo.listNotes({sources:['page'],favorite:true,modifiedFrom:0,modifiedTo:Date.now()+1000},'title',1,1,'FILTER_TARGET')
 expect(r.total).toBe(2);expect(r.items[0]?.note_id).toBe(b.note_id)
})
it('writes processed and metadata only for unchanged notes',async()=>{
 const n=repo.createNote({title:'摘要',body:'content'})
 mock.background.mockResolvedValueOnce('{"summary":"概览","keywords":["content"],"topic":"test"}')
 await summarize(n.note_id,ctx);expect(repo.getNote(n.note_id)?.processed).toBe(1)
 mock.background.mockImplementationOnce(async()=>{repo.updateNoteBody(n.note_id,{body:'changed'});return '{"summary":"stale","keywords":[],"topic":""}'})
 await expect(summarize(n.note_id,ctx)).rejects.toThrow('笔记已变化');expect(repo.getNote(n.note_id)?.summary).toBe('概览')
})
it('cancels a single summary before metadata commit',async()=>{
 const n=repo.createNote({title:'取消摘要',body:'content'})
 mock.background.mockImplementationOnce(async()=>{cancelSummary(n.note_id);return '{"summary":"cancelled","keywords":[],"topic":""}'})
 await expect(summarize(n.note_id,ctx)).rejects.toThrow();expect(repo.getNote(n.note_id)?.processed).toBe(0)
})
it('related results exclude self and deleted notes',()=>{
 const a=repo.createNote({title:'RELATED_MARKER',body:'content'}),b=repo.createNote({title:'RELATED_MARKER B',body:'content'}),c=repo.createNote({title:'RELATED_MARKER C',body:'content'})
 repo.softDeleteNote(c.note_id,'')
 expect(relatedNotes(a.note_id,5).items.map(n=>n.noteId)).toEqual([b.note_id])
})
it('batch cancellation stops before the next provider request',async()=>{
 mock.background.mockClear()
 const r=await startSummaryBatch({},ctx);cancelSummaryBatch(r.batchId)
 await new Promise(resolve=>setImmediate(resolve))
 expect(mock.background).not.toHaveBeenCalled()
 expect(events.some(e=>e.topic==='summarize.progress'&&(e.payload as {cancelled:boolean}).cancelled)).toBe(true)
})

it('filters mention candidates by literal title before pagination, excluding body-only matches',()=>{
 repo.createNote({title:'Mention needle_10',body:'x'})
 repo.createNote({title:'Mention needleX10',body:'x'})
 repo.createNote({title:'Unrelated mention candidate',body:'needle_10'})
 const result=repo.listNotes({titleQuery:'needle_10'},'title',8,0)
 expect(result.total).toBe(1);expect(result.items[0]?.title).toBe('Mention needle_10')
})
it('batch snapshot includes more than 500 matching notes and respects source and search filters',async()=>{
 mock.background.mockClear()
 for(let i=0;i<501;i++)repo.createNote({title:`BATCH_SCOPE ${i}`,body:'batch needle',source:'page'})
 repo.createNote({title:'BATCH_SCOPE excluded',body:'batch needle',source:'manual'})
 const r=await startSummaryBatch({sources:['page']},ctx,{query:'batch needle',searchMode:'text'})
 expect(r.total).toBe(501);cancelSummaryBatch(r.batchId)
 await new Promise(resolve=>setImmediate(resolve));expect(mock.background).not.toHaveBeenCalled()
},20000)
