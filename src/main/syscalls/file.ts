import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { register } from './registry'
import { getWorkspacePath } from './app'
import { snapshotBeforeWrite } from '../agent/vault'
import { resolveWorkspacePath } from '../security/paths'

/** file 域：工作区相对路径的文件读写，全部走 BOW 快照（DEVELOPMENT.md §6.2） */

function safeResolve(rel: string): string { return resolveWorkspacePath(rel) }

function toRel(abs: string): string {
  return path.relative(getWorkspacePath(), abs)
}

function assertNoteWrite(rel:string):void {
  if(path.normalize(rel).split(path.sep)[0] === 'notes') throw new Error('笔记文件请使用 notes 域修改，以保持索引与回滚一致')
}

function assertInside(rel: string): void {
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`路径越界: ${rel}`)
}

export function registerFileDomain(): void {
  register('file', {
    read: {
      schema: z.object({ path: z.string().min(1) }),
      handler: async (p: { path: string }) => {
        assertInside(p.path)
        const abs = safeResolve(p.path)
        const stat = fs.statSync(abs)
        if (stat.isDirectory()) throw new Error('目标是目录')
        return { content: fs.readFileSync(abs, 'utf-8'), stat: { size: stat.size, mtime: stat.mtimeMs } }
      }
    },
    write: {
      schema: z.object({ path: z.string().min(1), content: z.string() }),
      handler: async (p: { path: string; content: string }) => {
        assertInside(p.path)
        assertNoteWrite(p.path)
        const exists = fs.existsSync(safeResolve(p.path))
        snapshotBeforeWrite(p.path, exists ? 'modify' : 'create')
        const abs = safeResolve(p.path)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, p.content)
        return { ok: true }
      }
    },
    move: {
      schema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
      handler: async (p: { from: string; to: string }) => {
        assertInside(p.from)
        assertInside(p.to)
        assertNoteWrite(p.from);assertNoteWrite(p.to)
        if(fs.existsSync(safeResolve(p.to)))throw new Error('目标文件已存在')
        if(!fs.statSync(safeResolve(p.from)).isFile())throw new Error('只支持移动单文件')
        snapshotBeforeWrite(p.from, 'rename', { newPath: p.to })
        const fromAbs = safeResolve(p.from)
        const toAbs = safeResolve(p.to)
        fs.mkdirSync(path.dirname(toAbs), { recursive: true })
        fs.renameSync(fromAbs, toAbs)
        return { ok: true, path: toRel(toAbs) }
      }
    },
    delete: {
      schema: z.object({ path: z.string().min(1) }),
      handler: async (p: { path: string }) => {
        assertInside(p.path)
        assertNoteWrite(p.path)
        if (!fs.existsSync(safeResolve(p.path))) return { ok: true }
        snapshotBeforeWrite(p.path, 'delete')
        return { ok: true } // 文件已由 BOW 移入墓碑区
      }
    },
    list: {
      schema: z.object({ path: z.string().optional() }),
      handler: async (p: { path?: string }) => {
        const rel = p.path && p.path.length > 0 ? p.path : '.'
        assertInside(rel)
        const abs = safeResolve(rel)
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { entries: [] }
        const entries: { path: string; dir: boolean; size: number; mtime: number }[] = []
        for (const name of fs.readdirSync(abs)) {
          if (name === '.whywork' && rel === '.') continue
          const child = path.join(abs, name)
          const st = fs.lstatSync(child)
          if(st.isSymbolicLink())continue
          entries.push({ path: toRel(child), dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
        }
        return { entries }
      }
    }
  })
}
