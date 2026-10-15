import { app, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { z } from 'zod'
import { register } from './registry'
import { resetDb } from '../db/client'
import { getDb } from '../db/client'

/** 批量导入取消集合（CAP-08） */
const activeImports = new Set<string>()

/** 工作区管理：默认 ~/Documents/WhyWork，指针存 userData/config.json（DEVELOPMENT.md §5.1） */

interface AppConfig {
  workspacePath?: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as AppConfig
  } catch {
    return {}
  }
}

function writeConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

export function getWorkspacePath(): string {
  return readConfig().workspacePath ?? path.join(app.getPath('home'), 'Documents', 'WhyWork')
}

/** 确保工作区目录结构存在（首次启动调用） */
export function ensureWorkspace(): string {
  const ws = getWorkspacePath()
  for (const dir of ['notes', 'resources', path.join('.whywork', 'memory'), path.join('.whywork', 'vault'), path.join('.whywork', 'tmp')]) {
    fs.mkdirSync(path.join(ws, dir), { recursive: true })
  }
  return ws
}

export function setWorkspacePath(p: string): void {
  writeConfig({ ...readConfig(), workspacePath: p })
}

/** 旧 MyRemio → WhyWork 一次性迁移（userData 配置指针 + 工作区元数据目录改名 + 工作区文件夹改名） */
export function migrateFromMyRemio(): void {
  try {
    const cfg = configPath()
    if (!fs.existsSync(cfg)) {
      const oldCfg = path.join(path.dirname(path.dirname(cfg)), 'MyRemio', 'config.json')
      if (fs.existsSync(oldCfg)) {
        fs.mkdirSync(path.dirname(cfg), { recursive: true })
        fs.copyFileSync(oldCfg, cfg)
        console.log('[migrate] 已迁移 MyRemio config.json → WhyWork')
      }
    }
    // 工作区文件夹 ~/Documents/MyRemio → ~/Documents/WhyWork
    const cfgData = readConfig()
    if (cfgData.workspacePath?.endsWith('/Documents/MyRemio')) {
      const target = cfgData.workspacePath.replace(/\/Documents\/MyRemio$/, '/Documents/WhyWork')
      if (!fs.existsSync(target)) {
        fs.renameSync(cfgData.workspacePath, target)
        writeConfig({ workspacePath: target })
        console.log('[migrate] 工作区已改名 MyRemio → WhyWork')
      }
    }
    const ws = getWorkspacePath()
    const oldMeta = path.join(ws, '.myremio')
    const newMeta = path.join(ws, '.whywork')
    if (fs.existsSync(oldMeta) && !fs.existsSync(newMeta)) {
      fs.renameSync(oldMeta, newMeta)
      const oldDb = path.join(newMeta, 'myremio.db')
      if (fs.existsSync(oldDb)) fs.renameSync(oldDb, path.join(newMeta, 'whywork.db'))
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(oldDb + suffix)) fs.renameSync(oldDb + suffix, path.join(newMeta, `whywork.db${suffix}`))
      }
      console.log('[migrate] 已迁移工作区元数据 .myremio → .whywork')
    }
  } catch (e) {
    console.warn('[migrate] 迁移跳过:', e)
  }
}

export function registerAppDomain(): void {
  register('app', {
    ping: {
      handler: async () => ({ pong: true, version: app.getVersion(), ts: Date.now() })
    },
    get_workspace: {
      handler: async () => ({ path: getWorkspacePath() })
    },
    set_workspace: {
      schema: z.object({ path: z.string().min(1) }),
      handler: async (payload: { path: string }, ctx) => {
        const { isAnyChatRunning } = await import('../agent/loop')
        if (activeImports.size || isAnyChatRunning()) throw new Error('请先等待导入和对话结束，再切换工作区')
        const { closeWatchers,restoreWatchers } = await import('./watch')
        const { closeOfficeSessions } = await import('../services/office')
        const { clearFlushTimers } = await import('./chat')
        const { closeAll } = await import('../mcp/manager')
        closeWatchers(); clearFlushTimers(); closeAll(); closeOfficeSessions()
        resetDb()
        setWorkspacePath(payload.path)
        ensureWorkspace()
        resetDb() // 切换工作区后重开数据库
        restoreWatchers(ctx)
        ctx.emit('notes.changed', { kind: 'workspace' })
        return { path: getWorkspacePath() }
      }
    },
    import: {
      schema: z.object({ paths: z.array(z.string().min(1)).min(1).max(500), importId: z.string().optional() }),
      handler: async (payload: { paths: string[]; importId?: string }, ctx) => {
        const importId = payload.importId ?? `imp_${Date.now().toString(36)}`
        if (activeImports.has(importId)) throw new Error('导入任务 ID 正在使用')
        activeImports.add(importId)
        const { importFile, collectImportable, relinkLocalImages,validateEmbeddedImages } = await import('../services/importer')
        const { createNote, updateNoteBody, getNote } = await import('../db/repos/notes')
        const noteIds: string[] = []
        const errors: string[] = []
        const files: string[] = [] as string[]
        for (const p of payload.paths as string[]) {
          try {
            if (fs.statSync(p).isDirectory()) files.push(...collectImportable(p))
            else files.push(p)
          } catch (e) { errors.push(`${path.basename(p)}: ${e instanceof Error ? e.message : String(e)}`) }
        }
        const ws = getWorkspacePath()
        let processed = 0
        let cancelled = false
        for (let i = 0; i < files.length; i++) {
          await new Promise<void>(resolve => setImmediate(resolve))
          if (!activeImports.has(importId)) { cancelled = true; break }
          const p = files[i] as string
          ctx.emit('import.progress', { importId, done: i, total: files.length, current: path.basename(p) })
          try {
            const results = await importFile(p)
            if (!activeImports.has(importId)) { cancelled = true; break }
            for (const r of results) {
              validateEmbeddedImages(r.markdown)
              const srcRel = path.relative(path.dirname(p), ws) === '' ? '' : path.relative(ws, p)
              const note = createNote({
                title: r.title,
                body: r.markdown,
                source: r.source
              })
              // 本地图片改链 + 源路径追踪（EDIT-04 / CAP-06）
              const resourceDirRel = path.join('resources', note.note_id)
              const relinked = relinkLocalImages(r.markdown, note.note_id, r.baseDir, ws, resourceDirRel)
              const finalBody = srcRel ? `${relinked}\n\n<!-- source-path: ${srcRel} -->` : relinked
              updateNoteBody(note.note_id, { body: finalBody })
              const row = getNote(note.note_id)
              if (row) {
                getDb().prepare('UPDATE notes SET resource_dir=? WHERE note_id=?').run(resourceDirRel, note.note_id)
              }
              noteIds.push(note.note_id)
            }
          } catch (e) {
            errors.push(`${path.basename(p)}: ${e instanceof Error ? e.message : String(e)}`)
            ctx.emit('import.item_failed', { importId, file: path.basename(p) })
          }
          processed++
        }
        activeImports.delete(importId)
        ctx.emit('import.progress', { importId, done: processed, total: files.length, finished: true, cancelled })
        if (noteIds.length > 0) ctx.emit('notes.changed', { kind: 'import', noteIds })
        return { importId, noteIds, errors, cancelled, processed, total: files.length }
      }
    },
    import_cancel: {
      schema: z.object({ importId: z.string().min(1) }),
      handler: async (p: { importId: string }) => {
        activeImports.delete(p.importId)
        return { ok: true }
      }
    },
    rebuild_index: {
      handler: async (_p: unknown, ctx) => {
        const { rebuildIndex } = await import('./notes')
        const r = rebuildIndex()
        ctx.emit('notes.changed', { kind: 'rebuild' })
        return r
      }
    },
    pick_folder: {
      handler: async (_payload: unknown, ctx) => {
        const { dialog } = await import('electron')
        const win = ctx.win()
        const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
        if (res.canceled || !res.filePaths[0]) return { canceled: true }
        return { canceled: false, path: res.filePaths[0] }
      }
    },
    reveal_in_finder: {
      schema: z.object({ path: z.string().min(1) }),
      handler: async (payload: { path: string }) => {
        await shell.openPath(path.join(getWorkspacePath(), payload.path))
        return { ok: true }
      }
    }
  })
}
