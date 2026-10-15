import fs from 'node:fs'
import { wsJoin } from '../notes-file'
import { snapshotBeforeWrite } from '../../agent/vault'
import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { getDb } from '../client'
import {
  parseFrontmatter,
  readNoteFile,
  writeNoteFile,
  sha256,
  allocateNotePath,
  extractWikiTargets,
  serializeNote
} from '../notes-file'

/** notes/links/collections/FTS 仓储（类型化 prepared statements） */

export interface NoteRow {
  note_id: string
  title: string
  parsed_title: string | null
  summary: string | null
  keywords: string | null
  topic: string | null
  author: string | null
  note_type: string
  note_source: string
  relative_path: string
  resource_dir: string | null
  favorite: number
  pinned: number
  later: number
  processed: number
  restrictions: string | null
  content_hash: string | null
  created_at: number
  modified_at: number
  accessed_at: number
  deleted_at: number | null
}

export interface ListFilter {
  favorite?: boolean
  pinned?: boolean
  later?: boolean
  unprocessed?: boolean
  collectionId?: string
  deleted?: boolean
  type?: string
  source?: string
}

function d(): Database.Database {
  return getDb()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function listNotes(
  filter: ListFilter,
  sort: 'modified' | 'created' | 'accessed' | 'title',
  limit: number,
  offset: number,
  query?: string
): { items: NoteRow[]; total: number } {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.deleted) {
    where.push('deleted_at IS NOT NULL')
  } else {
    where.push('deleted_at IS NULL')
  }
  if (filter.favorite !== undefined) {
    where.push('favorite = @favorite')
    params.favorite = filter.favorite ? 1 : 0
  }
  if (filter.pinned !== undefined) {
    where.push('pinned = @pinned')
    params.pinned = filter.pinned ? 1 : 0
  }
  if (filter.later !== undefined) {
    where.push('later = @later')
    params.later = filter.later ? 1 : 0
  }
  if (filter.unprocessed !== undefined) {
    where.push('processed = @processed')
    params.processed = filter.unprocessed ? 0 : 1
  }
  if (filter.type) {
    where.push('note_type = @type')
    params.type = filter.type
  }
  if (filter.source) {
    where.push('note_source = @source')
    params.source = filter.source
  }
  if (query?.trim()) {
    const term=query.trim()
    params.match='"'+term.replaceAll('"','""')+'"'
    params.pattern='%'+term.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%'
    where.push(`(n.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH @match)
      OR n.rowid IN (SELECT rowid FROM notes_fts WHERE body LIKE @pattern ESCAPE '\\')
      OR n.title LIKE @pattern ESCAPE '\\' OR n.relative_path LIKE @pattern ESCAPE '\\')`)
  }
  let from = 'notes n'
  if (filter.collectionId) {
    from += ' JOIN note_collections nc ON nc.note_id = n.note_id'
    where.push('nc.collection_id = @collectionId')
    params.collectionId = filter.collectionId
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sortCol = { modified: 'modified_at', created: 'created_at', accessed: 'accessed_at', title: 'title' }[sort]
  const total = (
    d().prepare(`SELECT COUNT(*) c FROM ${from} ${whereSql}`).get(params) as { c: number }
  ).c
  const items = d()
    .prepare(
      `SELECT n.* FROM ${from} ${whereSql} ORDER BY n.pinned DESC, n.${sortCol} ${sort === 'title' ? 'ASC' : 'DESC'}, n.note_id ASC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as NoteRow[]
  return { items, total }
}

export function getNote(noteId: string): NoteRow | undefined {
  return d().prepare('SELECT * FROM notes WHERE note_id = ?').get(noteId) as NoteRow | undefined
}

export function getNoteByTitle(title: string, excludeNoteId?: string): NoteRow | undefined {
  const row = d()
    .prepare('SELECT * FROM notes WHERE deleted_at IS NULL AND (title = ? OR parsed_title = ?) ORDER BY modified_at DESC')
    .get(title, title) as NoteRow | undefined
  if (row && row.note_id !== excludeNoteId) return row
  return undefined
}

export interface CreateNoteInput {
  title?: string
  body?: string
  source?: string
  type?: string
  now?: number
}

export function createNote(input: CreateNoteInput, writeFile = true): NoteRow {
  const now = input.now ?? Date.now()
  const title = (input.title ?? '').trim() || '未命名笔记'
  const rel = allocateNotePath(title)
  const fm = { title, ...(input.source ? { source: input.source } : {}) }
  const content = serializeNote(fm, input.body ?? '')
  const note: NoteRow = {
    note_id: newId(),
    title,
    parsed_title: null,
    summary: null,
    keywords: null,
    topic: null,
    author: null,
    note_type: input.type ?? 'normal_note',
    note_source: input.source ?? 'manual',
    relative_path: rel,
    resource_dir: null,
    favorite: 0,
    pinned: 0,
    later: 0,
    processed: 0,
    restrictions: null,
    content_hash: sha256(content),
    created_at: now,
    modified_at: now,
    accessed_at: now,
    deleted_at: null
  }
  try {
    d().transaction(() => {
      if (writeFile) snapshotBeforeWrite(rel, 'create', {kind:'note',detail:{noteId:note.note_id}})
      if (writeFile) writeNoteFile(rel, content)
    d()
    .prepare(
      `INSERT INTO notes (note_id,title,note_type,note_source,relative_path,content_hash,created_at,modified_at,accessed_at)
       VALUES (@note_id,@title,@note_type,@note_source,@relative_path,@content_hash,@created_at,@modified_at,@accessed_at)`
    )
    .run(note as unknown as Record<string, unknown>)
  upsertFts(note.note_id)
  rebuildLinks(note.note_id, input.body ?? '')
  // 回填：其他笔记中指向本标题的未解析链接（DEVELOPMENT.md §9）
  d()
    .prepare(
      `UPDATE links SET target_note_id = ?
       WHERE target_text = ? AND target_note_id IS NULL AND source_note_id != ?`
    )
    .run(note.note_id, title, note.note_id)
    })()
  } catch(e) {
    if (writeFile && fs.existsSync(wsJoin(rel))) fs.unlinkSync(wsJoin(rel))
    throw e
  }
  return note
}

export function updateNoteBody(
  noteId: string,
  patch: { title?: string; body?: string }
): NoteRow {
  const note = getNote(noteId)
  if (!note) throw new Error(`笔记不存在: ${noteId}`)
  const raw = readNoteFile(note.relative_path)
  const { fm, body } = parseFrontmatter(raw)
  const newTitle = patch.title !== undefined ? patch.title.trim() || note.title : note.title
  const newBody = patch.body !== undefined ? patch.body : body
  fm.title = newTitle
  const content = serializeNote(fm, newBody)
  try {
    d().transaction(() => {
  snapshotBeforeWrite(note.relative_path, 'modify', {kind:'note',detail:{noteId}})
  writeNoteFile(note.relative_path, content)
  const now = Date.now()
  d()
    .prepare(
      `UPDATE notes SET title=?, summary=COALESCE(summary,''), content_hash=?, modified_at=?, accessed_at=? WHERE note_id=?`
    )
    .run(newTitle, sha256(content), now, now, noteId)
  upsertFts(noteId)
  if (patch.body !== undefined) rebuildLinks(noteId, newBody)
  else if (patch.title !== undefined) rebuildLinks(noteId, newBody ?? body)
    })()
  } catch(e) { writeNoteFile(note.relative_path, raw); throw e }
  const updated=getNote(noteId)!
  return updated
}

export function setNoteStatus(
  noteId: string,
  patch: { favorite?: boolean; pinned?: boolean; later?: boolean }
): void {
  const sets: string[] = []
  const params: Record<string, unknown> = { noteId, now: Date.now() }
  if (patch.favorite !== undefined) {
    sets.push('favorite=@favorite')
    params.favorite = patch.favorite ? 1 : 0
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned=@pinned')
    params.pinned = patch.pinned ? 1 : 0
  }
  if (patch.later !== undefined) {
    sets.push('later=@later')
    params.later = patch.later ? 1 : 0
  }
  if (sets.length === 0) return
  sets.push('accessed_at=@now')
  d().prepare(`UPDATE notes SET ${sets.join(', ')} WHERE note_id=@noteId`).run(params)
}

export function softDeleteNote(noteId: string, tombstoneRel: string): void {
  // 释放 relative_path（软删行改用 __deleted__/ 占位），避免同路径再导入触发 UNIQUE 冲突
  d()
    .prepare('UPDATE notes SET deleted_at=?, relative_path=? WHERE note_id=?')
    .run(Date.now(), `__deleted__/${noteId}`, noteId)
  removeFts(noteId)
  void tombstoneRel
}

export function restoreNote(noteId: string, restoredRel: string): void {
  d().prepare('UPDATE notes SET relative_path=?, deleted_at=NULL, modified_at=?, accessed_at=? WHERE note_id=?').run(
    restoredRel,
    Date.now(),
    Date.now(),
    noteId
  )
  const note = getNote(noteId)
  if (note) upsertFts(noteId)
}

export function hardDeleteNoteRow(noteId: string): void {
  removeFts(noteId)
  d().prepare('UPDATE links SET target_note_id=NULL WHERE target_note_id=?').run(noteId)
  d().prepare('DELETE FROM notes WHERE note_id=?').run(noteId)
}

// ---------- FTS ----------

/** unicode61 不切分 CJK：索引与查询统一在 CJK 字符间插入空格，使中文可按短语命中 */
export function cjkPad(s: string): string {
  return s.replace(/([\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])(?=[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])/g, '$1 ')
}

export function upsertFts(noteId: string): void {
  const note = getNote(noteId)
  if (!note) return
  let body = ''
  try {
    body = readNoteFile(note.relative_path)
  } catch {
    body = ''
  }
  const keywords = note.keywords ?? ''
  removeFts(noteId)
  d()
    .prepare(
      `INSERT INTO notes_fts(rowid, title, summary, keywords, body)
       SELECT rowid, ?, ?, ?, ? FROM notes WHERE note_id = ?`
    )
    .run(cjkPad(note.title), cjkPad(note.summary ?? ''), cjkPad(keywords), cjkPad(body), noteId)
}

export function removeFts(noteId: string): void {
  d()
    .prepare(`DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE note_id = ?)`)
    .run(noteId)
}

export interface SearchHit {
  noteId: string
  title: string
  snippet: string
  rank: number
  source?: 'fts' | 'filename' | 'like'
}

export function searchNotes(query: string, limit: number, opts: { excludeNoteId?: string } = {}): SearchHit[] {
  const out: SearchHit[] = []
  // FTS 查询：CJK 填充 + 短语包裹（防操作符注入）
  const safe = cjkPad(query).replaceAll('"', '""')
  const match = `"${safe}"`
  try {
    const rows = getDb()
      .prepare(
        `SELECT n.note_id AS noteId, n.title AS title,
                snippet(notes_fts, 3, '⟦', '⟧', '…', 16) AS snippet,
                bm25(notes_fts) AS rank
         FROM notes_fts f
         JOIN notes n ON n.rowid = f.rowid
         WHERE notes_fts MATCH ? AND n.deleted_at IS NULL AND n.note_id != COALESCE(?, '')
         ORDER BY rank LIMIT ?`
      )
      .all(match, opts.excludeNoteId ?? '', limit) as SearchHit[]
    for (const r of rows) r.source = 'fts'
    out.push(...rows)
  } catch {
    /* 非法 MATCH 语法走回退 */
  }
  // unicode61 does not segment CJK words. Search indexed body as a labelled
  // substring fallback, then append filename candidates without hiding FTS hits.
  const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const rows = d().prepare(`SELECT n.note_id AS noteId, n.title, f.body AS body,
    n.relative_path AS relativePath FROM notes n JOIN notes_fts f ON f.rowid=n.rowid
    WHERE n.deleted_at IS NULL AND n.note_id != COALESCE(?, '')
    AND (f.body LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\' OR n.relative_path LIKE ? ESCAPE '\\')
    ORDER BY n.modified_at DESC LIMIT ?`).all(opts.excludeNoteId ?? '', pattern, pattern, pattern, limit) as
    {noteId:string;title:string;body:string;relativePath:string}[]
  const seen = new Set(out.map(h => h.noteId))
  for (const r of rows) {
    if (seen.has(r.noteId) || out.length >= limit) continue
    const at = r.body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    out.push({ noteId:r.noteId, title:r.title, rank:0,
      snippet: at >= 0 ? r.body.slice(Math.max(0, at-50), at+query.length+100) : '',
      source: at >= 0 ? 'like' : 'filename' })
    seen.add(r.noteId)
  }
  return out
}

// ---------- 链接 ----------

export function rebuildLinks(noteId: string, body: string): void {
  const targets = extractWikiTargets(body)
  const existing = d()
    .prepare('SELECT id, target_text FROM links WHERE source_note_id = ?')
    .all(noteId) as { id: string; target_text: string }[]
  const existingMap = new Map(existing.map((r) => [r.target_text, r.id]))
  const targetSet = new Set(targets)
  for (const [text, id] of existingMap) {
    if (!targetSet.has(text)) d().prepare('DELETE FROM links WHERE id = ?').run(id)
  }
  const insTarget = d().prepare(
    'INSERT OR IGNORE INTO links (id, source_note_id, target_note_id, target_text, created_at) VALUES (?,?,?,?,?)'
  )
  const updTarget = d().prepare('UPDATE links SET target_note_id = ? WHERE source_note_id = ? AND target_text = ?')
  for (const text of targets) {
    if (!existingMap.has(text)) {
      const target = getNoteByTitle(text, noteId)
      insTarget.run(newId(), noteId, target?.note_id ?? null, text, Date.now())
    } else {
      const target = getNoteByTitle(text, noteId)
      updTarget.run(target?.note_id ?? null, noteId, text)
    }
  }
}

export function reResolveAllLinks(): void {
  d().exec('UPDATE links SET target_note_id = NULL')
  const rows = d().prepare('SELECT DISTINCT target_text FROM links').all() as { target_text: string }[]
  for (const r of rows) {
    const target = getNoteByTitle(r.target_text)
    if (target) {
      d()
        .prepare('UPDATE links SET target_note_id = ? WHERE target_text = ? AND source_note_id != ?')
        .run(target.note_id, r.target_text, target.note_id)
    }
  }
}

export function listLinks(noteId: string): { out: LinkRow[]; in: LinkRow[] } {
  const out = d()
    .prepare('SELECT * FROM links WHERE source_note_id = ?')
    .all(noteId) as LinkRow[]
  const inc = d()
    .prepare('SELECT * FROM links WHERE target_note_id = ?')
    .all(noteId) as LinkRow[]
  return { out, in: inc }
}

export interface LinkRow {
  id: string
  source_note_id: string
  target_note_id: string | null
  target_text: string
  created_at: number
}

// ---------- 集合 ----------

export interface CollectionRow {
  id: string
  title: string
  icon: string | null
  sort: number
  created_at: number
}

export function listCollections(): CollectionRow[] {
  return d().prepare('SELECT * FROM collections ORDER BY sort, created_at').all() as CollectionRow[]
}

export function createCollection(title: string, icon?: string): CollectionRow {
  const row: CollectionRow = {
    id: newId(),
    title,
    icon: icon ?? null,
    sort: 0,
    created_at: Date.now()
  }
  d()
    .prepare('INSERT INTO collections (id,title,icon,sort,created_at) VALUES (@id,@title,@icon,@sort,@created_at)')
    .run(row as unknown as Record<string, unknown>)
  return row
}

export function getCollectionByTitle(title: string): CollectionRow | undefined {
  return d().prepare('SELECT * FROM collections WHERE title = ?').get(title) as CollectionRow | undefined
}

export function deleteCollection(collectionId: string): void {
  d().prepare('DELETE FROM collections WHERE id = ?').run(collectionId)
}

export function renameCollection(collectionId: string, title: string): void {
  d().prepare('UPDATE collections SET title = ? WHERE id = ?').run(title, collectionId)
}

export function addNoteToCollection(noteId: string, collectionId: string): void {
  d()
    .prepare(
      'INSERT OR IGNORE INTO note_collections (note_id, collection_id, added_at) VALUES (?,?,?)'
    )
    .run(noteId, collectionId, Date.now())
}

export function removeNoteFromCollection(noteId: string, collectionId: string): void {
  d()
    .prepare('DELETE FROM note_collections WHERE note_id = ? AND collection_id = ?')
    .run(noteId, collectionId)
}

export function listNoteCollections(noteId: string): CollectionRow[] {
  return d()
    .prepare(
      `SELECT c.* FROM collections c JOIN note_collections nc ON nc.collection_id = c.id
       WHERE nc.note_id = ? ORDER BY c.sort`
    )
    .all(noteId) as CollectionRow[]
}

export function matchesFilter(n: NoteRow, f: ListFilter): boolean {
  if ((n.deleted_at !== null) !== !!f.deleted) return false
  for (const key of ['favorite','pinned','later'] as const) {
    if (f[key] !== undefined && !!n[key] !== f[key]) return false
  }
  if (f.unprocessed !== undefined && !n.processed !== f.unprocessed) return false
  if (f.type && n.note_type !== f.type) return false
  if (f.source && n.note_source !== f.source) return false
  if (f.collectionId && !d().prepare('SELECT 1 FROM note_collections WHERE note_id=? AND collection_id=?').get(n.note_id,f.collectionId)) return false
  return true
}
