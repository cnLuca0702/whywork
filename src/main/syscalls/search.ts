import {ocrImages} from '../services/ocr-index'
import {dialog} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {z} from 'zod'
import {register,invokeSys,type SysContext} from './registry'
import {CandidateScope,literalMatch} from '../services/file-candidates'
import {getDb} from '../db/client'
import {getWorkspacePath} from './app'
import {resolveWorkspacePath} from '../security/paths'
import {parseFrontmatter} from '../db/notes-file'
import * as repo from '../db/repos/notes'
const grants=new Map<string,{scope:CandidateScope;workspace:string;owner:number}>()
const imports=new Map<string,Promise<{noteIds:string[];errors:string[]}>>()
function userOnly(ctx:SysContext){if(ctx.source!=='user')throw new Error('目录搜索必须由用户在界面发起')}
function grant(id:string,ctx:SysContext){userOnly(ctx);const g=grants.get(id);if(!g||g.workspace!==getWorkspacePath()||g.owner!==(ctx.win()?.id??-1))throw new Error('目录授权已失效，请重新选择');return g}
function ensureOrigins(){getDb().exec('CREATE TABLE IF NOT EXISTS search_imported_files(file TEXT PRIMARY KEY,note_id TEXT NOT NULL)')}
function knownFiles():Set<string>{
  ensureOrigins();const known=new Set<string>()
  for(const r of getDb().prepare('SELECT relative_path FROM notes').all() as {relative_path:string}[])known.add(path.resolve(getWorkspacePath(),r.relative_path))
  for(const r of getDb().prepare('SELECT file FROM search_imported_files s JOIN notes n ON n.note_id=s.note_id WHERE n.deleted_at IS NULL').all() as {file:string}[])known.add(r.file)
  if(getDb().prepare("SELECT name FROM sqlite_master WHERE name='watch_items'").get())for(const r of getDb().prepare('SELECT file,note_ids FROM watch_items').all() as {file:string;note_ids:string}[]){try{if((JSON.parse(r.note_ids) as string[]).some(id=>repo.getNote(id)?.deleted_at===null))known.add(r.file)}catch{/* invalid provenance excluded */}}
  return known
}
export async function searchLocalNotes(query:string,mode:'fts'|'text',filter:repo.ListFilter={},limit=100,offset=0,sort?:'modified'|'created'|'accessed'|'title'){
  const candidates=repo.listNotes(filter,'modified',5001,0).items,warning:string[]=[]
  if(candidates.length>5000)warning.push('仅检查最近5000条符合筛选的笔记，请缩小范围')
  const allowed=candidates.slice(0,5000),items:{note:repo.NoteRow;snippet:string;source:string;score:number}[]=[]
  if(mode==='fts'){
    const match='"'+repo.cjkPad(query).replaceAll('"','""')+'"'
    const matches=getDb().prepare(`SELECT n.note_id AS id,snippet(notes_fts,3,'⟦','⟧','…',24) AS snippet,bm25(notes_fts) AS score FROM notes_fts JOIN notes n ON n.rowid=notes_fts.rowid WHERE notes_fts MATCH ? ORDER BY score LIMIT 5001`).all(match) as {id:string;snippet:string;score:number}[]
    const byId=new Map(allowed.map(n=>[n.note_id,n]))
    for(const hit of matches){const note=byId.get(hit.id);if(note)items.push({note,snippet:repo.cjkUnpad(hit.snippet.replace(/<!--[\s\S]*$/,'')).trim(),source:'FTS5 索引',score:hit.score})}
    if(matches.length>5000)warning.push('索引命中过多，显示有限结果')
  }else{
    let bytes=0,skipped=0
    for(const note of allowed){
      try{
        const abs=resolveWorkspacePath(note.relative_path),stat=await fs.stat(abs)
        if(stat.size>1024*1024||bytes+stat.size>20*1024*1024){skipped++;continue}
        bytes+=stat.size
        const body=parseFrontmatter(await fs.readFile(abs,'utf8')).body.replace(/\n*<!-- source-path:[\s\S]*?-->\s*$/,'')
        const hit=literalMatch(note.title,body,query),imageHit=hit?null:literalMatch('',ocrImages(note.note_id).map(i=>i.ocrText).join('\n'),query);const found=hit??imageHit;if(found)items.push({note,snippet:(imageHit?'图片文字：':'')+found.snippet,source:imageHit?'图片文字':'本地正文 · 逐词匹配',score:found.score})
      }catch{skipped++}
    }
    items.sort((a,b)=>b.score-a.score||b.note.modified_at-a.note.modified_at)
    if(skipped)warning.push(`${skipped}条因文件不可读、单篇超过1MB或本次20MB上限未检查`)
  }
  if(sort)items.sort((a,b)=>sort==='title'?a.note.title.localeCompare(b.note.title):b.note[sort==='created'?'created_at':sort==='accessed'?'accessed_at':'modified_at']-a.note[sort==='created'?'created_at':sort==='accessed'?'accessed_at':'modified_at'])
  return{items:items.slice(offset,offset+limit),total:items.length,warning:warning.join('；'),mode}
}
export function registerSearchDomain(){register('search',{
  choose_folder:{handler:async(_p,ctx)=>{
    userOnly(ctx);const win=ctx.win();if(!win)throw new Error('需要用户窗口')
    const r=await dialog.showOpenDialog(win,{title:'仅在此目录查找未索引文件名（不读取正文、不自动导入）',properties:['openDirectory']})
    if(r.canceled||!r.filePaths[0])return{canceled:true}
    const scope=await CandidateScope.create(r.filePaths[0]),id=crypto.randomUUID()
    for(const [key,g]of grants)if(g.owner===win.id)grants.delete(key)
    grants.set(id,{scope,workspace:getWorkspacePath(),owner:win.id});return{canceled:false,id,path:scope.root}
  }},
  revoke:{schema:z.object({id:z.string()}),handler:async(p:{id:string},ctx)=>{grant(p.id,ctx);grants.delete(p.id);return{ok:true}}},
  candidates:{schema:z.object({id:z.string(),query:z.string().trim().min(1).max(200)}),handler:async(p:{id:string;query:string},ctx)=>grant(p.id,ctx).scope.find(p.query,knownFiles())},
  import_candidate:{schema:z.object({id:z.string(),relativePath:z.string()}),handler:async(p:{id:string;relativePath:string},ctx)=>{
    const g=grant(p.id,ctx),abs=await g.scope.resolve(p.relativePath)
    grant(p.id,ctx)
    const key=JSON.stringify([g.workspace,abs]),pending=imports.get(key)
    if(pending)return pending
    const operation=(async()=>{
    ensureOrigins();const prior=getDb().prepare('SELECT n.note_id FROM search_imported_files s JOIN notes n ON n.note_id=s.note_id WHERE s.file=? AND n.deleted_at IS NULL').get(abs) as {note_id:string}|undefined
    if(prior)return{noteIds:[prior.note_id],errors:[]}
    const r=await invokeSys('app.import',{paths:[abs]},ctx);if(!r.ok)throw new Error(r.error.message)
    const data=r.data as {noteIds:string[];errors:string[]}
    if(data.noteIds[0])getDb().prepare('INSERT OR REPLACE INTO search_imported_files(file,note_id) VALUES(?,?)').run(abs,data.noteIds[0])
    return data
    })()
    imports.set(key,operation)
    try{return await operation}finally{imports.delete(key)}
  }}
})}
