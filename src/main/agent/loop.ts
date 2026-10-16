import {modelError} from '../providers/errors'
import {SourceRegistry,referenceContext} from './sources'
import {resolveReferences,type ChatRefs} from './references'
import {chatSelection,validateSelection,type ModelSelection} from '../providers/catalog'
import { getSetting } from '../syscalls/settings'
import { clearConfirmations } from './confirmation'
import { getWorkspacePath } from '../syscalls/app'
import crypto from 'node:crypto'
import { getDb } from '../db/client'
import { getProvider } from '../providers/store'
import type { ChatMessage, ToolCall } from '../providers/types'
import { systemPrompt, memoryContext } from './prompts'
import { buildTools, toProviderTools, runTool } from './tools'
import { invokeSys, type SysContext } from '../syscalls/registry'

/** agent loop（DEVELOPMENT.md §7.1）：流式 → 工具调用 → 回填 → 继续，上限 maxTurns */

const aborts = new Map<string, AbortController>()

export function isAnyChatRunning():boolean {return aborts.size>0}

export function isChatRunning(chatId: string): boolean { return aborts.has(chatId) }

export function abortChat(chatId: string): void {
  aborts.get(chatId)?.abort()
}

interface RunOptions {
  ctx: SysContext
  chatId: string
  userText: string
  noteId?: string | null
  selection: ModelSelection
  maxTurns?: number
  reuseUserMessage?: boolean
  refs?:ChatRefs
  useKnowledge?:boolean
  onEvent: (topic: string, payload: unknown) => void
}

function loadHistory(chatId: string): ChatMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200')
    .all(chatId).reverse() as { msg_id: string; role: string; content: string | null; tool_calls: string | null; created_at: number }[]
  const out: ChatMessage[] = []
  for (const r of rows) {
    if (r.role === 'user') out.push({ role: 'user', content: r.content ?? '' })
    else if (r.role === 'assistant') {
      const tcs = r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined
      out.push({ role: 'assistant', content: r.content ?? '', ...(tcs ? { tool_calls: tcs } : {}) })
    } else if (r.role === 'tool') {
      const parsed = r.content ? (JSON.parse(r.content) as { tool_call_id: string; name: string; output: string }) : null
      if (parsed) out.push({ role: 'tool', content: parsed.output, tool_call_id: parsed.tool_call_id, name: parsed.name })
    }
  }
  return out
}

function saveMessage(chatId: string, role: 'user' | 'assistant' | 'tool', content: string | null, toolCalls?: unknown, toolResult?: unknown, reasoning?: string, refs?:unknown, sources?:unknown): string {
  const msgId=crypto.randomUUID()
  getDb()
    .prepare('INSERT INTO messages (msg_id, chat_id, role, content, tool_calls, tool_result, created_at, reasoning, refs, sources) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(msgId, chatId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, toolResult ? JSON.stringify(toolResult) : null, Date.now(), reasoning || null,refs?JSON.stringify(refs):null,sources?JSON.stringify(sources):null)
  getDb().prepare('UPDATE chats SET updated_at = ? WHERE chat_id = ?').run(Date.now(), chatId)
  return msgId
}

export async function runAgent(opts: RunOptions): Promise<{ ok: boolean; error?: string }> {
  const { chatId, userText, onEvent, ctx } = opts
  if (aborts.has(chatId)) return { ok: false, error: '会话正在运行' }
  const ac = new AbortController()
  aborts.set(chatId, ac)

  if (!opts.reuseUserMessage) saveMessage(chatId, 'user', userText,undefined,undefined,undefined,{...opts.refs,useKnowledge:opts.useKnowledge??true})

  try {
    const { enabledSkillTexts } = await import('../syscalls/mcp')
    const sources=new SourceRegistry()
    const references=resolveReferences(opts.refs)
    const skillTexts = [...references.skills,...enabledSkillTexts()]
    let system = systemPrompt(skillTexts)+'\n\n引用来源只能用已登记的[来源 n]编号，以[n]标注；没有证据请说明，禁止编造编号。'
    if(references.notes.length)system+='\n\n# 本轮显式引用\n'+referenceContext(references.notes,sources)
    const mem = memoryContext()
    if (mem) system += `\n\n${mem}`
    if (opts.noteId && opts.useKnowledge!==false) {
      const r = await invokeSys('notes.get', { noteId: opts.noteId }, ctx)
      if (r.ok) {
        const d = r.data as { note: { title: string }; body: string }
        const boundSource=sources.capture('notes.get',r.data)
        system += `\n\n# 当前绑定笔记\n${boundSource}\n\n${d.body.slice(0, 4000)}`
      }
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...loadHistory(chatId)
    ]

    const { providerId, model } = opts.selection
    const provider = getProvider(providerId)
    const tools = toProviderTools(buildTools().filter(t=>opts.useKnowledge!==false||!['notes.search','notes.get','notes.list'].includes(t.name)))
    // 动态注入已启用的 MCP 工具（mcp__<server>__<tool>）
    const { cachedTools } = await import('../mcp/manager')
    const mcpTools=cachedTools(),directLimit=Number(getSetting('mcp.directToolLimit')??40)
    if(mcpTools.length>directLimit){messages[0]!.content+='\nMCP服务器：'+[...new Map(mcpTools.map(t=>[t.serverId,t.serverName])).entries()].map(([id,name])=>`${id}: ${name}`).join('；')+'。先搜索工具，再读取完整定义，再调用。'}
    for (const t of mcpTools.length>directLimit?[]:mcpTools) {
      tools.push({
        type: 'function',
        function: { name: t.name, description: `[MCP:${t.serverName}] ${t.description}`.slice(0, 500), parameters: t.inputSchema }
      })
    }
    const configured=Number(getSetting('agent.maxTurns')??12)
    const maxTurns = Math.max(1,Math.min(30,opts.maxTurns ?? (Number.isFinite(configured)?configured:12)))

    for (let turn = 0; turn < maxTurns; turn++) {
      let assistantText = ''
      let reasoning = ''
      let usage:{calls:number;input:number;output:number}|undefined
      const toolCalls: ToolCall[] = []
      const finish = await provider.stream(
        { model, messages, tools, signal: ac.signal },
        (e) => {
          if (e.type === 'text') {
            assistantText += e.delta
            onEvent('chat.delta', { chatId, delta: e.delta })
          } else if (e.type === 'reasoning') {
            reasoning += e.delta
            onEvent('chat.reasoning', { chatId, delta: e.delta })
          } else if(e.type==='usage'){
            usage={calls:1,input:e.input,output:e.output}
          } else if (e.type === 'tool_call') {
            toolCalls.push({ id: e.id, type: 'function', function: { name: e.name, arguments: e.argsJson } })
          }
        }
      )

      messages.push({
        role: 'assistant',
        content: assistantText || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      })
      const msgId=saveMessage(chatId, 'assistant', assistantText || null, toolCalls.length > 0 ? toolCalls : undefined, undefined, reasoning,undefined,sources.sources)
      if(usage)getDb().prepare('UPDATE messages SET usage=? WHERE msg_id=?').run(JSON.stringify(usage),msgId)
      onEvent('chat.sources',{chatId,msgId,sources:sources.sources})

      if (finish.finishReason === 'length') throw new Error('模型回复达到长度上限，内容尚未完整')
      if (finish.finishReason !== 'tool_use' || toolCalls.length === 0) break

      if (turn === maxTurns - 1) throw new Error('已达到工具轮次上限，请继续对话')
      for (const tc of toolCalls) {
        onEvent('chat.tool', { chatId, toolCallId:tc.id, name: tc.function.name, args: tc.function.arguments, phase: 'start' })
        const output = await runTool(tc.function.name, tc.function.arguments, { ...ctx, chatId, source: 'agent', signal: ac.signal,sources,useKnowledge:opts.useKnowledge })
        onEvent('chat.tool', { chatId, toolCallId:tc.id, name: tc.function.name, phase: /^(错误|工具执行失败|MCP 工具执行失败)/.test(output) ? 'error' : 'done', output: output.slice(0, 500) })
        messages.push({ role: 'tool', content: output, tool_call_id: tc.id, name: tc.function.name })
        saveMessage(chatId, 'tool', JSON.stringify({ tool_call_id: tc.id, name: tc.function.name, output }))
      }
    }

    onEvent('chat.done', { chatId })
    return { ok: true }
  } catch (e) {
    const msg = modelError(e)
    const aborted = msg.includes('取消') || msg.includes('abort') || (e as { code?: string }).code === 'ABORTED'
    onEvent('chat.error', { chatId, error: msg, aborted })
    return { ok: false, error: msg }
  } finally {
    clearConfirmations(chatId)
    aborts.delete(chatId)
  }
}

const memoryBusy=new Set<string>()
/** 会话静默后异步 flush 记忆（chat.ts 调度） */
export async function flushMemory(chatId: string, ctx: SysContext, expected?:ModelSelection): Promise<void> {
  const workspace=getWorkspacePath(),key=workspace+'\0'+chatId
  if(getSetting('memory.mode')==='off'||memoryBusy.has(key))return
  memoryBusy.add(key)
  try {
    const last=(getDb().prepare('SELECT last_row FROM memory_flush WHERE chat_id=?').get(chatId) as {last_row:number}|undefined)?.last_row??0
    const selection=chatSelection(chatId)
    if(!selection||isChatRunning(chatId))return
    if(expected&&(selection.providerId!==expected.providerId||selection.model!==expected.model))return
    await validateSelection(selection)
    const {providerId,model}=selection
    const provider=getProvider(providerId)
    const rows = getDb()
      .prepare('SELECT rowid, role, content FROM messages WHERE chat_id = ? AND rowid>? ORDER BY rowid DESC LIMIT 12')
      .all(chatId,last)
      .reverse() as { rowid:number;role: string; content: string | null }[]
    if (rows.length < 2) return
    const excerpt = rows
      .map((r) => `${r.role === 'user' ? '用户' : '助手'}: ${(r.content ?? '').slice(0, 500)}`)
      .join('\n')
    let out = ''
    await provider.stream(
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是记忆维护代理。根据对话摘录判断是否值得记入用户记忆。只输出 JSON：{"daily":"写入当日工作日志的一两行事实（无则空串）","root":"值得长期记住的用户偏好/规则/决定（无则空串）"}。不记录可随时查询的运行时状态：路径、版本、配置、笔记正文、搜索结果。回复语言属于设置，不写入记忆。迁移技能相关记忆时，只有目标成功写入后才能删除源条目；本次不执行迁移。不要输出其他内容。'
          },
          { role: 'user', content: excerpt }
        ],
        signal: AbortSignal.timeout(30_000)
      },
      (e) => {
        if (e.type === 'text') out += e.delta
      }
    )
    if (getWorkspacePath() !== workspace||getSetting('memory.mode')==='off') return
    const m = /\{[\s\S]*\}/.exec(out)
    if (!m) return
    const parsed = JSON.parse(m[0]) as { daily?: string; root?: string }
    if((parsed.daily!==undefined&&typeof parsed.daily!=='string')||(parsed.root!==undefined&&typeof parsed.root!=='string'))return
    if (parsed.daily) {
      const { appendDailyMemory } = await import('./prompts')
      appendDailyMemory(`- ${parsed.daily}`)
    }
    if (parsed.root) {
      const { updateRootMemory } = await import('./prompts')
      updateRootMemory(`- ${parsed.root}`)
      ctx.emit('notes.changed', { kind: 'memory' })
    }
    getDb().prepare('INSERT INTO memory_flush(chat_id,last_row) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET last_row=excluded.last_row').run(chatId,rows.at(-1)!.rowid)
  } catch {
    /* flush 失败静默（不打扰用户） */
  }finally{memoryBusy.delete(key)}
}
