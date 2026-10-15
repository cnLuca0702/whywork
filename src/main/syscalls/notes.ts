import {searchLocalNotes} from './search'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { register, type SysContext } from './registry'
import { getWorkspacePath } from './app'
import * as repo from '../db/repos/notes'
import { readNoteFile, wsJoin, parseFrontmatter, allocateNotePath } from '../db/notes-file'
import { getDb } from '../db/client'
import { snapshotBeforeWrite } from '../agent/vault'

/** notes 域（DEVELOPMENT.md §6.1；notes.summarize 于 M3 提供） */

async function getDbWrite(): Promise<{ run: (noteId: string, rel: string, mime: string, size: number) => void }> {
  const stmt = getDb().prepare(
    'INSERT INTO resources (resource_id, note_id, relative_path, mime, size, created_at) VALUES (?,?,?,?,?,?)'
  )
  return {
    run: (noteId, rel, mime, size) => stmt.run(crypto.randomUUID(), noteId, rel, mime, size, Date.now())
  }
}

const boolFilter = z.object({
  favorite: z.boolean().optional(),
  pinned: z.boolean().optional(),
  later: z.boolean().optional(),
  unprocessed: z.boolean().optional(),
  collectionId: z.string().optional(),
  deleted: z.boolean().optional(),
  type: z.string().optional(),
  source: z.string().optional()
})

function toListItem(n: repo.NoteRow) {
  return {
    noteId: n.note_id,
    title: n.title,
    summary: n.summary ?? '',
    noteType: n.note_type,
    noteSource: n.note_source,
    favorite: !!n.favorite,
    pinned: !!n.pinned,
    later: !!n.later,
    processed: !!n.processed,
    modifiedAt: n.modified_at,
    createdAt: n.created_at,
    relativePath: n.relative_path,
    deleted: n.deleted_at !== null
  }
}

function getBody(note: repo.NoteRow): string {
  try {
    return parseFrontmatter(readNoteFile(note.relative_path)).body
  } catch {
    return ''
  }
}

function noteDetail(noteId: string) {
  const note = repo.getNote(noteId)
  if (!note) throw new Error(`笔记不存在: ${noteId}`)
  const links = repo.listLinks(noteId)
  return {
    note: toListItem(note),
    body: getBody(note),
    keywords: note.keywords,
    topic: note.topic,
    author: note.author,
    parsedTitle: note.parsed_title,
    links: {
      out: links.out.map((l) => ({ id: l.id, targetText: l.target_text, targetNoteId: l.target_note_id })),
      in: links.in.map((l) => ({ id: l.id, sourceNoteId: l.source_note_id, sourceTitle: repo.getNote(l.source_note_id)?.title ?? '' }))
    },
    collections: repo.listNoteCollections(noteId)
  }
}

export function registerNotesDomain(): void {
  register('notes', {
    list: {
      schema: z.object({
        filter: boolFilter.optional(),
        query: z.string().max(200).optional(),
        searchMode: z.enum(['fts','text']).optional(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        sort: z.enum(['modified', 'created', 'accessed', 'title']).default('modified')
      }),
      handler: async (p: {
        filter?: repo.ListFilter
        query?: string
        searchMode?: 'fts'|'text'
        limit: number
        offset: number
        sort: 'modified' | 'created' | 'accessed' | 'title'
      }) => {
        if(p.query?.trim()&&p.searchMode){
          const r=await searchLocalNotes(p.query.trim(),p.searchMode,p.filter,p.limit)
          return{items:r.items.map(h=>({...toListItem(h.note),searchSnippet:h.snippet,searchSource:h.source})),total:r.total,warning:r.warning}
        }
        const r = repo.listNotes(p.filter ?? {}, p.sort, p.limit, p.offset, p.query)
        return { items: r.items.map(toListItem), total: r.total }
      }
    },

    get: {
      schema: z.object({ noteId: z.string().min(1) }),
      handler: async (p: { noteId: string }) => noteDetail(p.noteId)
    },

    create: {
      schema: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        source: z.string().optional(),
        type: z.string().optional(),
        collectionTitles: z.array(z.string()).optional()
      }),
      handler: async (
        p: { title?: string; body?: string; source?: string; type?: string; collectionTitles?: string[] },
        ctx: SysContext
      ) => {
        const note = repo.createNote({ title: p.title, body: p.body, source: p.source, type: p.type })
        for (const t of p.collectionTitles ?? []) {
          const col = repo.getCollectionByTitle(t) ?? repo.createCollection(t)
          repo.addNoteToCollection(note.note_id, col.id)
        }
        ctx.emit('notes.changed', { kind: 'create', noteId: note.note_id })
        return { noteId: note.note_id }
      }
    },

    update: {
      schema: z.object({ noteId: z.string().min(1), title: z.string().optional(), body: z.string().optional() }),
      handler: async (p: { noteId: string; title?: string; body?: string }, ctx: SysContext) => {
        const note = repo.getNote(p.noteId)
        if (!note) throw new Error(`笔记不存在: ${p.noteId}`)
        repo.updateNoteBody(p.noteId, { title: p.title, body: p.body })
        ctx.emit('notes.changed', { kind: 'update', noteId: p.noteId })
        return { ok: true }
      }
    },

    delete: {
      schema: z.object({ noteId: z.string().min(1) }),
      handler: async (p: { noteId: string }, ctx: SysContext) => {
        const note = repo.getNote(p.noteId)
        if (!note) throw new Error(`笔记不存在: ${p.noteId}`)
        if (note.deleted_at) return { ok: true }
        const change = snapshotBeforeWrite(note.relative_path, 'delete', {
          kind: 'note',
          detail: { noteId: p.noteId, title: note.title, body: getBody(note) }
        })
        repo.softDeleteNote(p.noteId, change.snapshot_path ?? '')
        ctx.emit('notes.changed', { kind: 'delete', noteId: p.noteId })
        return { ok: true }
      }
    },

    restore: {
      schema: z.object({ noteId: z.string().min(1) }),
      handler: async (p: { noteId: string }, ctx: SysContext) => {
        const note = repo.getNote(p.noteId)
        if (!note || !note.deleted_at) throw new Error('笔记不在回收站中')
        // 找最近一次 delete 的墓碑记录还原文件
        const row = getDb()
          .prepare(
            `SELECT * FROM vault_changes WHERE kind='note' AND op='delete' AND detail LIKE ? AND rolled_back=0 ORDER BY ts DESC LIMIT 1`
          )
          .get(`%"noteId":"${p.noteId}"%`) as { change_id: string; snapshot_path: string | null; path: string } | undefined
        if (!row?.snapshot_path || !fs.existsSync(wsJoin(row.snapshot_path))) throw new Error('恢复快照缺失，未更改回收站状态')
        // 软删时 relative_path 已改为 __deleted__/ 占位：恢复时按标题重新分配
        let restoredRel = note.relative_path.startsWith('__deleted__/') ? allocateNotePath(note.title) : note.relative_path
        if (row?.snapshot_path) {
          const tombAbs = wsJoin(row.snapshot_path)
          if (fs.existsSync(tombAbs)) {
            // 原路径若被占用则重新分配
            const targetAbs = wsJoin(note.relative_path)
            if (fs.existsSync(targetAbs)) {
              restoredRel = allocateNotePath(note.title)
            }
            fs.mkdirSync(path.dirname(wsJoin(restoredRel)), { recursive: true })
            fs.renameSync(tombAbs, wsJoin(restoredRel))
            getDb()
              .prepare('UPDATE vault_changes SET rolled_back=1 WHERE change_id=?')
              .run(row.change_id)
          }
        }
        repo.restoreNote(p.noteId, restoredRel)
        ctx.emit('notes.changed', { kind: 'restore', noteId: p.noteId })
        return { ok: true, relativePath: restoredRel }
      }
    },

    set_status: {
      schema: z.object({
        noteId: z.string().min(1),
        favorite: z.boolean().optional(),
        pinned: z.boolean().optional(),
        later: z.boolean().optional()
      }),
      handler: async (
        p: { noteId: string; favorite?: boolean; pinned?: boolean; later?: boolean },
        ctx: SysContext
      ) => {
        repo.setNoteStatus(p.noteId, { favorite: p.favorite, pinned: p.pinned, later: p.later })
        ctx.emit('notes.changed', { kind: 'status', noteId: p.noteId })
        return { ok: true }
      }
    },

    search: {
      schema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(30),
        excludeNoteId: z.string().optional()
      }),
      handler: async (p: { query: string; limit: number; excludeNoteId?: string }) => ({
        items: repo.searchNotes(p.query, p.limit, { excludeNoteId: p.excludeNoteId }).map((h) => ({
          ...h,
          title: repo.getNote(h.noteId)?.title ?? h.title
        }))
      })
    },

    links_list: {
      schema: z.object({ noteId: z.string().min(1) }),
      handler: async (p: { noteId: string }) => {
        const r = repo.listLinks(p.noteId)
        return {
          out: r.out.map((l) => ({ id: l.id, targetText: l.target_text, targetNoteId: l.target_note_id })),
          in: r.in
        }
      }
    },

    links_resolve: {
      schema: z.object({ sourceNoteId: z.string().min(1), targetText: z.string().min(1) }),
      handler: async (p: { sourceNoteId: string; targetText: string }) => {
        const target = repo.getNoteByTitle(p.targetText, p.sourceNoteId)
        return { targetNoteId: target?.note_id ?? null }
      }
    },

    attach_image: {
      schema: z.object({ noteId: z.uuid(), dataUrl: z.string().min(8).max(40_000_000) }),
      handler: async (p: { noteId: string; dataUrl: string }) => {
        if (!repo.getNote(p.noteId)) throw new Error('笔记不存在')
        const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(p.dataUrl)
        if (!m || !m[1] || !m[2]) throw new Error('非法图片 dataUrl')
        const mime = m[1]
        const buf = Buffer.from(m[2], 'base64')
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png'
        const rel = path.join('resources', p.noteId, `${crypto.randomUUID()}.${ext}`)
        const abs = wsJoin(rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, buf)
        ;(await getDbWrite()).run(p.noteId, rel, mime, buf.length)
        return { url: `whywork-res://${rel}`, size: buf.length }
      }
    },

    attach_audio: {
      schema: z.object({ noteId: z.string().optional(), dataUrl: z.string().min(8), ext: z.enum(['m4a','wav','mp3','webm','ogg','flac','aiff']).default('m4a') }),
      handler: async (p: { noteId?: string; dataUrl: string; ext: string }) => {
        const m = /^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i.exec(p.dataUrl)
        if (!m || !m[1]) throw new Error('非法音频 dataUrl')
        const buf = Buffer.from(m[1], 'base64')
        const rel = path.join('resources', 'recordings', `${crypto.randomUUID()}.${p.ext}`)
        const abs = wsJoin(rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, buf)
        return { url: `whywork-res://${rel}`, path: rel, size: buf.length }
      }
    },

    collections_list: {
      handler: async () => ({ items: repo.listCollections() })
    },
    collections_create: {
      schema: z.object({ title: z.string().min(1), icon: z.string().optional() }),
      handler: async (p: { title: string; icon?: string }, ctx: SysContext) => {
        const existing = repo.getCollectionByTitle(p.title)
        if (existing) return existing
        const row = repo.createCollection(p.title, p.icon)
        ctx.emit('notes.changed', { kind: 'collections' })
        return row
      }
    },
    collections_rename: {
      schema: z.object({ collectionId: z.string().min(1), title: z.string().min(1) }),
      handler: async (p: { collectionId: string; title: string }) => {
        repo.renameCollection(p.collectionId, p.title)
        return { ok: true }
      }
    },
    collections_delete: {
      schema: z.object({ collectionId: z.string().min(1) }),
      handler: async (p: { collectionId: string }, ctx: SysContext) => {
        repo.deleteCollection(p.collectionId)
        ctx.emit('notes.changed', { kind: 'collections' })
        return { ok: true }
      }
    },
    collections_add_note: {
      schema: z.object({
        noteId: z.string().min(1),
        collectionId: z.string().optional(),
        collectionTitle: z.string().optional()
      }),
      handler: async (p: { noteId: string; collectionId?: string; collectionTitle?: string }) => {
        let id = p.collectionId
        if (!id && p.collectionTitle) {
          id = (repo.getCollectionByTitle(p.collectionTitle) ?? repo.createCollection(p.collectionTitle)).id
        }
        if (!id) throw new Error('需要 collectionId 或 collectionTitle')
        repo.addNoteToCollection(p.noteId, id)
        return { ok: true, collectionId: id }
      }
    },
    collections_remove_note: {
      schema: z.object({ noteId: z.string().min(1), collectionId: z.string().min(1) }),
      handler: async (p: { noteId: string; collectionId: string }) => {
        repo.removeNoteFromCollection(p.noteId, p.collectionId)
        return { ok: true }
      }
    }
  })
}

/** app.rebuild_index 用：扫描 notes/ 重建索引（文件为准） */
export function rebuildIndex(): { scanned: number; created: number; updated: number; removed: number } {
  // wsJoin 返回 realpath（/var→/private/var）；相对路径必须与同一基准计算，否则产生 ../ 前缀
  const wsBase = fs.realpathSync(getWorkspacePath())
  const notesDir = path.join(wsBase, 'notes')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name)
      if(fs.lstatSync(abs).isSymbolicLink())continue
      if (fs.statSync(abs).isDirectory()) walk(abs)
      else if (name.endsWith('.md')) files.push(path.relative(wsBase, abs))
    }
  }
  if (fs.existsSync(notesDir)) walk(notesDir)

  const all = getDb().prepare('SELECT * FROM notes').all() as repo.NoteRow[]
  const byPath = new Map(all.map((r) => [r.relative_path, r]))

  let created = 0
  let updated = 0
  let removed = 0
  const now = Date.now()
  for (const rel of files) {
    const raw = readNoteFile(rel)
    const { fm, body } = parseFrontmatter(raw)
    const title = fm.title ?? path.basename(rel, '.md')
    const existing = byPath.get(rel)
    if (existing) {
      getDb()
        .prepare('UPDATE notes SET title=?, modified_at=?, accessed_at=? WHERE note_id=?')
        .run(title, now, now, existing.note_id)
      repo.upsertFts(existing.note_id)
      repo.rebuildLinks(existing.note_id, body)
      updated++
    } else {
      const noteId = repo.newId()
      getDb()
        .prepare(
          `INSERT INTO notes (note_id,title,note_source,relative_path,content_hash,created_at,modified_at,accessed_at)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .run(noteId, title, fm.source ?? 'manual', rel, '', now, now, now)
      repo.upsertFts(noteId)
      repo.rebuildLinks(noteId, body)
      created++
    }
  }
  const fileSet = new Set(files)
  for (const r of all) {
    if (!fileSet.has(r.relative_path) && !r.deleted_at) {
      repo.softDeleteNote(r.note_id, '')
      removed++
    }
  }
  repo.reResolveAllLinks()
  return { scanned: files.length, created, updated, removed }
}
