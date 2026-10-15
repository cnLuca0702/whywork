import { resolveWorkspacePath } from '../security/paths'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getWorkspacePath } from '../syscalls/app'
import { getDb } from './client'

/** 笔记文件的 frontmatter 与磁盘读写（正文唯一真身在 md 文件，DEVELOPMENT.md §5.2 不变式） */

export interface Frontmatter {
  title?: string
  source?: string
  [k: string]: string | undefined
}

export function wsJoin(rel: string): string {
  return resolveWorkspacePath(rel,true)
}

export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  raw=raw.replaceAll('\r\n','\n')
  if (!raw.startsWith('---\n')) return { fm: {}, body: raw }
  const marker=/\n---(?:\n|$)/.exec(raw.slice(4))
  const end=marker ? marker.index+4 : -1
  if (end < 0) return { fm: {}, body: raw }
  const fmBlock = raw.slice(4, end)
  const bodyStart = raw.indexOf('\n', end + 4)
  const body = bodyStart < 0 ? '' : raw.slice(bodyStart + 1)
  const fm: Frontmatter = {}
  for (const line of fmBlock.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) {
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (k) {
        // Shared-inbox files and normal YAML exports may quote multiline titles.
        // Only decode JSON string literals; keep legacy unquoted values intact.
        let decoded = v
        if(v.startsWith('"'))try{const parsed:unknown=JSON.parse(v);if(typeof parsed==='string')decoded=parsed}catch{}
        fm[k] = decoded
      }
    }
  }
  return { fm, body }
}

export function serializeNote(fm: Frontmatter, body: string): string {
  const lines = Object.entries(fm)
    .filter(([k, v]) => v !== undefined && v !== '' && k !== '')
    .map(([k, v]) => `${k}: ${String(v).replaceAll('\n', ' ')}`)
  if (lines.length === 0) return body
  return `---\n${lines.join('\n')}\n---\n${body}`
}

export function readNoteFile(rel: string): string {
  return fs.readFileSync(wsJoin(rel), 'utf-8')
}

export function writeNoteFile(rel: string, content: string): void {
  const abs = wsJoin(rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.${crypto.randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, content); fs.renameSync(tmp, abs) }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/** 生成工作区内不冲突的 notes/ 相对路径 */
export function allocateNotePath(title: string): string {
  const slug = (title || '未命名')
    .trim()
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, '-')
    .slice(0, 60) || '未命名'
  const dir = `notes/${new Date().toISOString().slice(0, 7)}` // notes/2026-10
  let rel = `${dir}/${slug}.md`
  let i = 2
  while (fs.existsSync(wsJoin(rel)) || getDb().prepare('SELECT 1 FROM notes WHERE relative_path=?').get(rel)) {
    rel = `${dir}/${slug}-${i}.md`
    i++
  }
  return rel
}

/** 从正文中提取 [[双向链接]] 目标文本（去重，保序） */
export function extractWikiTargets(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    const t = m[1]?.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}
