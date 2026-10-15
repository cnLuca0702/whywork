import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {invokeSys,type SysContext} from './syscalls/registry'
import {getWorkspacePath} from './syscalls/app'
import {CandidateScope} from './services/file-candidates'
import {getDb} from './db/client'
export async function runFeatureChecks(){
 const ctx:SysContext={source:'user',win:()=>null,emit:()=>undefined}
 const sys=async<T>(action:string,payload?:unknown):Promise<T>=>{const r=await invokeSys(action,payload,ctx);if(!r.ok)throw new Error(r.error.message);return r.data as T}
 const {noteId}=await sys<{noteId:string}>('notes.create',{title:'ORBIT 合成项目',body:'alpha beta 青禾预算正文'})
 type Result={items:{noteId:string;searchSource?:string;searchSnippet?:string}[];total:number}
 const fts=await sys<Result>('notes.list',{query:'alpha',searchMode:'fts'}),text=await sys<Result>('notes.list',{query:'ORBIT 预算',searchMode:'text'})
 assert(fts.items.some(n=>n.noteId===noteId&&n.searchSource==='FTS5 索引'));assert(text.items.some(n=>n.noteId===noteId&&n.searchSnippet?.includes('预算')))
 const row=getDb().prepare('SELECT relative_path FROM notes WHERE note_id=?').get(noteId) as {relative_path:string}
 fs.appendFileSync(path.join(getWorkspacePath(),row.relative_path),'\nDISKONLYTOKEN\n')
 assert.equal((await sys<Result>('notes.list',{query:'DISKONLYTOKEN',searchMode:'fts'})).total,0)
 assert.equal((await sys<Result>('notes.list',{query:'DISKONLYTOKEN',searchMode:'text'})).total,1)
 await sys('notes.set_status',{noteId,favorite:true})
 assert.equal((await sys<Result>('notes.list',{query:'ORBIT',searchMode:'text',filter:{favorite:false}})).total,0)
 assert.equal((await sys<Result>('notes.list',{query:'ORBIT',searchMode:'fts',filter:{favorite:false}})).total,0)
 const dir=path.join(getWorkspacePath(),'resources/selected');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'UNINDEXED_TOKEN.md'),'FILE_BODY_TOKEN')
 const scope=await CandidateScope.create(dir);assert.equal((await scope.find('UNINDEXED_TOKEN',new Set())).items.length,1);assert.equal((await scope.find('FILE_BODY_TOKEN',new Set())).items.length,0)
 assert.equal((await sys<Result>('notes.list',{query:'FILE_BODY_TOKEN',searchMode:'text'})).total,0)
 assert.equal((await invokeSys('search.choose_folder',{}, {...ctx,source:'agent'})).ok,false)
 assert.equal((await invokeSys('search.candidates',{id:'not-a-grant',query:'x'},ctx)).ok,false)
 assert.equal((await invokeSys('provider.chatgpt_login',{newAccount:false},{...ctx,source:'agent'})).ok,false)
 assert.equal((await sys<{loggedIn:boolean}>('provider.chatgpt_status')).loggedIn,false)
 assert.equal((await sys<{ok:boolean}>('provider.chatgpt_cancel_login')).ok,true)
 const fixture=process.env.WHYWORK_FEATURE_AUDIO_FIXTURE
 if(fixture){
  // Real WebAudio -> MediaRecorder output captured during the isolated UI check.
  const bytes=fs.readFileSync(fixture),id=crypto.randomUUID(),payload={id,mime:'audio/webm;codecs=opus',data:bytes.toString('base64'),durationMs:14293,mode:'synthetic'}
  const before=(getDb().prepare('SELECT count(*) AS n FROM notes').get() as {n:number}).n
  const first=await sys<{noteId:string;path:string}>('media.save_recording',payload)
  assert.deepEqual(await sys('media.save_recording',payload),first)
  assert.deepEqual(fs.readFileSync(path.join(getWorkspacePath(),first.path)),bytes)
  assert.equal((getDb().prepare('SELECT count(*) AS n FROM notes').get() as {n:number}).n,before+1)
  assert.equal((await invokeSys('media.save_recording',payload,{...ctx,source:'agent'})).ok,false)
  const changed=Buffer.from(bytes);changed[changed.length-1]=changed[changed.length-1]!^1
  assert.equal((await invokeSys('media.save_recording',{...payload,data:changed.toString('base64')},ctx)).ok,false)
  assert.equal((await invokeSys('media.save_recording',{...payload,id:crypto.randomUUID(),data:Buffer.from('invalid').toString('base64')},ctx)).ok,false)
  console.log('[FEATURE-CHECK] Real captured audio save/readback, idempotency, content-conflict and malformed/source rejection PASS')
 }
 console.log('[FEATURE-CHECK] Independent FTS/disk routes, filters, filename-only candidates and grant rejection PASS')
}
