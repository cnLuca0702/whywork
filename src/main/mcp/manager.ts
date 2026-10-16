import {encryptSecret,decryptSecret} from '../security/secrets'
import crypto from 'node:crypto'
import { safeStorage } from 'electron'
import { getDb } from '../db/client'

/** MCP 客户端管理器（DEVELOPMENT.md §6.7）：stdio 传输、工具缓存、惰性连接 */

interface McpServerRow {
  transport:string|null;url:string|null;token_enc:string|null;token_header:string|null
  id: string
  name: string
  command: string | null
  args: string | null
  env: string | null
  enabled: number
  tools_cache: string | null
  status: string | null
}

export interface McpToolInfo {
  serverId: string
  serverName: string
  name: string // mcp__<server>__<tool>
  originalName: string
  description: string
  inputSchema: Record<string, unknown>
}

// 连接缓存：serverId → { client, transport }
let epoch=0
const connecting=new Map<string,Promise<unknown>>()
const clients = new Map<string, { client: unknown; transport: unknown; ts: number }>()

function rows(): McpServerRow[] {
  return getDb().prepare('SELECT * FROM mcp_servers ORDER BY name').all() as McpServerRow[]
}

function decryptEnv(envJson: string | null): Record<string, string> {
  if (!envJson) return {}
  try {
    const raw = JSON.parse(envJson) as Record<string, string>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      try {
        out[k] = safeStorage.decryptString(Buffer.from(v, 'base64'))
      } catch {
        throw new Error('MCP 环境凭据解密失败，请重新保存配置')
      }
    }
    return out
  } catch {
    throw new Error('MCP 环境凭据解密失败，请重新保存配置')
  }
}

export function encryptEnv(env: Record<string, string>): string {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    out[k] = safeStorage.encryptString(v).toString('base64')
  }
  return JSON.stringify(out)
}

async function getClient(row: McpServerRow): Promise<unknown> {
  const cached = clients.get(row.id)
  if (cached) return cached.client
  const pending=connecting.get(row.id);if(pending)return pending
  const generation=epoch
  const promise=(async()=>{
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'whywork', version: '0.1.0' }, { capabilities: {} })
  const token=row.token_enc?decryptSecret(row.token_enc):null
  const header=row.token_header??'Authorization'
  const transport = row.transport==='http'?new StreamableHTTPClientTransport(new URL(row.url!),{requestInit:{headers:token?{[header]:header.toLowerCase()==='authorization'?'Bearer '+token:token}:{},redirect:'error'}}):new StdioClientTransport({
    command: row.command ?? '',
    args: row.args ? (JSON.parse(row.args) as string[]) : [],
    env: { PATH:process.env.PATH??'',HOME:process.env.HOME??'',TMPDIR:process.env.TMPDIR??'',LANG:process.env.LANG??'zh_CN.UTF-8', ...decryptEnv(row.env) } as Record<string, string>
  })
  try{await client.connect(transport)}catch(e){await transport.close().catch(()=>undefined);throw e}
  if(generation!==epoch){await client.close();throw new Error('工作区或 MCP 配置已变更')}
  clients.set(row.id, { client, transport, ts: Date.now() })
  return client
  })()
  connecting.set(row.id,promise)
  try{return await promise}finally{if(connecting.get(row.id)===promise)connecting.delete(row.id)}
}

export interface McpServerInfo {
  transport:string;url:string;tokenHeader:string;hasToken:boolean
  id: string
  name: string
  command: string
  args: string[]
  envKeys: string[]
  enabled: boolean
  status: string
  toolCount: number
}

export function listServers(): McpServerInfo[] {
  return rows().map((r) => {
    let toolCount = 0
    try {
      toolCount = r.tools_cache ? (JSON.parse(r.tools_cache) as unknown[]).length : 0
    } catch {
      /* ignore */
    }
    return {
      transport:r.transport??'stdio',url:r.url??'',tokenHeader:r.token_header??'Authorization',hasToken:!!r.token_enc,
      id: r.id,
      name: r.name,
      command: r.command ?? '',
      args: r.args ? (JSON.parse(r.args) as string[]) : [],
      envKeys: r.env ? Object.keys(JSON.parse(r.env) as object) : [],
      enabled: !!r.enabled,
      status: r.status ?? '未连接',
      toolCount
    }
  })
}

export function saveServer(input: { id?: string; name: string; command: string; args: string[]; env: Record<string, string>; enabled?: boolean;transport?:'stdio'|'http';url?:string;token?:string;tokenHeader?:string }): McpServerInfo {
  epoch++
  const db = getDb()
  const id = input.id ?? `mcp_${Date.now().toString(36)}`
  const existing=input.id?db.prepare('SELECT env FROM mcp_servers WHERE id=?').get(input.id) as {env:string|null}|undefined:undefined
  const old=existing?.env?JSON.parse(existing.env) as Record<string,string>:{}
  const updated=Object.keys(input.env).length?JSON.parse(encryptEnv(input.env)) as Record<string,string>:{}
  const envEnc=Object.keys({...old,...updated}).length?JSON.stringify({...old,...updated}):null
  const tokenEnc=input.token?encryptSecret(input.token):null
  if (input.id) {
    db.prepare('UPDATE mcp_servers SET name=?, command=?, args=?, env=?, enabled=? WHERE id=?').run(
      input.name,
      input.command,
      JSON.stringify(input.args),
      envEnc,
      input.enabled === false ? 0 : 1,
      id
    )
    const old = clients.get(input.id)
    if (old) {
      void (old.client as { close(): Promise<void> }).close().catch(() => undefined)
      clients.delete(input.id)
    }
  } else {
    db.prepare('INSERT INTO mcp_servers (id, name, command, args, env, enabled) VALUES (?,?,?,?,?,?)').run(
      id,
      input.name,
      input.command,
      JSON.stringify(input.args),
      envEnc,
      input.enabled === false ? 0 : 1
    )
  }
  db.prepare('UPDATE mcp_servers SET transport=?,url=?,token_header=?,token_enc=CASE WHEN ? IS NULL THEN token_enc ELSE ? END,tools_cache=NULL WHERE id=?').run(input.transport??'stdio',input.url??null,input.tokenHeader??'Authorization',input.token??null,tokenEnc,id)
  return listServers().find((s) => s.id === id)!
}

export function deleteServer(id: string): void {
  epoch++
  const old = clients.get(id)
  if (old) {
    void (old.client as { close(): Promise<void> }).close().catch(() => undefined)
    clients.delete(id)
  }
  getDb().prepare('DELETE FROM mcp_servers WHERE id=?').run(id)
}

export function setEnabled(id: string, enabled: boolean): void {
  epoch++
  getDb().prepare('UPDATE mcp_servers SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id)
  if (!enabled) {
    const old = clients.get(id)
    if (old) {
      void (old.client as { close(): Promise<void> }).close().catch(() => undefined)
      clients.delete(id)
    }
  }
}

/** 连接并列出工具（刷新 tools_cache） */
export async function refreshTools(serverId?: string): Promise<McpToolInfo[]> {
  const generation=epoch
  const targets = rows().filter((r) => r.enabled && (!serverId || r.id === serverId))
  const all: McpToolInfo[] = []
  for (const r of targets) {
    try {
      const client = (await getClient(r)) as { listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] }> }
      const res = await client.listTools()
      if(generation!==epoch)throw new Error('MCP 配置已变更')
      const tools: McpToolInfo[] = res.tools.map((t) => ({
        serverId: r.id,
        serverName: r.name,
        name: `mcp__${r.name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,16)}_${crypto.createHash('sha256').update(r.id+'\0'+t.name).digest('hex').slice(0,8)}__${t.name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,24)}`,
        originalName: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} }
      }))
      getDb().prepare('UPDATE mcp_servers SET tools_cache=?, status=? WHERE id=?').run(JSON.stringify(tools), `已连接（${tools.length} 工具）`, r.id)
      all.push(...tools)
    } catch (e) {
      if(generation!==epoch)return all
      const message=e instanceof Error?e.message:''
      const category=/401|403|auth/i.test(message)?'认证失败':/protocol|content.type|404|405/i.test(message)?'协议不兼容':'地址不可达'
      getDb().prepare('UPDATE mcp_servers SET tools_cache=NULL,status=? WHERE id=?').run('连接失败：'+category,r.id)
      clients.delete(r.id)
    }
  }
  return all
}

export function cachedTools(): McpToolInfo[] {
  const out: McpToolInfo[] = []
  for (const r of rows()) {
    if (!r.enabled || !r.tools_cache) continue
    try {
      out.push(...(JSON.parse(r.tools_cache) as McpToolInfo[]))
    } catch {
      /* ignore */
    }
  }
  return out
}

export async function callTool(fullName: string, args: Record<string, unknown>): Promise<string> {
  const tool = cachedTools().find((t) => t.name === fullName)
  if (!tool) throw new Error(`未知 MCP 工具: ${fullName}`)
  const row = rows().find((r) => r.id === tool.serverId)
  if (!row) throw new Error(`MCP 服务器不存在: ${tool.serverName}`)
  const client = (await getClient(row)) as { callTool(p: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }> }
  const res = await client.callTool({ name: tool.originalName, arguments: args })
  const text = (res.content ?? [])
    .map((c) => c.text ?? '')
    .join('\n')
  if (res.isError) throw new Error(text || 'MCP 工具执行失败')
  return text || JSON.stringify(res.content ?? [])
}

export function closeAll(): void {
  epoch++;connecting.clear()
  for (const [, c] of clients) {
    void (c.client as { close(): Promise<void> }).close().catch(() => undefined)
  }
  clients.clear()
}
