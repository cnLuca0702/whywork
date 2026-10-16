import {backgroundText} from '../providers/background'
import {getSetting} from './settings'
import {getWorkspacePath} from './app'
import {refsSchema,resolveReferences,type ChatRefs} from '../agent/references'
import {regenerationTurn, discardLastResponse} from '../agent/regenerate'
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
  if(getSetting('memory.mode')==='off')return
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

function chatList(query='',limit=100,offset=0): ChatRow[] {
  return getDb().prepare('SELECT * FROM chats WHERE instr(lower(title),lower(?))>0 ORDER BY updated_at DESC,chat_id LIMIT ? OFFSET ?').all(query,limit,offset) as ChatRow[]
}
async function autoTitle(chatId:string,ctx:SysContext){
 const workspace=getWorkspacePath()
 if(getSetting('chat.autoTitle')==='false')return
 const db=getDb(),chat=db.prepare('SELECT title,auto_title FROM chats WHERE chat_id=?').get(chatId) as {title:string;auto_title:number}|undefined
 if(!chat?.auto_title||(db.prepare("SELECT count(*) AS n FROM messages WHERE chat_id=? AND role='user'").get(chatId) as {n:number}).n!==1)return
 try{
  const title=(await backgroundText('请为对话生成一个不超过16字的标题，只输出标题。',firstOf(chatId)??'',AbortSignal.timeout(20000))).trim().replace(/^['"“]|['"”]$/g,'').slice(0,16)
  if(!title||getWorkspacePath()!==workspace)return
  const result=getDb().prepare('UPDATE chats SET title=?,auto_title=0 WHERE chat_id=? AND auto_title=1 AND title=?').run(title,chatId,chat.title)
  if(result.changes)ctx.emit('chat.renamed',{chatId,title})
 }catch{/* Keep the original title on missing background model or failure. */}
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
        if(p.title)getDb().prepare('UPDATE chats SET auto_title=0 WHERE chat_id=?').run(id)
        if(p.selection)saveChatSelection(id,p.selection)
        return { chatId: id }
      }
    },

    list: {
      schema:z.object({query:z.string().max(200).default(''),limit:z.number().int().min(1).max(500).default(100),offset:z.number().int().min(0).default(0)}),
      handler: async (p:{query:string;limit:number;offset:number}) => ({
        total:(getDb().prepare('SELECT count(*) AS n FROM chats WHERE instr(lower(title),lower(?))>0').get(p.query) as {n:number}).n,
        items: chatList(p.query,p.limit,p.offset).map((c) => ({
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
        if(isChatRunning(p.chatId))throw new Error('会话运行中不能删除，请先停止')
        const timer=flushTimers.get(p.chatId);if(timer)clearTimeout(timer);flushTimers.delete(p.chatId)
        getDb().prepare('DELETE FROM chats WHERE chat_id = ?').run(p.chatId)
        return { ok: true }
      }
    },

    rename: {
      schema: z.object({ chatId: z.string().min(1), title: z.string().min(1) }),
      handler: async (p: { chatId: string; title: string }) => {
        getDb().prepare('UPDATE chats SET title = ?, auto_title=0 WHERE chat_id = ?').run(p.title, p.chatId)
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
          .prepare('SELECT msg_id, role, content, tool_calls, tool_result, reasoning, usage, refs, sources, created_at FROM messages WHERE chat_id = ? ORDER BY created_at, rowid LIMIT ?')
          .all(p.chatId, p.limit) as {
          msg_id: string
          role: string
          content: string | null
          tool_calls: string | null
          tool_result: string | null
          usage:string|null
          reasoning: string | null
          refs:string|null
          sources:string|null
          created_at: number
        }[]
        return {
          messages: rows.map((r) => ({
            msgId: r.msg_id,
            role: r.role,
            content: r.content,
            reasoning: r.reasoning,
            usage:r.usage?JSON.parse(r.usage):null,
            refs:r.refs?{...JSON.parse(r.refs),noteTitles:Object.fromEntries((JSON.parse(r.refs).noteIds??[]).map((id:string)=>[id,(getDb().prepare('SELECT title FROM notes WHERE note_id=?').get(id) as {title:string}|undefined)?.title??id]))}:null,
            sources:r.sources?JSON.parse(r.sources):[],
            toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : null,
            toolResult: r.tool_result ? JSON.parse(r.tool_result) : null,
            createdAt: r.created_at
          }))
        }
      }
    },

    send: {
      schema: z.object({ chatId: z.string().min(1), text: z.string().min(1),selection:selectionSchema,refs:refsSchema.optional(),useKnowledge:z.boolean().default(true) }),
      handler: async (p: { chatId: string; text: string;selection:ModelSelection;refs?:ChatRefs;useKnowledge:boolean }, ctx) => {
        const chat = getDb().prepare('SELECT * FROM chats WHERE chat_id = ?').get(p.chatId) as ChatRow | undefined
        if (!chat) throw new Error(`会话不存在: ${p.chatId}`)
        const selection=chatSelection(p.chatId)
        if(!selection||selection.providerId!==p.selection.providerId||selection.model!==p.selection.model)throw new Error('会话模型已变化，请重新选择后发送')
        await validateSelection(selection)
        const current=chatSelection(p.chatId)
        if(current?.providerId!==selection.providerId||current.model!==selection.model)throw new Error('会话模型已变化，请重试')
        resolveReferences(p.refs)
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
          refs:p.refs,useKnowledge:p.useKnowledge,
          noteId: chat.note_id,
          selection,
          onEvent: (topic, payload) => ctx.emit(topic, payload)
        }).then(result => {if(result.ok){scheduleFlush(p.chatId, ctx,selection);void autoTitle(p.chatId,ctx)}})
        return { ok: true }
      }
    },

    regenerate: {
      schema: z.object({chatId:z.string().min(1), selection:selectionSchema, acknowledgeChanges:z.boolean().default(false)}),
      handler: async (p:{chatId:string;selection:ModelSelection;acknowledgeChanges:boolean},ctx) => {
        if(ctx.source !== 'user') throw new Error('重新生成必须由用户发起')
        if(isChatRunning(p.chatId)) throw new Error('会话正在运行，请先停止')
        await validateSelection(p.selection)
        if(isChatRunning(p.chatId)) throw new Error('会话正在运行，请先停止')
        const current = chatSelection(p.chatId)
        if(current?.providerId!==p.selection.providerId || current.model!==p.selection.model) throw new Error('会话模型已变化，请重新选择')
        const db=getDb()
        const chat=db.prepare('SELECT note_id FROM chats WHERE chat_id=?').get(p.chatId) as {note_id:string|null}|undefined
        if(!chat) throw new Error('会话不存在')
        if(!p.acknowledgeChanges && db.prepare('SELECT 1 FROM vault_changes WHERE chat_id=? AND rolled_back=0 LIMIT 1').get(p.chatId))
          throw new Error('上一轮的笔记/文件变更不会自动撤销，可在保险箱中回滚；请先确认')
        const user=regenerationTurn(db,p.chatId)
        const saved=db.prepare('SELECT refs FROM messages WHERE chat_id=? AND rowid=?').get(p.chatId,user.rowid) as {refs:string|null}
        const refs=saved.refs?JSON.parse(saved.refs) as ChatRefs&{useKnowledge?:boolean}:undefined
        resolveReferences(refs)
        const timer=flushTimers.get(p.chatId);if(timer)clearTimeout(timer);flushTimers.delete(p.chatId)
        discardLastResponse(db,p.chatId,user.rowid)
        void runAgent({ctx,chatId:p.chatId,userText:user.content,noteId:chat.note_id,selection:p.selection,refs,useKnowledge:refs?.useKnowledge,reuseUserMessage:true,onEvent:ctx.emit})
          .then(result=>{if(result.ok)scheduleFlush(p.chatId,ctx,p.selection)})
        return {ok:true}
      }
    },

    confirmations:{schema:z.object({chatId:z.string()}),handler:async(p:{chatId:string})=>({items:(getDb().prepare('SELECT * FROM chat_confirmations WHERE chat_id=? ORDER BY created_at,rowid').all(p.chatId) as {id:string;chat_id:string;preview:string;state:string}[]).map(r=>({id:r.id,chatId:r.chat_id,preview:JSON.parse(r.preview),state:r.state==='pending'&&!isChatRunning(p.chatId)?'cancelled':r.state}))})},
    confirm: {
      schema: z.object({ id: z.string(), chatId: z.string(), approved: z.boolean(),override:z.record(z.string(),z.unknown()).optional() }),
      handler: async (p: {id:string;chatId:string;approved:boolean;override?:Record<string,unknown>}) => {
        respondConfirmation(p.id, p.chatId, p.approved,p.override)
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

    leave: {schema:z.object({chatId:z.string().min(1)}),handler:async(p:{chatId:string},ctx)=>{if((getSetting('memory.mode')??'economy')==='quality')void flushMemory(p.chatId,ctx);return {ok:true}}},
    flush_now: {
      schema: z.object({ chatId: z.string().min(1) }),
      handler: async (p: { chatId: string }, ctx) => {
        void flushMemory(p.chatId, ctx)
        return { ok: true }
      }
    }
  })
}
