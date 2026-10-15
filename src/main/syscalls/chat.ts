import crypto from 'node:crypto'
import {chatSelection,saveChatSelection,validateSelection,type ModelSelection} from '../providers/catalog'
const selectionSchema=z.object({providerId:z.string().min(1),model:z.string().min(1)})
import { z } from 'zod'
import { register, type SysContext } from './registry'
import { getDb } from '../db/client'
import { runAgent, abortChat, flushMemory, isChatRunning } from '../agent/loop'
import { respondConfirmation } from '../agent/confirmation'

/** chat 域（DEVELOPMENT.md §6.6）：流式经 sys:event chat.* 推送 */

interface ChatRow {
  chat_id: string
  title: string
  note_id: string | null
  model_role: 'fast' | 'expert'
  created_at: number
  updated_at: number
}

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function clearFlushTimers():void {
  for(const timer of flushTimers.values())clearTimeout(timer)
  flushTimers.clear()
}

function scheduleFlush(chatId: string, ctx: SysContext, selection:ModelSelection): void {
  const prev = flushTimers.get(chatId)
  if (prev) clearTimeout(prev)
  flushTimers.set(
    chatId,
    setTimeout(() => {
      flushTimers.delete(chatId)
      void flushMemory(chatId, ctx, selection)
    }, 30_000)
  )
}

function chatList(): ChatRow[] {
  return getDb().prepare('SELECT * FROM chats ORDER BY updated_at DESC LIMIT 100').all() as ChatRow[]
}

function firstOf(chatId: string): string | null {
  const row = getDb()
    .prepare("SELECT content FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY created_at LIMIT 1")
    .get(chatId) as { content: string | null } | undefined
  return row?.content ?? null
}

export function registerChatDomain(): void {
  register('chat', {
    create: {
      schema: z.object({ noteId: z.string().nullable().optional(), title: z.string().optional(),selection:selectionSchema.optional() }),
      handler: async (p: { noteId?: string | null; title?: string;selection?:ModelSelection }) => {
        if(p.selection)await validateSelection(p.selection)
        const id = crypto.randomUUID()
        const now = Date.now()
        getDb()
          .prepare('INSERT INTO chats (chat_id, title, note_id, model_role, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, p.title ?? '新对话', p.noteId ?? null, 'fast', now, now)
        if(p.selection)saveChatSelection(id,p.selection)
        return { chatId: id }
      }
    },

    list: {
      handler: async () => ({
        items: chatList().map((c) => ({
          chatId: c.chat_id,
          title: c.title,
          noteId: c.note_id,
          modelRole: c.model_role,
          selection:chatSelection(c.chat_id),
          updatedAt: c.updated_at
        }))
      })
    },

    delete: {
      schema: z.object({ chatId: z.string().min(1) }),
      handler: async (p: { chatId: string }) => {
        abortChat(p.chatId)
        const timer=flushTimers.get(p.chatId);if(timer)clearTimeout(timer);flushTimers.delete(p.chatId)
        getDb().prepare('DELETE FROM chats WHERE chat_id = ?').run(p.chatId)
        return { ok: true }
      }
    },

    rename: {
      schema: z.object({ chatId: z.string().min(1), title: z.string().min(1) }),
      handler: async (p: { chatId: string; title: string }) => {
        getDb().prepare('UPDATE chats SET title = ? WHERE chat_id = ?').run(p.title, p.chatId)
        return { ok: true }
      }
    },

    set_model: {
      schema: z.object({chatId:z.string().min(1),selection:selectionSchema}),
      handler:async(p:{chatId:string;selection:ModelSelection})=>{
        if(isChatRunning(p.chatId))throw new Error('回复期间不能切换模型，请先停止')
        await validateSelection(p.selection)
        if(isChatRunning(p.chatId))throw new Error('回复期间不能切换模型，请先停止')
        saveChatSelection(p.chatId,p.selection)
        const timer=flushTimers.get(p.chatId);if(timer)clearTimeout(timer);flushTimers.delete(p.chatId)
        return{ok:true}
      }
    },

    messages: {
      schema: z.object({ chatId: z.string().min(1), limit: z.number().int().min(1).max(500).default(100) }),
      handler: async (p: { chatId: string; limit: number }) => {
        const rows = getDb()
          .prepare('SELECT msg_id, role, content, tool_calls, tool_result, created_at FROM messages WHERE chat_id = ? ORDER BY created_at LIMIT ?')
          .all(p.chatId, p.limit) as {
          msg_id: string
          role: string
          content: string | null
          tool_calls: string | null
          tool_result: string | null
          created_at: number
        }[]
        return {
          messages: rows.map((r) => ({
            msgId: r.msg_id,
            role: r.role,
            content: r.content,
            toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : null,
            toolResult: r.tool_result ? JSON.parse(r.tool_result) : null,
            createdAt: r.created_at
          }))
        }
      }
    },

    send: {
      schema: z.object({ chatId: z.string().min(1), text: z.string().min(1),selection:selectionSchema }),
      handler: async (p: { chatId: string; text: string;selection:ModelSelection }, ctx) => {
        const chat = getDb().prepare('SELECT * FROM chats WHERE chat_id = ?').get(p.chatId) as ChatRow | undefined
        if (!chat) throw new Error(`会话不存在: ${p.chatId}`)
        const selection=chatSelection(p.chatId)
        if(!selection||selection.providerId!==p.selection.providerId||selection.model!==p.selection.model)throw new Error('会话模型已变化，请重新选择后发送')
        await validateSelection(selection)
        const current=chatSelection(p.chatId)
        if(current?.providerId!==selection.providerId||current.model!==selection.model)throw new Error('会话模型已变化，请重试')
        // 首条消息 → 标题为前 20 字
        if (chat.title === '新对话') {
          const t = p.text.trim().slice(0, 20)
          getDb().prepare('UPDATE chats SET title = ? WHERE chat_id = ?').run(t, p.chatId)
        }
        if (isChatRunning(p.chatId)) throw new Error('会话正在运行，请等待或停止后重试')
        // 异步跑 loop（handler 立即返回，流式走事件）
        void runAgent({
          ctx,
          chatId: p.chatId,
          userText: p.text,
          noteId: chat.note_id,
          selection,
          onEvent: (topic, payload) => ctx.emit(topic, payload)
        }).then(result => {if(result.ok)scheduleFlush(p.chatId, ctx,selection)})
        return { ok: true }
      }
    },

    confirm: {
      schema: z.object({ id: z.string(), chatId: z.string(), approved: z.boolean() }),
      handler: async (p: {id:string;chatId:string;approved:boolean}) => {
        respondConfirmation(p.id, p.chatId, p.approved)
        return { ok: true }
      }
    },
    stop: {
      schema: z.object({ chatId: z.string().min(1) }),
      handler: async (p: { chatId: string }) => {
        abortChat(p.chatId)
        return { ok: true }
      }
    },

    flush_now: {
      schema: z.object({ chatId: z.string().min(1) }),
      handler: async (p: { chatId: string }, ctx) => {
        void flushMemory(p.chatId, ctx)
        return { ok: true }
      }
    }
  })
}
