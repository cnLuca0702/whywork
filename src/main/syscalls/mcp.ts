import {shell} from 'electron'
import {resolveWorkspacePath} from '../security/paths'
import {inspectSkillFolder} from '../services/skill-import'
import {rankTools} from '../mcp/discovery'
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
    test_connection:{schema:z.object({serverId:z.string()}),handler:async(p:{serverId:string})=>{const tools=await mcp.refreshTools(p.serverId),server=mcp.listServers().find(s=>s.id===p.serverId);if(!server?.status.startsWith('已连接'))throw new Error(server?.status??'服务器不存在');return {toolCount:tools.length}}},
    list_tools:{schema:z.object({serverId:z.string(),toolName:z.string().optional(),limit:z.number().int().min(1).max(100).default(20),offset:z.number().int().min(0).default(0)}),handler:async(p:{serverId:string;toolName?:string;limit:number;offset:number})=>{const tools=(await mcp.refreshTools(p.serverId)).filter(t=>!p.toolName||t.originalName===p.toolName||t.name===p.toolName);return {tools:tools.slice(p.offset,p.offset+p.limit),total:tools.length}}},
    servers_list: {
      handler: async () => ({ items: mcp.listServers() })
    },
    servers_save: {
      schema: z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        command: z.string().default(''),transport:z.enum(['stdio','http']).default('stdio'),url:z.url().optional(),token:z.string().optional(),tokenHeader:z.string().regex(/^[A-Za-z0-9-]+$/).default('Authorization'),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).default({}),
        enabled: z.boolean().optional()
      }).refine(p=>p.transport==='http'?!!p.url&&['http:','https:'].includes(new URL(p.url).protocol):!!p.command.trim(),'请填写有效的命令或HTTP地址'),
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
    search_tools:{schema:z.object({query:z.string().min(1),serverIds:z.array(z.string()).optional(),limit:z.number().int().min(1).max(20).default(20)}),handler:async(p:{query:string;serverIds?:string[];limit:number})=>{
      const targets=mcp.listServers().filter(s=>s.enabled&&(!p.serverIds?.length||p.serverIds.includes(s.id)))
      const tools=(await Promise.all(targets.map(s=>mcp.refreshTools(s.id)))).flat()
      return {tools:rankTools(tools,p.query,p.serverIds,p.limit),errors:mcp.listServers().filter(s=>targets.some(t=>t.id===s.id)&&s.status.startsWith('连接失败')).map(s=>({serverId:s.id,error:s.status}))}
    }},
    call:{schema:z.object({serverId:z.string().optional(),toolName:z.string().min(1),args:z.record(z.string(),z.unknown()).optional(),arguments:z.record(z.string(),z.unknown()).optional()}),handler:async(p:{serverId?:string;toolName:string;args?:Record<string,unknown>;arguments?:Record<string,unknown>})=>{
      const tool=p.serverId?(await mcp.refreshTools(p.serverId)).find(t=>t.originalName===p.toolName||t.name===p.toolName):undefined
      if(p.serverId&&!tool)throw new Error('未知MCP工具')
      return {output:await mcp.callTool(tool?.name??p.toolName,p.arguments??p.args??{})}
    }}

  })
}

// ---------- skills ----------

function skillDirs(): { dir: string; source: 'workspace' | 'global' }[] {
  const workspace={dir:path.join(getWorkspacePath(),'.whywork','skills'),source:'workspace' as const}
  if(process.argv.some(a=>['--core-check','--extended-check','--browser-check','--run-cases','--smoke-test','--ui-check','--model-check','--feature-check'].includes(a)))return[workspace]
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
    read:{schema:z.object({name:z.string().min(1)}),handler:async(p:{name:string})=>{const skill=scanSkills().find(s=>s.name===p.name);if(!skill)throw new Error('技能不存在');return {...skill,markdown:fs.readFileSync(skill.path,'utf8').slice(0,200000)}}},
    add:{schema:z.object({dir:z.string().min(1).optional(),path:z.string().min(1).optional()}).refine(p=>!!p.dir||!!p.path,'需要技能目录'),handler:async(p:{dir?:string;path?:string},ctx)=>{
      const dir=p.dir??p.path!
      if(ctx.source!=='user')throw new Error('添加技能仅由用户触发')
      const info=inspectSkillFolder(dir);if(scanSkills().some(s=>s.name===info.name))throw new Error('同名技能已存在')
      const target=resolveWorkspacePath('.whywork/skills/'+info.name,true);if(fs.existsSync(target))throw new Error('同名技能目录已存在')
      fs.mkdirSync(path.dirname(target),{recursive:true});try{fs.cpSync(dir,target,{recursive:true,errorOnExist:true,force:false,dereference:false});inspectSkillFolder(target)}catch(e){fs.rmSync(target,{recursive:true,force:true});throw e}
      return {items:scanSkills()}
    }},
    remove:{schema:z.object({name:z.string().min(1),confirmed:z.literal(true).optional()}),handler:async(p:{name:string},ctx)=>{
      if(ctx.source!=='user')throw new Error('移除技能仅由用户触发');const skill=scanSkills().find(s=>s.name===p.name);if(!skill)throw new Error('技能不存在')
      const target=path.basename(skill.path)==='SKILL.md'?path.dirname(skill.path):skill.path
      await shell.trashItem(target);return {items:scanSkills()}
    }},
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
