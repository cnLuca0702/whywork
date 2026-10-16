import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { invokeSys, type SysContext } from './syscalls/registry'
import { getWorkspacePath } from './syscalls/app'
import { getDb } from './db/client'
import { rollbackChange, listChanges, rollbackChat } from './agent/vault'
import { executionContext } from './agent/context'
import * as repo from './db/repos/notes'
import { resourcePath, resolveWorkspacePath } from './security/paths'
import { requireToolConfirmation, respondConfirmation } from './agent/confirmation'
import {closeWatchers,restoreWatchers} from './syscalls/watch'
export async function runCoreChecks():Promise<void> {
  const ctx:SysContext={win:()=>null,emit:()=>undefined}
  const sys=async<T>(action:string,payload?:unknown):Promise<T>=>{
    const r=await invokeSys(action,payload,ctx);if(!r.ok)throw new Error(action+': '+r.error.message);return r.data as T
  }
  const a=await sys<{noteId:string}>('notes.create',{title:'甲',body:'成本控制青禾项目 [[乙]]'})
  await sys('notes.create',{title:'乙',body:'reference'})
  const search=await sys<{items:repo.SearchHit[]}>('notes.search',{query:'青禾'})
  assert(search.items.some(h=>h.noteId===a.noteId),'Chinese substring retrieval')
  await sys('notes.set_status',{noteId:a.noteId,favorite:true})
  const filtered=await sys<{items:unknown[];total:number}>('notes.list',{query:'青禾',filter:{favorite:false},limit:1,offset:0})
  assert.equal(filtered.total,0,'Search respects status filter')
  await sys('notes.update',{noteId:a.noteId,title:'新标题',body:'修改正文 [[乙]]'})
  const modification=listChanges().find(c=>c.op==='modify'&&c.kind==='note')!
  assert(rollbackChange(modification.change_id))
  const restored=await sys<{body:string;note:{title:string}}>('notes.get',{noteId:a.noteId})
  assert.equal(restored.note.title,'甲');assert.equal(restored.body,'成本控制青禾项目 [[乙]]')
  assert(repo.searchNotes('青禾',20).some(h=>h.noteId===a.noteId),'Restored FTS/body')
  await sys('notes.delete',{noteId:a.noteId})
  const b=await sys<{noteId:string}>('notes.create',{title:'甲',body:'同名第二篇'})
  assert.notEqual(repo.getNote(a.noteId)!.relative_path,repo.getNote(b.noteId)!.relative_path)
  const deleted=listChanges().find(c=>c.op==='delete'&&c.kind==='note')!
  assert.throws(()=>rollbackChange(deleted.change_id),'Occupied original path must not overwrite the newer note')
  await sys('notes.restore',{noteId:a.noteId});assert.equal(repo.getNote(a.noteId)!.deleted_at,null)
  assert.equal(repo.getNote(b.noteId)!.title,'甲')
  assert.equal(repo.listLinks(a.noteId).out.length,1)
  // Context propagation remains isolated across concurrent asynchronous tool calls.
  await Promise.all(['session-a','session-b'].map(chatId=>executionContext.run({...ctx,chatId},async()=>{
    await new Promise(resolve=>setImmediate(resolve))
    await sys('file.write',{path:`resources/${chatId}.txt`,content:chatId})
  })))
  assert.equal(listChanges('session-a').length,1);assert.equal(listChanges('session-b').length,1)
  assert.equal(rollbackChat('session-a'),1);assert(fs.existsSync(path.join(getWorkspacePath(),'resources/session-b.txt')))
  const created=await sys<{noteId:string}>('notes.create',{title:'撤销创建',body:'rollback_create_unique'})
  const creation=listChanges().find(c=>c.op==='create'&&c.path===repo.getNote(created.noteId)!.relative_path)!
  rollbackChange(creation.change_id);assert.equal(repo.getNote(created.noteId),undefined)
  assert.equal(repo.searchNotes('rollback_create_unique',10).length,0,'No ghost FTS row')
  const edited=await sys<{noteId:string}>('notes.create',{title:'局部编辑回归',body:'alpha beta'})
  const beforeEdit=listChanges().length
  const editedResult=await invokeSys('notes.update',{noteId:edited.noteId,edits:[{oldText:'alpha',newText:'gamma'}]},{...ctx,source:'agent',chatId:'edit-regression'})
  assert(editedResult.ok);assert.equal(repo.getNote(edited.noteId)?.note_source,'manual')
  assert.equal((await sys<{body:string}>('notes.get',{noteId:edited.noteId})).body,'gamma beta')
  assert(listChanges().length>beforeEdit)
  assert.equal(rollbackChat('edit-regression'),1)
  assert.equal((await sys<{body:string}>('notes.get',{noteId:edited.noteId})).body,'alpha beta')
  // Bad links and metadata access must fail before touching content.
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-path-check-'))
  try {
    fs.writeFileSync(path.join(external,'secret.txt'),'synthetic')
    fs.symlinkSync(external,path.join(getWorkspacePath(),'resources/outside'))
    fs.symlinkSync(path.join(getWorkspacePath(),'.whywork'),path.join(getWorkspacePath(),'resources/metadata-alias'))
    assert.throws(()=>resourcePath('whywork-res://resources/metadata-alias/whywork.db'))
    for(const p of ['../secret.txt','.whywork/whywork.db','resources/metadata-alias/whywork.db','resources/outside/secret.txt']) {
      const r=await invokeSys('file.read',{path:p},ctx);assert.equal(r.ok,false,p)
    }
    assert.throws(()=>resourcePath('whywork-res://resources/outside/secret.txt'))
    assert.throws(()=>resourcePath('whywork-res://resources/%2e%2e%2f%2e%2e%2f.whywork/whywork.db'))
    const good=path.join(getWorkspacePath(),'resources/正常.png');fs.writeFileSync(good,'synthetic')
    assert.equal(resourcePath('whywork-res://resources/%E6%AD%A3%E5%B8%B8.png'),fs.realpathSync(good))
  } finally {fs.rmSync(external,{recursive:true,force:true})}
  // Confirmation requires a matching chat, and rejection never executes a tool.
  let asked=false
  const confirmed={...ctx,source:'agent' as const,chatId:'confirm',emit:(_topic:string,payload:unknown)=>{
    if(_topic!=='chat.confirm')return
    const p=payload as {id:string;chatId:string};asked=true
    assert.throws(()=>respondConfirmation(p.id,'wrong-chat',true))
    respondConfirmation(p.id,p.chatId,true)
  }}
  await requireToolConfirmation('notes.delete','{"noteId":"synthetic"}',confirmed);assert(asked)
  const rejected={...confirmed,emit:(_t:string,p:unknown)=>{if(_t!=='chat.confirm')return;const v=p as {id:string;chatId:string};respondConfirmation(v.id,v.chatId,false)}}
  await assert.rejects(requireToolConfirmation('mcp__external__write','{}',rejected))
  const ac=new AbortController();ac.abort()
  await assert.rejects(requireToolConfirmation('file.write','{}',{...confirmed,signal:ac.signal}))
  const monitored=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-monitor-check-'))
  try {
    const file=path.join(monitored,'sample.md');fs.writeFileSync(file,'# monitored\nWATCH_FIRST')
    const folder=await sys<{id:string}>('watch.folders_add',{dir:monitored})
    assert.equal((await sys<{imported:number}>('watch.scan_now',{id:folder.id})).imported,1)
    assert.equal((await sys<{imported:number}>('watch.scan_now',{id:folder.id})).imported,0,'No duplicate re-import')
    await sys('watch.pause',{id:folder.id});fs.writeFileSync(file,'WATCH_SECOND')
    closeWatchers();restoreWatchers(ctx)
    assert.equal((await sys<{items:{id:string;enabled:boolean}[]}>('watch.folders_list')).items.find(f=>f.id===folder.id)?.enabled,false,'Pause persists through watcher restart')
    assert.equal((await sys<{imported:number}>('watch.scan_now',{id:folder.id})).imported,0)
    const resumed=await sys<{imported:number}>('watch.resume',{id:folder.id})
    assert.equal(resumed.imported,1)
    assert.equal(repo.searchNotes('WATCH_SECOND',10).length,1)
    closeWatchers();fs.writeFileSync(file,'WATCH_RESTARTED');restoreWatchers(ctx)
    await sys('watch.scan_now',{id:folder.id})
    assert.equal(repo.searchNotes('WATCH_RESTARTED',10).length,1,'Enabled watcher catches up after restart')
    await sys('watch.folders_remove',{id:folder.id})
    for(let i=0;i<10;i++)fs.writeFileSync(path.join(monitored,`cancel-${i}.txt`),'CANCEL_INPUT')
    const importing=sys<{cancelled:boolean;processed:number;total:number}>('app.import',{paths:[monitored],importId:'cancel-core'})
    await sys('app.import_cancel',{importId:'cancel-core'})
    const result=await importing
    assert(result.cancelled);assert(result.processed<result.total)
    const missing=await sys<{errors:string[]}>('app.import',{paths:[path.join(monitored,'missing.pdf')]})
    assert.equal(missing.errors.length,1)
    const sharedTitle='分享"标题\n第二行: 安全',shared=path.join(monitored,'share-synthetic.md')
    fs.writeFileSync(shared,'---\ntitle: '+JSON.stringify(sharedTitle)+'\nsource: manual\n---\n\nSHARE_SYNTHETIC_MARKER')
    const sharedResult=await sys<{noteIds:string[]}>('app.import',{paths:[shared]})
    assert.equal(repo.getNote(sharedResult.noteIds[0]!)?.title,sharedTitle)
    const brokenImage=path.join(monitored,'invalid-embedded.md')
    fs.writeFileSync(brokenImage,'# INVALID_EMBEDDED_MARKER\n![bad](data:image/svg+xml;base64,PHN2Zz4=)')
    const failedImage=await sys<{errors:string[];noteIds:string[]}>('app.import',{paths:[brokenImage]})
    assert.equal(failedImage.errors.length,1);assert.equal(failedImage.noteIds.length,0);assert.equal(repo.searchNotes('INVALID_EMBEDDED_MARKER',10).length,0,'Invalid embedded images do not leave a partial note')
  } finally {fs.rmSync(monitored,{recursive:true,force:true})}
  const settings=await sys<{settings:Record<string,string|null>}>('settings.get',{keys:['media.asrKey']})
  assert.equal(settings.settings['media.asrKey'],null)
  // Run only with a synthetic key in this isolated profile.
  const saved=await invokeSys('settings.set',{settings:{'media.asrKey':'synthetic-only-key'}},ctx)
  if(saved.ok) {
    const raw=getDb().prepare('SELECT value FROM settings WHERE key=?').get('media.asrKey') as {value:string}
    assert(!raw.value.includes('synthetic-only-key'))
    const masked=await sys<{settings:Record<string,string>}>('settings.get',{keys:['media.asrKey']})
    assert.equal(masked.settings['media.asrKey'],'••••••••')
  } else assert(saved.error.message.includes('系统密钥存储不可用'))
  const pdfPath=path.join(getWorkspacePath(),'.whywork/tmp/core-check.pdf')
  await sys('export.text_pdf',{title:'合成PDF',text:'中文 PDF_CORE_MARKER',targetPath:pdfPath})
  const {loadPdfJs}=await import('./services/importer'),pdfjs=await loadPdfJs()
  const document=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(pdfPath))}).promise
  const text=(await (await document.getPage(1)).getTextContent()).items.map(x=>'str' in x?x.str:'').join('').normalize('NFKC')
  assert(text.includes('PDF_CORE_MARKER'));assert(text.includes('中文'));await document.cleanup()
  const exportNote=await sys<{noteId:string}>('notes.create',{title:'导出隐私合成验收',body:'中文 NOTE_EXPORT_VISIBLE\n\n<!-- source-path: ../../INTERNAL_SOURCE_SENTINEL.md -->'})
  const notePdfPath=path.join(getWorkspacePath(),'.whywork/tmp/note-export-check.pdf')
  await sys('export.note_pdf',{noteId:exportNote.noteId,targetPath:notePdfPath})
  const notePdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(notePdfPath))}).promise
  const noteText=(await (await notePdf.getPage(1)).getTextContent()).items.map(x=>'str' in x?x.str:'').join('')
  assert(noteText.includes('NOTE_EXPORT_VISIBLE'));assert(!noteText.includes('INTERNAL_SOURCE_SENTINEL'));assert(!noteText.includes('source-path'));await notePdf.cleanup()
  const noteDocx=await sys<{path:string}>('office.note_docx',{noteId:exportNote.noteId})
  const JSZip=(await import('jszip')).default,archive=await JSZip.loadAsync(fs.readFileSync(resolveWorkspacePath(noteDocx.path)))
  const xml=await archive.file('word/document.xml')!.async('string')
  assert(xml.includes('NOTE_EXPORT_VISIBLE'));assert(!xml.includes('INTERNAL_SOURCE_SENTINEL'));assert(!xml.includes('source-path'))
  console.log('[CORE-CHECK] Actual note PDF/DOCX preserve content and omit internal source-path metadata')
  console.log('[CORE-CHECK] Files, notes, search, rollback, context, confirmation, secret storage verified in isolated workspace')
}
