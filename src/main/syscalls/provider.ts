import { z } from 'zod'
import {modelCatalog} from '../providers/catalog'
import { register } from './registry'
import {
  listProviderRows,
  upsertProvider,
  deleteProvider,
  maskRow,
  getProvider,
  type ModelsConfig
} from '../providers/store'
import { startChatGPTLogin, chatGPTStatus, chatGPTLogout, cancelChatGPTLogin } from '../providers/chatgpt'
import { PRESET_PROVIDERS } from '../providers/openai-compat'

/** provider 域（DEVELOPMENT.md §6.11） */

export function registerProviderDomain(): void {
  register('provider', {
    models: {
      schema:z.object({refresh:z.boolean().default(false)}).default({refresh:false}),
      handler:async(p:{refresh:boolean},ctx)=>{if(ctx.source!=='user')throw new Error('仅用户可读取模型目录');return{items:await modelCatalog(p.refresh)}}
    },
    presets: {
      handler: async () => ({ items: PRESET_PROVIDERS })
    },
    list: {
      handler: async () => ({ items: listProviderRows().map(maskRow), chatgpt: chatGPTStatus() })
    },
    save: {
      schema: z.object({
        id: z.string().min(1),
        kind: z.enum(['openai-compat', 'anthropic', 'chatgpt']).default('openai-compat'),
        name: z.string().min(1),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        models: z
          .object({
            fast: z.array(z.string()).default([]),
            expert: z.array(z.string()).default([]),
            defaultFast: z.string().optional(),
            defaultExpert: z.string().optional()
          })
          .optional(),
        enabled: z.boolean().optional()
      }),
      handler: async (
        p: { id: string; kind: 'openai-compat' | 'anthropic' | 'chatgpt'; name: string; baseUrl?: string; apiKey?: string; models?: ModelsConfig; enabled?: boolean },
        ctx
      ) => {
        const row = upsertProvider(p)
        ctx.emit('notes.changed', { kind: 'provider' })
        return maskRow(row)
      }
    },
    delete: {
      schema: z.object({ id: z.string().min(1) }),
      handler: async (p: { id: string },ctx) => {
        deleteProvider(p.id)
        ctx.emit('notes.changed',{kind:'provider'})
        return { ok: true }
      }
    },
    test: {
      schema: z.object({ id: z.string().min(1) }),
      handler: async (p: { id: string }) => {
        try {
          const provider = getProvider(p.id)
          const row = listProviderRows().find(r=>r.id===p.id)!
          const config = row.models ? JSON.parse(row.models) as ModelsConfig : undefined
          const models = await provider.listModels()
          const model = config?.defaultFast ?? config?.fast?.[0] ?? models[0]
          if (!model) throw new Error('未配置可测试的模型')
          let text = ''
          const result = await provider.stream({model,messages:[{role:'user',content:'Reply OK.'}],signal:AbortSignal.timeout(15_000)}, e=>{if(e.type==='text')text+=e.delta})
          if (!text.trim() || result.finishReason === 'length') throw new Error('模型未返回完整回复')
          return { ok: true, models, model, reply: text.slice(0,100) }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
    },
    chatgpt_login: {
      schema: z.object({newAccount:z.boolean().default(false)}).default({newAccount:false}),
      handler: async (p:{newAccount:boolean},ctx) => {
        if(ctx.source!=='user')throw new Error('ChatGPT 登录必须由用户在界面发起')
        // 确保有 chatgpt 行
        if (!listProviderRows().some((r) => r.id === 'chatgpt')) {
          upsertProvider({ id: 'chatgpt', kind: 'chatgpt', name: 'ChatGPT（官方授权）',enabled:false })
        }
        const result=await startChatGPTLogin(p.newAccount);ctx.emit('notes.changed',{kind:'provider'});return result
      }
    },
    chatgpt_cancel_login:{handler:async(_p,ctx)=>{if(ctx.source!=='user')throw new Error('仅用户可取消登录');cancelChatGPTLogin();return{ok:true}}},
    chatgpt_models:{handler:async(_p,ctx)=>{if(ctx.source!=='user')throw new Error('仅用户可刷新账号模型');const items=await modelCatalog(true);ctx.emit('notes.changed',{kind:'provider'});const p=items.find(p=>p.id==='chatgpt');if(!p?.ready||p.status.includes('失败'))throw new Error(p?.status??'请先登录');return{models:p.models.map(m=>m.id)}}},
    chatgpt_status: {
      handler: async () => chatGPTStatus()
    },
    chatgpt_logout: {
      handler: async (_p,ctx) => {
        if(ctx.source!=='user')throw new Error('仅用户可退出登录')
        const result=await chatGPTLogout();ctx.emit('notes.changed',{kind:'provider'});return {ok:true,...result}
      }
    }
  })
}
