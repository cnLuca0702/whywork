// 本地伪造模型服务：OpenAI 兼容 /chat/completions、/models、/audio/transcriptions，Anthropic /messages。
// 只监听 127.0.0.1；所有请求被记录，供执行器断言“发往了哪个模型、带了什么上下文与工具”。
// 对话脚本由执行器按名称注册：用户消息中写 ⟦SCN:名称⟧ 选择脚本。
const http = require('node:http')

const SCN = /⟦SCN:([\w-]+)⟧/

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(p => (typeof p === 'string' ? p : p.text ?? p.content ?? '')).join('\n')
  return content == null ? '' : JSON.stringify(content)
}

/** 归一化 OpenAI / Anthropic 请求，得到脚本上下文 */
function contextOf(body, kind) {
  const messages = body.messages ?? []
  const system = kind === 'anthropic' ? textOf(body.system) : messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n')
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role !== 'user') return
    const t = textOf(m.content)
    // Anthropic 的工具结果也以 user 角色出现
    if (Array.isArray(m.content) && m.content.every(p => p.type === 'tool_result')) return
    if (t) lastUser = i
  })
  const after = messages.slice(lastUser + 1)
  const toolResults = after.flatMap(m => {
    if (m.role === 'tool') return [textOf(m.content)]
    if (Array.isArray(m.content)) return m.content.filter(p => p.type === 'tool_result').map(p => textOf(p.content))
    return []
  })
  const userText = lastUser >= 0 ? textOf(messages[lastUser].content) : ''
  // OpenAI 的 system 已在 messages 中，不能重复计入；Anthropic 的 system 在顶层字段
  const allText = [kind === 'anthropic' ? system : '', ...messages.map(m => textOf(m.content))].join('\n')
  const toolNames = (body.tools ?? []).map(t => t.function?.name ?? t.name).filter(Boolean)
  const scn = (allText.match(new RegExp(SCN.source, 'g')) ?? []).pop()?.match(SCN)?.[1] ?? null
  return { model: body.model, system, userText, allText, toolResults, step: toolResults.length, toolNames, scenario: scn, body }
}

function createFakeLlm() {
  const requests = []
  const scripts = new Map()
  const counters = new Map()
  let bgHandler = null
  let asrText = 'RT-ASR-TRANSCRIPT 北辰计划 周岚 负责上线。'

  const nextCount = key => { const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return n }

  /** 默认后台模型：按任务类型返回可解析的内容 */
  function defaultBackground(ctx) {
    const t = ctx.allText
    if (/\"slides\"/.test(t)) return { text: JSON.stringify({slides:[{title:'合成页纲',bullets:['来自测试夹具的要点']}]}) }
    if (/FAIL-ME/.test(t)) return { text: '这不是 JSON' }
    if (/JSON|json/.test(t) && /摘要|summary/i.test(t)) return { text: JSON.stringify({ summary: 'RT合成摘要', keywords: ['北辰', '验收'], topic: 'RT主题' }) }
    if (/纪要|minutes/i.test(t)) return { text: '## 概览\nRT合成纪要\n\n## 决定\n- 无\n\n## 待办\n- 无' }
    if (/记忆|memory/i.test(t)) return { text: '' }
    if (/标题|title/i.test(t)) return { text: '合成标题' }
    return { text: 'RT合成后台回复' }
  }

  function decide(ctx) {
    if (ctx.model === 'bg-model') return (bgHandler ?? defaultBackground)(ctx, nextCount('bg'))
    if (ctx.scenario && scripts.has(ctx.scenario)) return scripts.get(ctx.scenario)(ctx, nextCount(ctx.scenario))
    return { text: `RT默认回复 #${nextCount('default')}` }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  async function openaiStream(res, out) {
    if (out.delayMs) await sleep(out.delayMs)
    if (out.error) {
      res.writeHead(out.error.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out.error.body ?? { error: { message: 'synthetic error', type: 'synthetic', code: String(out.error.status) } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n')
    for (const r of [].concat(out.reasoning ?? [])) send({ choices: [{ index: 0, delta: { reasoning_content: r } }] })
    if (out.tool) {
      const calls = [].concat(out.tool)
      calls.forEach((c, i) => send({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_rt_${Date.now()}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }] } }] }))
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      for (const piece of [].concat(out.chunks ?? out.text ?? '')) send({ choices: [{ index: 0, delta: { content: piece } }] })
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    if (out.usage) send({ choices: [], usage: { prompt_tokens: out.usage.input, completion_tokens: out.usage.output, total_tokens: out.usage.input + out.usage.output } })
    res.end('data: [DONE]\n\n')
  }

  async function anthropicStream(res, out) {
    if (out.delayMs) await sleep(out.delayMs)
    if (out.error) {
      res.writeHead(out.error.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'synthetic_error', message: 'synthetic error' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    ev('message_start', { type: 'message_start', message: { id: 'msg_rt', type: 'message', role: 'assistant', content: [], model: 'claude-scripted', usage: { input_tokens: 10, output_tokens: 0 } } })
    let idx = 0
    if (out.reasoning) {
      ev('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } })
      for (const r of [].concat(out.reasoning)) ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: r } })
      ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: 'rt-signature' } })
      ev('content_block_stop', { type: 'content_block_stop', index: idx }); idx++
    }
    ev('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } })
    for (const piece of [].concat(out.chunks ?? out.text ?? '')) ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: piece } })
    ev('content_block_stop', { type: 'content_block_stop', index: idx })
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
    ev('message_stop', { type: 'message_stop' })
    res.end()
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      const url = req.url ?? ''
      const record = { at: Date.now(), method: req.method, path: url, headers: req.headers }
      try {
        if (req.method === 'GET' && /\/models$/.test(url)) {
          requests.push({ ...record, kind: 'models' })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ data: ['scripted', 'bg-model', 'unchecked-model', 'claude-scripted'].map(id => ({ id, type: 'model', display_name: id })) }))
          return
        }
        if (/\/audio\/transcriptions$/.test(url)) {
          const text = raw.toString('latin1')
          const field = name => {
            const m = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))
            return m ? Buffer.from(m[1], 'latin1').toString('utf-8') : null
          }
          requests.push({ ...record, kind: 'asr', prompt: field('prompt'), language: field('language'), model: field('model'), bytes: raw.length })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text: asrText }))
          return
        }
        const body = raw.length ? JSON.parse(raw.toString('utf-8')) : {}
        if (/\/messages$/.test(url)) {
          const ctx = contextOf(body, 'anthropic')
          requests.push({ ...record, kind: 'anthropic', model: body.model, ctx })
          await anthropicStream(res, await decide(ctx))
          return
        }
        if (/\/chat\/completions$/.test(url)) {
          const ctx = contextOf(body, 'openai')
          requests.push({ ...record, kind: 'chat', model: body.model, ctx })
          const out = await decide(ctx)
          if (body.stream === false) {
            if (out.error) { res.writeHead(out.error.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.error.body ?? {})); return }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: [].concat(out.chunks ?? out.text ?? '').join('') }, finish_reason: 'stop' }], usage: out.usage ? { prompt_tokens: out.usage.input, completion_tokens: out.usage.output } : undefined }))
            return
          }
          await openaiStream(res, out)
          return
        }
        requests.push({ ...record, kind: 'unknown' })
        res.writeHead(404); res.end('not found')
      } catch (e) {
        requests.push({ ...record, kind: 'crash', error: String(e) })
        if (!res.headersSent) res.writeHead(500)
        res.end(String(e))
      }
    })
  })

  return {
    requests,
    start: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise(resolve => server.close(() => resolve())),
    script: (name, fn) => scripts.set(name, fn),
    setBackground: fn => { bgHandler = fn },
    setAsrText: t => { asrText = t },
    chatRequests: (filter = {}) => requests.filter(r => (r.kind === 'chat' || r.kind === 'anthropic') && (!filter.model || r.model === filter.model) && (!filter.scenario || r.ctx?.scenario === filter.scenario)),
    mark: () => requests.length
  }
}

module.exports = { createFakeLlm }
