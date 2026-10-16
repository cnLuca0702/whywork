import type { ChatProvider, StreamEvent, StreamRequest, ToolCall } from './types'
import { ProviderError } from './types'

/** OpenAI 兼容实现（DeepSeek / GLM / MiniMax / 自定义共用，DEVELOPMENT.md §8.2）
 *  SSE 流式 + tool_calls（增量拼接） */

export interface OpenAICompatConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: () => string
  defaultModels?: string[]
}

export const PRESET_PROVIDERS: { kind?: 'openai-compat'|'anthropic'; id: string; name: string; baseUrl: string; models: string[] }[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-4.5']
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M2', 'MiniMax-Text-01']
  },
  {id:'anthropic',kind:'anthropic',name:'Anthropic',baseUrl:'https://api.anthropic.com',models:[]},
  {
    id: 'openai-compat',
    name: '自定义 OpenAI 兼容',
    baseUrl: '',
    models: []
  }
]

export function createOpenAICompat(cfg: OpenAICompatConfig): ChatProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    async listModels() {
      const key = cfg.apiKey()
      if (!key) throw new ProviderError('NO_PROVIDER', `${cfg.name} 未配置 API Key`)
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `${cfg.name} HTTP ${res.status}`)
      const j = await res.json() as {data?:{id:string}[]}
      return (j.data ?? []).map(m => m.id)
    },

    async stream(req: StreamRequest, emit: (e: StreamEvent) => void) {
      const key = cfg.apiKey()
      if (!key) throw new ProviderError('NO_PROVIDER', `${cfg.name} 未配置 API Key`)

      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.name ? { name: m.name } : {})
        })),
        stream: true,
        stream_options: { include_usage: true }
      }
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools
        body.tool_choice = 'auto'
      }

      let res: Response
      try {
        res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: req.signal
        })
      } catch (e) {
        if (req.signal.aborted) throw new ProviderError('ABORTED', '已取消')
        throw new ProviderError('NETWORK_ERROR', `网络错误: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new ProviderError('PROVIDER_ERROR', `${cfg.name} HTTP ${res.status}: ${text.slice(0, 300)}`)
      }

      // SSE 解析
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const toolAcc = new Map<number, ToolCall>()
      let completed = false
      let finishReason: 'stop' | 'tool_use' | 'length' = 'stop'

      const handleChunk = (payload: string): void => {
        if (payload === '[DONE]') { completed = true; return }
        let j: {
          choices?: { delta?: { content?: string | null; reasoning_content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        try {
          j = JSON.parse(payload)
        } catch {
          return
        }
        const choice = j.choices?.[0]
        if (choice?.delta?.reasoning_content) emit({ type: 'reasoning', delta: choice.delta.reasoning_content })
        if (choice?.delta?.content) emit({ type: 'text', delta: choice.delta.content })
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const cur = toolAcc.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, type: 'function' as const, function: { name: '', arguments: '' } }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.function.name += tc.function.name
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
          toolAcc.set(tc.index, cur)
        }
        if (choice?.finish_reason) completed = true
        if (choice?.finish_reason === 'tool_calls') finishReason = 'tool_use'
        if (choice?.finish_reason === 'length') finishReason = 'length'
        if (j.usage) emit({ type: 'usage', input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 })
      }

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (line.startsWith('data:')) handleChunk(line.slice(5).trim())
          }
        }
      } catch (e) {
        if (req.signal.aborted) throw new ProviderError('ABORTED', '已取消')
        throw new ProviderError('NETWORK_ERROR', `流中断: ${e instanceof Error ? e.message : String(e)}`)
      }

      buf += decoder.decode()
      if (buf.trim().startsWith('data:')) handleChunk(buf.trim().slice(5).trim())
      if (!completed) throw new ProviderError('NETWORK_ERROR', '流在结束标记前中断')
      for (const tc of [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) {
        emit({ type: 'tool_call', id: tc.id, name: tc.function.name, argsJson: tc.function.arguments || '{}' })
      }
      return { finishReason: toolAcc.size > 0 ? 'tool_use' : finishReason }
    }
  }
}
