import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOpenAICompat } from '../src/main/providers/openai-compat'
import type { StreamEvent } from '../src/main/providers/types'

/** M3/M4 验收：OpenAI 兼容 SSE 流解析（含 tool_calls 增量拼接），离线 stub fetch */

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i]))
          i++
        } else {
          controller.close()
        }
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  )
}

const provider = createOpenAICompat({
  id: 'test',
  name: '测试',
  baseUrl: 'https://fake.test/v1',
  apiKey: () => 'sk-test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openai-compat stream', () => {
  it('文本增量与 usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
          'data: [DONE]\n\n'
        ])
      )
    )
    const events: StreamEvent[] = []
    const finish = await provider.stream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal },
      (e) => events.push(e)
    )
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')
    expect(text).toBe('你好')
    expect(finish.finishReason).toBe('stop')
    expect(events.some((e) => e.type === 'usage')).toBe(true)
  })

  it('tool_calls 增量拼接', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"notes."}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"q"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\\":\\"测试\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n'
        ])
      )
    )
    const events: StreamEvent[] = []
    const finish = await provider.stream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal },
      (e) => events.push(e)
    )
    const tc = events.find((e) => e.type === 'tool_call') as { name: string; argsJson: string } | undefined
    expect(tc?.name).toBe('notes.search')
    expect(JSON.parse(tc?.argsJson ?? '{}')).toEqual({ query: '测试' })
    expect(finish.finishReason).toBe('tool_use')
  })

  it('HTTP 错误转 PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })))
    await expect(
      provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal }, () => undefined)
    ).rejects.toThrow(/401/)
  })

  it('未配置 key 抛 NO_PROVIDER', async () => {
    const p = createOpenAICompat({ id: 'x', name: 'x', baseUrl: 'https://x.test/v1', apiKey: () => '' })
    await expect(
      p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal }, () => undefined)
    ).rejects.toThrow('未配置')
  })
})

it('rejects truncated SSE instead of claiming completion', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])))
  await expect(provider.stream({model:'m',messages:[],signal:new AbortController().signal},()=>undefined)).rejects.toThrow('中断')
})
it('reads final SSE line without trailing newline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}'])))
  let text=''
  await provider.stream({model:'m',messages:[],signal:new AbortController().signal},e=>{if(e.type==='text')text+=e.delta})
  expect(text).toBe('ok')
})
it('model-list HTTP failure cannot report a successful connection', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('denied',{status:401})))
  await expect(provider.listModels()).rejects.toThrow('401')
})
