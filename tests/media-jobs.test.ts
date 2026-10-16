import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:'',bin:'',db:null as unknown,background:vi.fn()}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
vi.mock('../src/main/db/client',()=>({getDb:()=>mock.db}))
vi.mock('../src/main/syscalls/settings',()=>({getSetting:(key:string)=>key==='media.downloaderPath'?mock.bin:key==='media.ocrEnabled'?'false':null}))
vi.mock('../src/main/syscalls/media',()=>({transcribeAudio:vi.fn(),ocrImage:vi.fn()}))
vi.mock('../src/main/providers/background',()=>({backgroundText:mock.background}))
import Database from 'better-sqlite3'
import {DDL_STATEMENTS,migrateDb} from '../src/main/db/ddl'
import {addMediaUrls,mediaJobs,cancelMediaJob,retryMediaJob} from '../src/main/services/media-jobs'
const ctx={source:'user' as const,win:()=>null,emit:()=>{}}
beforeAll(()=>{
 mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-media-jobs-'));mock.bin=path.join(mock.ws,'synthetic-downloader')
 fs.writeFileSync(mock.bin,`#!${process.execPath}\nconst fs=require('fs'),path=require('path'),args=process.argv.slice(2);const output=args[args.indexOf('-o')+1];if(args.at(-1).includes('slow')){setTimeout(()=>{},30000)}else{fs.writeFileSync(path.join(path.dirname(output),'source.en.vtt'),'WEBVTT\\n\\n00:00:00.000 --> 00:00:01.000\\nSynthetic transcript');console.log(JSON.stringify({title:'Synthetic video'}))}`);fs.chmodSync(mock.bin,0o755)
 const db=new Database(':memory:');db.pragma('foreign_keys = ON');for(const sql of DDL_STATEMENTS)db.exec(sql);migrateDb(db);mock.db=db
})
afterAll(()=>{(mock.db as Database.Database).close();fs.rmSync(mock.ws,{recursive:true,force:true})})
async function until(id:string,state:string){for(let i=0;i<100;i++){const row=(mediaJobs().items as {id:string;state:string;note_id:string;transcript_id:string;overview_id:string}[]).find(j=>j.id===id)!;if(row.state===state)return row;await new Promise(r=>setTimeout(r,30))}throw new Error('Job did not reach '+state)}
it('downloads subtitles locally, preserves partial notes on model failure, and retries without duplicates',async()=>{
 mock.background.mockRejectedValueOnce(new Error('synthetic model unavailable'))
 const id=addMediaUrls(['https://example.invalid/synthetic'],ctx).jobIds[0]!
 const failed=await until(id,'failed');expect(failed.note_id).toBeTruthy();expect(failed.transcript_id).toBeTruthy()
 mock.background.mockResolvedValueOnce('Synthetic overview');retryMediaJob(id,ctx)
 const done=await until(id,'done');expect(done.note_id).toBe(failed.note_id);expect(done.transcript_id).toBe(failed.transcript_id);expect(done.overview_id).toBeTruthy()
 expect((mock.db as Database.Database).prepare('SELECT count(*) AS n FROM notes').get()).toEqual({n:3})
 expect((mock.db as Database.Database).prepare('SELECT count(*) AS n FROM links').get()).toEqual({n:6})
},10000)
it('cancels the running downloader without creating notes',async()=>{
 const id=addMediaUrls(['https://example.invalid/slow'],ctx).jobIds[0]!
 await until(id,'parsing');cancelMediaJob(id,ctx);await until(id,'cancelled')
 await new Promise(r=>setTimeout(r,100))
 expect((mock.db as Database.Database).prepare('SELECT count(*) AS n FROM notes').get()).toEqual({n:3})
})
