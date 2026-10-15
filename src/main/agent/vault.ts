import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDb } from '../db/client'
import { wsJoin, parseFrontmatter, sha256 } from '../db/notes-file'
import { executionContext } from './context'
import { upsertFts, removeFts, rebuildLinks, reResolveAllLinks } from '../db/repos/notes'
export interface VaultChange {
  change_id:string;chat_id:string|null;ts:number;kind:'file'|'note';
  op:'create'|'modify'|'delete'|'rename';path:string;snapshot_path:string|null;
  detail:string|null;rolled_back:number
}
export function snapshotBeforeWrite(relPath:string,op:VaultChange['op'],
  opts:{chatId?:string|null;kind?:'file'|'note';detail?:unknown;newPath?:string}={}):VaultChange {
  const db=getDb(), changeId=crypto.randomUUID(),abs=wsJoin(relPath)
  const kind=opts.kind??'file'
  const detail = {...(opts.detail && typeof opts.detail==='object' ? opts.detail : {}),
    ...(op==='rename'?{newPath:opts.newPath}:{})} as Record<string,unknown>
  if (kind==='note' && op!=='create') {
    const note=db.prepare('SELECT * FROM notes WHERE relative_path=?').get(relPath) as {note_id:string}|undefined
    if (note) {
      detail.previousNote=note
      detail.previousCollections=db.prepare('SELECT * FROM note_collections WHERE note_id=?').all(note.note_id)
      detail.previousResources=db.prepare('SELECT * FROM resources WHERE note_id=?').all(note.note_id)
    }
  }
  let snapshotRel:string|null=null
  if ((op==='modify'||op==='delete') && fs.existsSync(abs)) {
    snapshotRel=path.join('.whywork','vault',op==='delete'?'tombstones':'snapshots',changeId+path.extname(relPath))
    fs.mkdirSync(path.dirname(wsJoin(snapshotRel)),{recursive:true})
    // Keep original until the durable log exists; compensate on insert failure.
    fs.copyFileSync(abs,wsJoin(snapshotRel))
  }
  const row:VaultChange={change_id:changeId,chat_id:opts.chatId??executionContext.getStore()?.chatId??null,
    ts:Date.now(),kind,op,path:relPath,snapshot_path:snapshotRel,detail:JSON.stringify(detail),rolled_back:0}
  try {
    db.prepare(`INSERT INTO vault_changes(change_id,chat_id,ts,kind,op,path,snapshot_path,detail,rolled_back)
      VALUES(@change_id,@chat_id,@ts,@kind,@op,@path,@snapshot_path,@detail,@rolled_back)`).run(row)
    if(op==='delete' && snapshotRel) fs.unlinkSync(abs)
  } catch(e) {
    db.prepare('DELETE FROM vault_changes WHERE change_id=?').run(changeId)
    if(snapshotRel && fs.existsSync(wsJoin(snapshotRel))) fs.unlinkSync(wsJoin(snapshotRel))
    throw e
  }
  return row
}
export function listChanges(chatId?:string):VaultChange[] {
  return (chatId?getDb().prepare('SELECT * FROM vault_changes WHERE chat_id=? ORDER BY rowid').all(chatId):
    getDb().prepare('SELECT * FROM vault_changes ORDER BY rowid DESC LIMIT 500').all()) as VaultChange[]
}
export function rollbackChange(changeId:string):boolean {
  const db=getDb(),row=db.prepare('SELECT * FROM vault_changes WHERE change_id=?').get(changeId) as VaultChange|undefined
  if(!row||row.rolled_back)return false
  if(db.prepare(`SELECT 1 FROM vault_changes WHERE path=? AND rolled_back=0
    AND rowid>(SELECT rowid FROM vault_changes WHERE change_id=?)`).get(row.path,changeId))
    throw new Error('存在较新的变更，请先回滚后续变更')
  const detail=JSON.parse(row.detail??'{}')??{},dest=wsJoin(row.path)
  const snapshot=row.snapshot_path?wsJoin(row.snapshot_path):null
  if((row.op==='modify'||row.op==='delete')&&(!snapshot||!fs.existsSync(snapshot))) throw new Error('快照缺失，未执行回滚')
  if(row.op==='delete'&&fs.existsSync(dest))throw new Error('目标路径已被占用，未执行回滚')
  const note=db.prepare('SELECT note_id,content_hash FROM notes WHERE relative_path=?').get(row.path) as
    {note_id:string;content_hash:string|null}|undefined
  if(note&&fs.existsSync(dest)&&note.content_hash&&sha256(fs.readFileSync(dest,'utf8'))!==note.content_hash)
    throw new Error('文件包含未入库修改，未执行回滚')
  let source=dest
  if(row.op==='rename') {
    if(!detail.newPath)throw new Error('缺少重命名记录')
    source=wsJoin(detail.newPath)
    if(!fs.existsSync(source)||fs.existsSync(dest))throw new Error('重命名路径冲突或源文件缺失')
  }
  const before=fs.existsSync(source)?fs.readFileSync(source):null
  fs.mkdirSync(path.dirname(dest),{recursive:true})
  try {
    db.transaction(()=>{
      if(row.op==='create') { if(fs.existsSync(dest))fs.unlinkSync(dest) }
      else if(row.op==='rename')fs.renameSync(source,dest)
      else fs.copyFileSync(snapshot!,dest)
      if(row.kind==='note') {
        const previous=detail.previousNote as Record<string,unknown>|undefined
        if(note)removeFts(note.note_id)
        if(row.op==='create'&&note) {
          db.prepare('UPDATE links SET target_note_id=NULL WHERE target_note_id=?').run(note.note_id)
          db.prepare('DELETE FROM notes WHERE note_id=?').run(note.note_id)
        }
        else if(previous) {
          const columns=Object.keys(previous)
          const exists=db.prepare('SELECT 1 FROM notes WHERE note_id=?').get(previous.note_id)
          if(exists)db.prepare(`UPDATE notes SET ${columns.filter(k=>k!=='note_id').map(k=>k+'=@'+k).join(',')} WHERE note_id=@note_id`).run(previous)
          else db.prepare(`INSERT INTO notes(${columns.join(',')}) VALUES(${columns.map(k=>'@'+k).join(',')})`).run(previous)
          const id=previous.note_id as string
          db.prepare('DELETE FROM note_collections WHERE note_id=?').run(id)
          for(const c of detail.previousCollections??[]) {
            if(db.prepare('SELECT 1 FROM collections WHERE id=?').get(c.collection_id))
              db.prepare('INSERT INTO note_collections(note_id,collection_id,added_at) VALUES(@note_id,@collection_id,@added_at)').run(c)
          }
          db.prepare('DELETE FROM resources WHERE note_id=?').run(id)
          for(const r of detail.previousResources??[]) {
            const keys=Object.keys(r)
            db.prepare(`INSERT INTO resources(${keys.join(',')}) VALUES(${keys.map(k=>'@'+k).join(',')})`).run(r)
          }
          upsertFts(id); rebuildLinks(id,parseFrontmatter(fs.readFileSync(dest,'utf8')).body)
        } else if(note) {
          const raw=fs.readFileSync(dest,'utf8'),parsed=parseFrontmatter(raw)
          db.prepare('UPDATE notes SET title=?,content_hash=?,deleted_at=NULL WHERE note_id=?').run(parsed.fm.title??'',sha256(raw),note.note_id)
          upsertFts(note.note_id);rebuildLinks(note.note_id,parsed.body)
        }
        reResolveAllLinks()
      }
      db.prepare('UPDATE vault_changes SET rolled_back=1 WHERE change_id=?').run(changeId)
    })()
  } catch(e) {
    if(row.op==='rename'&&fs.existsSync(dest))fs.renameSync(dest,source)
    else if(before)fs.writeFileSync(dest,before)
    else if(fs.existsSync(dest))fs.unlinkSync(dest)
    throw e
  }
  return true
}
export function rollbackChat(chatId:string):number {
  const rows=getDb().prepare('SELECT change_id FROM vault_changes WHERE chat_id=? AND rolled_back=0 ORDER BY rowid DESC').all(chatId) as {change_id:string}[]
  let n=0; for(const r of rows)if(rollbackChange(r.change_id))n++
  return n
}
