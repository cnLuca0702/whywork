import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { z } from 'zod'
import { register } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
import * as mcp from '../mcp/manager'

/** mcp 域 + skills 域（DEVELOPMENT.md §6.7/§6.8） */

export function registerMcpDomain(): void {
  register('mcp', {
    servers_list: {
      handler: async () => ({ items: mcp.listServers() })
    },
    servers_save: {
      schema: z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).default({}),
        enabled: z.boolean().optional()
      }),
      handler: async (p: { id?: string; name: string; command: string; args: string[]; env: Record<string, string>; enabled?: boolean }) => {
        const server = mcp.saveServer(p)
        void mcp.refreshTools(server.id).catch(() => undefined)
        return server
      }
    },
    servers_delete: {
      schema: z.object({ id: z.string().min(1) }),
      handler: async (p: { id: string }) => {
        mcp.deleteServer(p.id)
        return { ok: true }
      }
    },
    enable: {
      schema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      handler: async (p: { id: string; enabled: boolean }) => {
        mcp.setEnabled(p.id, p.enabled)
        if (p.enabled) void mcp.refreshTools(p.id).catch(() => undefined)
        return { ok: true }
      }
    },
    tools: {
      schema: z.object({ serverId: z.string().optional() }),
      handler: async (p: { serverId?: string }) => {
        if (p.serverId) {
          const tools = await mcp.refreshTools(p.serverId)
          return { tools }
        }
        return { tools: mcp.cachedTools() }
      }
    },
    search_tools: {
      schema: z.object({ query: z.string().min(1) }),
      handler: async (p: { query: string }) => {
        const q = p.query.toLowerCase()
        return {
          tools: mcp
            .cachedTools()
            .filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
            .slice(0, 30)
        }
      }
    },
    call: {
      schema: z.object({ toolName: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) }),
      handler: async (p: { toolName: string; args: Record<string, unknown> }) => ({
        output: await mcp.callTool(p.toolName, p.args)
      })
    }
  })
}

// ---------- skills ----------

function skillDirs(): { dir: string; source: 'workspace' | 'global' }[] {
  const workspace={dir:path.join(getWorkspacePath(),'.whywork','skills'),source:'workspace' as const}
  if(process.argv.some(a=>['--core-check','--extended-check','--browser-check','--run-cases','--smoke-test','--ui-check'].includes(a)))return[workspace]
  return [
    {dir:path.join(os.homedir(),'.whywork','skills'),source:'global' as const}, workspace
  ]
}

function parseSkillFile(file: string): { name: string; description: string; body: string } | null {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    let body = raw
    let name = path.basename(file, '.md').replace(/^SKILL-?/i, '')
    let description = ''
    if (raw.startsWith('---\n')) {
      const end = raw.indexOf('\n---', 4)
      if (end > 0) {
        const fm = raw.slice(4, end)
        body = raw.slice(end + 5)
        for (const line of fm.split('\n')) {
          const i = line.indexOf(':')
          if (i > 0) {
            const k = line.slice(0, i).trim()
            const v = line.slice(i + 1).trim()
            if (k === 'name') name = v
            if (k === 'description') description = v
          }
        }
      }
    }
    if (!description) description = body.trim().split('\n')[0]?.slice(0, 120) ?? ''
    return { name: name || 'skill', description, body }
  } catch {
    return null
  }
}

export interface SkillInfo {
  name: string
  path: string
  source: 'workspace' | 'global'
  description: string
  enabled: boolean
}

/** 扫描技能目录 → skills 表 upsert（文件为准） */
export function scanSkills(): SkillInfo[] {
  const db = getDb()
  const found = new Map<string, SkillInfo>()
  for (const { dir, source } of skillDirs()) {
    let entries: string[] = []
    try {
      if(fs.lstatSync(dir).isSymbolicLink())continue
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      let file = full
      if(fs.lstatSync(full).isSymbolicLink())continue
      if (fs.statSync(full).isDirectory()) {
        const f = path.join(full, 'SKILL.md')
        if (fs.existsSync(f)) file = f
        else continue
      } else if (!name.endsWith('.md')) {
        continue
      }
      if(fs.lstatSync(file).isSymbolicLink())continue
      const parsed = parseSkillFile(file)
      if (!parsed) continue
      found.set(parsed.name, {
        name: parsed.name,
        path: file,
        source,
        description: parsed.description,
        enabled: true
      })
    }
  }
  // 合并保留 enabled 状态
  const existing = db.prepare('SELECT * FROM skills').all() as { name: string; source: string; enabled: number }[]
  const out: SkillInfo[] = []
  for (const [key, s] of found) {
    void key
    const old = existing.find((e) => e.name === s.name)
    const enabled = old ? !!old.enabled : true
    db.prepare(
      'INSERT INTO skills (name, path, source, description, enabled) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET path=excluded.path, source=excluded.source, description=excluded.description'
    ).run(s.name, s.path, s.source, s.description, enabled ? 1 : 0)
    out.push({ ...s, enabled })
  }
  // 清理已消失的
  for (const e of existing) {
    if (!out.some((s) => s.name === e.name)) db.prepare('DELETE FROM skills WHERE name=?').run(e.name)
  }
  return out
}

export function enabledSkillTexts(limitChars = 8000): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM skills WHERE enabled = 1').all() as { name: string; path: string }[]
  const texts: string[] = []
  let total = 0
  for (const r of rows) {
    try {
      const parsed = parseSkillFile(r.path)
      if (!parsed) continue
      const snippet = parsed.body.length > 2000 ? `${parsed.body.slice(0, 2000)}…` : parsed.body
      const text = `## ${parsed.name}\n${parsed.description}\n${snippet}`
      if (total + text.length > limitChars) break
      total += text.length
      texts.push(text)
    } catch {
      /* 文件消失 */
    }
  }
  return texts
}

export function registerSkillsDomain(): void {
  register('skills', {
    list: {
      handler: async () => ({ items: scanSkills() })
    },
    toggle: {
      schema: z.object({ name: z.string().min(1), enabled: z.boolean() }),
      handler: async (p: { name: string; enabled: boolean }) => {
        getDb().prepare('UPDATE skills SET enabled=? WHERE name=?').run(p.enabled ? 1 : 0, p.name)
        return { ok: true }
      }
    },
    reload: {
      handler: async () => ({ items: scanSkills() })
    }
  })
}
