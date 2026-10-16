// REMIO-R 自动用例实现。每个函数接收执行器 harness（见 run.cjs），返回通过说明，失败时抛错。
// 只依赖 docs/CODEX-TASKS-REMIO.md 的接口契约、界面文案与伪造服务记录，不依赖产品内部函数。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const ok = (cond, msg) => { if (!cond) throw new Error(msg) }
const arg = (ctx, key) => (ctx.userText.match(new RegExp(`${key}=([^\\s;⟧]+)`)) ?? [])[1]
const rid = () => crypto.randomBytes(3).toString('hex')
const indexRe = i => new RegExp(`第\\s*${i}\\s*条|edits\\[${i - 1}\\]`)
const items = r => r?.items ?? r?.results ?? r?.changes ?? r?.notes ?? r?.tools ?? r?.events ?? []
const idOf = x => x?.changeId ?? x?.change_id ?? x?.itemId ?? x?.id
const statusText = e => JSON.stringify(e?.payload ?? e ?? '')
const isDeleted = n => { const o = n.note ?? n; return Boolean(o.deleted_at ?? o.deletedAt ?? o.deleted) }

/** 让 Agent 依次调用若干工具，最后输出文本 */
const toolSeq = (calls, final = '完成') => (ctx) => (ctx.step < calls.length ? { tool: typeof calls[ctx.step] === 'function' ? calls[ctx.step](ctx) : calls[ctx.step] } : { text: final })

async function editCase(h, caseId) {
  const spec = JSON.parse(fs.readFileSync(path.join(h.ORACLE, 'edit-cases.json'), 'utf-8')).cases.find(c => c.id === caseId)
  const base = fs.readFileSync(path.join(h.FX, 'notes/edit-target.md'), 'utf-8')
  const noteId = await h.mk(`编辑目标-${caseId}-${rid()}`, base)
  const before = await h.body(noteId)
  const r = await h.raw('notes.update', { noteId, edits: spec.edits })
  if (r.error?.code === 'UNKNOWN_ACTION') throw new h.NotImplemented('notes.update 不存在')
  const after = await h.body(noteId)
  if (spec.expect.ok) {
    ok(r.ok, `期望成功，实际：${r.error?.message}`)
    for (const s of spec.expect.contains) ok(after.includes(s), `缺少 ${s}`)
    for (const s of spec.expect.notContains ?? []) ok(!after.includes(s), `不应包含 ${s}`)
    for (const [s, n] of Object.entries(spec.expect.countOf ?? {})) {
      const count = after.split(new RegExp(`${s}(?![-\\w])`)).length - 1
      ok(count === n, `${s} 出现 ${count} 次，期望 ${n}`)
    }
    return '编辑结果符合 oracle'
  }
  ok(!r.ok, '期望失败，实际成功')
  const msg = r.error?.message ?? ''
  ok(spec.expect.keywords.some(k => msg.includes(k)), `错误信息缺少关键词 ${spec.expect.keywords}：${msg}`)
  ok(indexRe(spec.expect.index).test(msg), `错误信息未指明第 ${spec.expect.index} 条：${msg}`)
  ok(after === before, '失败时正文被修改')
  return `正确拒绝：${msg}`
}

async function sourcesOf(h, chatId) {
  const msgs = await h.messages(chatId)
  const a = h.lastAssistant(msgs)
  return (a?.sources ?? []).map(s => ({ n: Number(s.n ?? s.index ?? s.docIndex), noteId: s.noteId ?? s.note_id }))
}

/** 解析工具结果中的 “[来源 n] 标题” 登记，返回目标笔记的编号 */
function sourceNumber(ctx, re) {
  const all = ctx.toolResults.join('\n')
  for (const m of all.matchAll(/\[来源\s*(\d+)\]\s*([^\n]*)/g)) if (re.test(m[2])) return Number(m[1])
  return 1
}

async function waitFor(fn, timeout = 20_000, what = '条件') {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { last = await fn(); if (last) return last } catch (e) { if (e?.fatal || e?.name === 'NotImplemented' || e?.constructor?.name === 'NotImplemented') throw e } await new Promise(r => setTimeout(r, 300)) }
  throw new Error(`等待${what}超时`)
}

async function hoverAssistant(h) {
  const msg = h.chatPane().locator('.ww-assistant, [data-role="assistant"], .ww-markdown').last()
  await msg.hover()
  return msg
}

/** 保存 HTTP 类 MCP 服务器；旧契约（仅 stdio、必须 command）拒绝时归为“未实现” */
async function saveHttpMcp(h, payload) {
  const r = await h.raw('mcp.servers_save', payload)
  if (r.ok) return r.data
  if (r.error?.code === 'UNKNOWN_ACTION' || (r.error?.code === 'BAD_PAYLOAD' && /command|transport/.test(r.error.message))) throw new h.NotImplemented('MCP HTTP 传输未实现（servers_save 仍要求 command）')
  throw new Error(`[${r.error?.code}] mcp.servers_save: ${r.error?.message}`)
}

/** “测试连接”：任务书未命名，依次尝试 mcp.test_connection / mcp.test / mcp.tools */
async function testMcp(h, serverId) {
  for (const [a, p] of [['mcp.test_connection', { serverId }], ['mcp.test', { id: serverId }], ['mcp.tools', { serverId }]]) {
    const r = await h.raw(a, p)
    if (r.error?.code !== 'UNKNOWN_ACTION') return r
  }
  throw new h.NotImplemented('MCP 测试连接接口')
}

/** OCR 公共准备：导入图片并等到可被检索，不做标注断言 */
async function ocrImport(h) {
  if (h.cache.ocrNote) return h.cache.ocrNote
  const [noteId] = await h.importFiles([path.join(h.WFX, 'images/ocr-clean.png')])
  const hit = await waitFor(async () => items(await h.call('notes.list', { query: 'OCR_MARKER_742' })).find(i => (i.noteId ?? i.note_id) === noteId), 90_000, 'OCR 入索引')
  h.cache.ocrNote = noteId; h.cache.ocrHit = hit
  return noteId
}

module.exports = {
  // ============================== R1 ==============================
  async 'RT-R1-01'(h) {
    await h.mk('RT双链目标', '双链目标正文')
    h.llm.script('r1-01', () => ({ text: '## 合成回复\n\n| 项 | 数 |\n| --- | --- |\n| 甲 | 1 |\n\n```javascript\nconst answer = 42;\n```\n\n$x^2$ 与 [[RT双链目标]]' }))
    const chatId = await h.chat('RT-R1-01 渲染'); await h.send(chatId, '⟦SCN:r1-01⟧ 渲染')
    await h.openChatUi('RT-R1-01 渲染')
    const pane = h.chatPane()
    await h.needUi(pane.locator('table'), '消息中的表格')
    ok(await pane.locator('.katex').count() >= 1, '没有 KaTeX 节点')
    ok(await pane.locator('[class*="hljs-"]').count() > 0, '代码未高亮')
    const link = pane.getByText('RT双链目标').last()
    await link.click()
    ok(await h.exists(h.page.locator('.ww-resource-pane').getByText('双链目标正文')), '点击双链未打开笔记')
    return '表格/高亮/公式/双链均渲染且双链可打开'
  },
  async 'RT-R1-02'(h) {
    h.llm.script('r1-02', () => ({ text: '安全测试<script>window.__rtXss=1</script><img src="x" onerror="window.__rtXss=2"> [点我](javascript:window.__rtXss=3)' }))
    const chatId = await h.chat('RT-R1-02 净化'); await h.send(chatId, '⟦SCN:r1-02⟧ x')
    await h.openChatUi('RT-R1-02 净化')
    const pane = h.chatPane()
    await h.needUi(pane.getByText('安全测试'), '回复文本')
    ok(await pane.locator('script').count() === 0, '存在 script 元素')
    ok(await pane.locator('[onerror]').count() === 0, '存在 onerror 属性')
    ok(await pane.locator('a[href^="javascript:"]').count() === 0, '存在 javascript: 链接')
    ok(await h.page.evaluate(() => window.__rtXss) === undefined, '注入脚本被执行')
    return '注入内容全部被净化'
  },
  async 'RT-R1-03'(h) {
    h.llm.script('r1-03', () => ({ text: '未闭合测试\n```js\nconst brokenFence = 1\n\n$$x + y' }))
    const chatId = await h.chat('RT-R1-03 不完整'); await h.send(chatId, '⟦SCN:r1-03⟧ x')
    await h.openChatUi('RT-R1-03 不完整')
    await h.needUi(h.chatPane().getByText('brokenFence', { exact: false }), '回复文字')
    ok(h.newPageErrors().length === 0, `出现页面错误：${h.newPageErrors().join('; ')}`)
    return '不完整 Markdown 正常显示'
  },
  async 'RT-R1-04'(h) {
    h.llm.script('r1-04', () => ({ reasoning: ['推理一', '推理二', '推理三'], text: 'R1-04正文' }))
    const chatId = await h.chat('RT-R1-04 推理'); await h.send(chatId, '⟦SCN:r1-04⟧ x')
    const evs = (await h.events()).filter(e => e.topic === 'chat.reasoning' && e.payload?.chatId === chatId)
    ok(evs.length > 0, '没有 chat.reasoning 事件')
    const a = h.lastAssistant(await h.messages(chatId))
    ok(a?.reasoning === '推理一推理二推理三', `持久化推理不一致：${a?.reasoning}`)
    ok((a.content ?? '').includes('R1-04正文'), '正文缺失')
    return `收到 ${evs.length} 个推理事件并持久化`
  },
  async 'RT-R1-05'(h) {
    const id = 'anthropic-rt-fake'
    await h.call('provider.save', { id, kind: 'anthropic', name: 'RT伪造Anthropic', baseUrl: h.llmUrl, apiKey: 'synthetic-only', models: { fast: ['claude-scripted'], expert: [] } })
    h.llm.script('r1-05', () => ({ reasoning: ['A思考片段'], text: 'R1-05正文' }))
    const selection = { providerId: id, model: 'claude-scripted' }
    const chatId = (await h.call('chat.create', { title: 'RT-R1-05', selection })).chatId
    await h.send(chatId, '⟦SCN:r1-05⟧ x', { selection })
    const a = h.lastAssistant(await h.messages(chatId))
    ok((a?.reasoning ?? '').includes('A思考片段'), `thinking 未解析：${a?.reasoning}`)
    ok((a?.content ?? '').includes('R1-05正文'), '正文缺失')
    return 'thinking_delta 解析并持久化'
  },
  async 'RT-R1-06'(h) {
    h.llm.script('r1-06', () => ({ reasoning: ['折叠推理内容RT'], text: 'R1-06正文' }))
    const chatId = await h.chat('RT-R1-06 折叠'); await h.send(chatId, '⟦SCN:r1-06⟧ x')
    await h.openChatUi('RT-R1-06 折叠')
    const label = await h.needUi(h.chatPane().getByText(/已思考/), '“已思考”标签')
    ok(/\d+\s*字/.test(await label.innerText()), '标签未显示字数')
    ok(!(await h.chatPane().getByText('折叠推理内容RT').isVisible().catch(() => false)), '推理默认未折叠')
    await label.click()
    ok(await h.exists(h.chatPane().getByText('折叠推理内容RT')), '展开后看不到推理')
    return '默认折叠，可展开'
  },
  async 'RT-R1-07'(h) {
    h.llm.script('r1-07', (ctx, n) => ({ text: `回复 #${n}` }))
    const chatId = await h.chat('RT-R1-07 重新生成'); await h.send(chatId, '⟦SCN:r1-07⟧ x')
    const before = (await h.events()).length
    await h.call('chat.regenerate', { chatId, selection: h.sel })
    await h.waitEvent((e, i) => e.topic === 'chat.done' && e.payload?.chatId === chatId && (e.t >= 0), 30_000, 'chat.done')
    await waitFor(async () => (await h.messages(chatId)).some(m => m.role === 'assistant' && m.content === '回复 #2'), 15_000, '新回复')
    const msgs = await h.messages(chatId)
    ok(msgs.filter(m => m.role === 'user').length === 1, '用户消息数不为 1')
    const assistants = msgs.filter(m => m.role === 'assistant' && m.content)
    ok(assistants.length === 1 && assistants[0].content === '回复 #2', `助手消息异常：${assistants.map(m => m.content)}`)
    void before
    return '只替换最后一轮'
  },
  async 'RT-R1-08'(h) {
    h.llm.script('r1-08', () => ({ delayMs: 4000, text: '慢回复' }))
    const chatId = await h.chat('RT-R1-08'); await h.send(chatId, '⟦SCN:r1-08⟧ x', {}, { noWait: true })
    await h.sleep(500)
    await h.reject('chat.regenerate', { chatId, selection: h.sel })
    await h.waitEvent(e => e.topic === 'chat.done' && e.payload?.chatId === chatId, 20_000, '完成')
    ok((await h.messages(chatId)).filter(m => m.role === 'assistant' && m.content).length === 1, '出现多轮回复')
    return '运行中被拒绝'
  },
  async 'RT-R1-09'(h) {
    const text = '复制原文 **加粗** 与 `代码`'
    h.llm.script('r1-09', () => ({ text }))
    const chatId = await h.chat('RT-R1-09 复制'); await h.send(chatId, '⟦SCN:r1-09⟧ x')
    await h.openChatUi('RT-R1-09 复制')
    await hoverAssistant(h)
    await (await h.needUi(h.chatPane().getByRole('button', { name: /^复制(\s*Markdown)?$/ }).last(), '“复制”按钮')).click()
    const clip = await h.clipboard()
    ok(clip === text, `剪贴板：${clip}`)
    return '复制 Markdown 原文'
  },
  async 'RT-R1-10'(h) {
    h.llm.script('r1-10', toolSeq([{ name: 'notes__create', args: { title: 'RT-R1-10 Agent 新建', body: '内容' } }], '已新建'))
    const chatId = await h.chat('RT-R1-10 重新生成提示'); await h.send(chatId, '⟦SCN:r1-10⟧ x', {}, { confirm: () => ({ approved: true }) })
    await h.openChatUi('RT-R1-10 重新生成提示')
    await hoverAssistant(h)
    const mark = h.llm.mark()
    await (await h.needUi(h.chatPane().getByRole('button', { name: '重新生成' }), '“重新生成”按钮')).click()
    await h.needUi(h.page.getByText(/不会自动撤销/), '保险箱变更提示')
    await h.page.getByRole('button', { name: /取\s*消/ }).last().click()
    await h.sleep(800)
    ok(h.reqsSince(mark, { scenario: 'r1-10' }).length === 0, '取消后仍发起了重新生成')
    return '先提示且取消后不重跑'
  },

  // ============================== R11 ==============================
  async 'RT-R11-01'(h) {
    await h.bg(false)
    const noteId = await h.mk('RT-R11-01 摘要', '正文')
    const mark = h.llm.mark()
    await h.reject('llm.summarize', { noteId }, /后台任务模型/)
    ok(h.llm.requests.length === mark, '仍向模型发出了请求')
    return '明确报错且无请求'
  },
  async 'RT-R11-02'(h) {
    await h.bg(true)
    const noteId = await h.mk('RT-R11-02 摘要', '北辰计划正文')
    const mark = h.llm.mark()
    await h.call('llm.summarize', { noteId })
    ok(h.reqsSince(mark, { model: 'bg-model' }).length >= 1, '未请求 bg-model')
    ok(h.reqsSince(mark).every(r => r.model === 'bg-model'), '有请求发往其他模型')
    const n = await h.note(noteId)
    ok(Number(h.noteField(n, 'processed')) === 1, 'processed 未置 1')
    ok(String(h.noteField(n, 'summary') ?? '').includes('RT合成摘要'), '摘要未写入')
    return '路由正确并回写'
  },
  async 'RT-R11-03'(h) {
    const r = await h.raw('settings.set', { settings: { 'ai.backgroundModel': JSON.stringify({ providerId: h.PROVIDER, model: 'unchecked-model' }) } })
    if (r.ok) {
      const noteId = await h.mk('RT-R11-03', '正文'); const mark = h.llm.mark()
      await h.reject('llm.summarize', { noteId })
      ok(h.llm.requests.slice(mark).filter(x => x.kind === 'chat').length === 0, '向模型发出了请求')
    }
    await h.bg(true)
    return r.ok ? '使用时拒绝且无请求' : '设置时即拒绝'
  },
  async 'RT-R11-04'(h) {
    const v = await h.getSetting('search.mode')
    ok(v == null || v === 'basic', `默认值为 ${v}`)
    await h.settings({ 'search.braveKey': null, 'search.tavilyKey': null })
    const r = await h.raw('settings.set', { settings: { 'search.mode': 'hq_first' } })
    const after = await h.getSetting('search.mode')
    ok(!r.ok || after == null || after === 'basic', `无 Key 时被设为 ${after}`)
    return r.ok ? '保持 basic' : '设置被拒绝'
  },
  async 'RT-R11-05'(h) {
    await h.settings({ 'search.braveKey': null })
    const msg = await h.reject('web.verify_key', { engine: 'brave' }, /未配置|Key|密钥/i)
    return msg
  },
  async 'RT-R11-06'(h) {
    h.llm.script('r11-06', () => ({ error: { status: 401, body: { error: { message: 'invalid api key', type: 'invalid_request_error', code: 'invalid_api_key' } } } }))
    const chatId = await h.chat('RT-R11-06'); const e = await h.send(chatId, '⟦SCN:r11-06⟧ x')
    ok(e.topic === 'chat.error' && /密钥/.test(statusText(e)), `提示：${statusText(e)}`)
    return statusText(e)
  },
  async 'RT-R11-07'(h) {
    h.llm.script('r11-07', () => ({ error: { status: 429, body: { error: { message: 'rate limited', type: 'rate_limit', code: 'rate_limit_exceeded' } } } }))
    const chatId = await h.chat('RT-R11-07'); const e = await h.send(chatId, '⟦SCN:r11-07⟧ x')
    ok(/繁忙/.test(statusText(e)) && /无关/.test(statusText(e)), `提示：${statusText(e)}`)
    return statusText(e)
  },
  async 'RT-R11-08'(h) {
    h.llm.script('r11-08', () => ({ error: { status: 400, body: { error: { message: "This model's maximum context length is 8192 tokens", type: 'invalid_request_error', code: 'context_length_exceeded' } } } }))
    const chatId = await h.chat('RT-R11-08'); const e = await h.send(chatId, '⟦SCN:r11-08⟧ x')
    ok(/过长/.test(statusText(e)), `提示：${statusText(e)}`)
    return statusText(e)
  },
  async 'RT-R11-09'(h) {
    const id = 'openai-compat:rt-dead'
    await h.call('provider.save', { id, kind: 'openai-compat', name: 'RT关闭端口', baseUrl: 'http://127.0.0.1:9', apiKey: 'synthetic-only', models: { fast: ['scripted'], expert: [] } })
    const selection = { providerId: id, model: 'scripted' }
    const c = await h.raw('chat.create', { title: 'RT-R11-09', selection })
    if (!c.ok) { ok(/网络|无法连接/.test(c.error.message), `创建会话失败但提示不符：${c.error.message}`); return c.error.message }
    const s = await h.raw('chat.send', { chatId: c.data.chatId, text: 'x', selection })
    if (!s.ok) { ok(/网络|无法连接/.test(s.error.message), `提示：${s.error.message}`); return s.error.message }
    const e = await h.waitEvent(x => (x.topic === 'chat.error' || x.topic === 'chat.done') && x.payload?.chatId === c.data.chatId, 30_000, '结束')
    ok(e.topic === 'chat.error' && /网络|无法连接/.test(statusText(e)), `提示：${statusText(e)}`)
    await h.call('provider.delete', { id }).catch(() => {})
    return statusText(e)
  },
  async 'RT-R11-10'(h) {
    h.llm.script('r11-10', () => ({ text: '用量测试', usage: { input: 123, output: 45 } }))
    const chatId = await h.chat('RT-R11-10'); await h.send(chatId, '⟦SCN:r11-10⟧ x')
    const u = h.lastAssistant(await h.messages(chatId))?.usage
    ok(u && Number(u.input) === 123 && Number(u.output) === 45 && Number(u.calls) >= 1, `usage=${JSON.stringify(u)}`)
    return JSON.stringify(u)
  },
  async 'RT-R11-11'(h) {
    await h.bg(true); await h.settings({ 'chat.autoTitle': 'false', 'memory.mode': 'off' }).catch(() => h.settings({ 'chat.autoTitle': 'false' }))
    h.llm.script('r11-11', () => ({ text: '对话回复' }))
    const mark = h.llm.mark()
    const chatId = await h.chat('RT-R11-11'); await h.send(chatId, '⟦SCN:r11-11⟧ x')
    const reqs = h.reqsSince(mark, { scenario: 'r11-11' })
    ok(reqs.length >= 1 && reqs.every(r => r.model === 'scripted'), `对话请求模型：${reqs.map(r => r.model)}`)
    return '对话使用会话所选模型'
  },

  // ============================== R5 ==============================
  'RT-R5-01': h => editCase(h, 'E01'),
  'RT-R5-02': h => editCase(h, 'E02'),
  'RT-R5-03': h => editCase(h, 'E03'),
  'RT-R5-04': h => editCase(h, 'E04'),
  'RT-R5-05': h => editCase(h, 'E05'),
  'RT-R5-06': h => editCase(h, 'E06'),
  async 'RT-R5-07'(h) {
    const noteId = await h.mk('RT-R5-07', '第一段')
    await h.call('notes.update', { noteId, append: 'APPEND-1' })
    const b = await h.body(noteId)
    ok(/第一段\s*\n\s*\nAPPEND-1\s*$/.test(b), `追加结果：${JSON.stringify(b)}`)
    await h.reject('notes.update', { noteId, append: '' })
    return '空行分隔且拒绝空串'
  },
  async 'RT-R5-08'(h) {
    const noteId = await h.mk('RT-R5-08', '原文 X')
    await h.reject('notes.update', { noteId, body: '新', edits: [{ oldText: '原文', newText: '改' }] })
    await h.reject('notes.update', { noteId, edits: [{ oldText: '原文', newText: '改' }], append: 'Y' })
    ok((await h.body(noteId)).includes('原文 X'), '正文被修改')
    return '互斥校验生效'
  },
  async 'RT-R5-09'(h) {
    const noteId = await h.mk('RT标题', '# RT标题\n正文一')
    ok(!(await h.body(noteId)).trimStart().startsWith('# RT标题'), '创建时未去除重复 H1')
    await h.call('notes.update', { noteId, body: '# RT标题\n正文二' })
    const b = await h.body(noteId)
    ok(!b.trimStart().startsWith('# RT标题') && b.includes('正文二'), `更新后：${b}`)
    return '创建与更新均去除'
  },
  async 'RT-R5-10'(h) {
    const [noteId] = await h.importFiles([path.join(h.WFX, 'pdf/星河资料.pdf')])
    const before = await h.body(noteId)
    h.llm.script('r5-10', toolSeq([
      ctx => ({ name: 'notes__update', args: { noteId: arg(ctx, 'noteId'), body: 'AGENT 覆盖正文' } }),
      ctx => ({ name: 'notes__update', args: { noteId: arg(ctx, 'noteId'), title: 'RT-R5-10 改名' } })
    ]))
    const mark = h.llm.mark()
    const chatId = await h.chat('RT-R5-10'); await h.send(chatId, `⟦SCN:r5-10⟧ noteId=${noteId}`, {}, { confirm: () => ({ approved: true }) })
    const last = h.reqsSince(mark, { scenario: 'r5-10' }).pop()
    ok(/错误|拒绝|不/.test(last.ctx.toolResults[0] ?? ''), `改正文未报错：${last.ctx.toolResults[0]}`)
    ok((await h.body(noteId)) === before, 'PDF 正文被 Agent 改写')
    const n = await h.note(noteId)
    ok(h.noteField(n, 'title') === 'RT-R5-10 改名', '标题未更新')
    h.cache.pdfNote = noteId
    return '正文受保护，标题可改'
  },
  async 'RT-R5-11'(h) {
    const noteId = h.cache.pdfNote ?? (await h.importFiles([path.join(h.WFX, 'pdf/星河资料.pdf')]))[0]
    await h.call('notes.update', { noteId, body: '用户手动编辑 RT-R5-11' })
    ok((await h.body(noteId)).includes('RT-R5-11'), '用户编辑未生效')
    return '用户编辑不受影响'
  },
  async 'RT-R5-12'(h) {
    const tag = 'R512' + rid()
    const fav = await h.mk(`${tag} 收藏`, `${tag} 正文`), col = await h.mk(`${tag} 集合`, `${tag} 正文`), plain = await h.mk(`${tag} 普通`, `${tag} 正文`)
    await h.call('notes.set_status', { noteId: fav, favorite: true })
    await h.call('collections.add_note', { noteId: col, collectionTitle: `${tag}集合` })
    const s = async p => items(await h.call('notes.search', { query: tag, ...p })).map(i => i.noteId ?? i.note_id)
    const byFav = await s({ status: { favorite: true } })
    ok(byFav.length === 1 && byFav[0] === fav, `收藏过滤：${byFav}`)
    const byCol = await s({ collection: `${tag}集合` })
    ok(byCol.length === 1 && byCol[0] === col, `集合过滤：${byCol}`)
    const fromToday = await s({ timeFrom: h.today() })
    ok([fav, col, plain].every(id => fromToday.includes(id)), 'timeFrom=今天 未包含今天的笔记')
    const toToday = await s({ timeTo: h.today() })
    ok(![fav, col, plain].some(id => toToday.includes(id)), 'timeTo=今天 不应包含今天（左闭右开）')
    h.cache.r512 = { tag }
    return '状态/集合/时间过滤正确'
  },
  async 'RT-R5-13'(h) {
    const tag = 'R513' + rid()
    for (let i = 0; i < 105; i++) await h.mk(`${tag} 第${i}`, `${tag}`)
    const r = await h.call('notes.search', { query: tag })
    ok(items(r).length === 20 && Number(r.showing ?? items(r).length) === 20, `默认返回 ${items(r).length}`)
    ok(Number(r.total) >= 105, `total=${r.total}`)
    const big = await h.raw('notes.search', { query: tag, limit: 500 })
    ok(!big.ok || items(big.data).length <= 100, `limit=500 返回 ${items(big.data).length}`)
    return `total=${r.total}`
  },
  async 'RT-R5-14'(h) {
    const tag = 'R514' + rid(); await h.mk(`${tag} 字段`, tag)
    const it = items(await h.call('notes.search', { query: tag }))[0]
    ok(it, '无结果')
    for (const k of ['noteId', 'title', 'noteType', 'noteSource', 'preview', 'created', 'modified', 'collections', 'status']) ok(k in it, `缺少字段 ${k}`)
    ok(/T\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/.test(it.created) && /[+-]\d\d:\d\d$/.test(it.modified), `时间格式：${it.created}`)
    return '字段完整'
  },
  async 'RT-R5-15'(h) {
    const noteId = await h.mk('RT-R5-15', Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join('\n'))
    const a = await h.note(noteId, { offset: 1, limit: 5 })
    ok(Number(a.totalLines) >= 10, `totalLines=${a.totalLines}`)
    const ta = String(a.content ?? a.body ?? a.lines ?? '')
    ok(ta.includes('L1') && ta.includes('L5') && !ta.includes('L6'), `前 5 行：${ta}`)
    const b = await h.note(noteId, { offset: -3, limit: 3 })
    const tb = String(b.content ?? b.body ?? b.lines ?? '')
    ok(['L8', 'L9', 'L10'].every(x => tb.includes(x)) && !/\bL7\b/.test(tb), `最后 3 行：${tb}`)
    return '分段读取正确'
  },
  async 'RT-R5-16'(h) {
    const noteId = await h.mk('RT-R5-16', 'x')
    await h.call('notes.set_status', { noteId, favorite: true })
    const r = await h.call('notes.set_status', { noteId, favorite: true, pinned: true })
    ok(r.applied && Object.keys(r.applied).join() === 'pinned', `applied=${JSON.stringify(r.applied)}`)
    return 'applied 只含 pinned'
  },
  async 'RT-R5-17'(h) {
    const t = 'RT新集合-' + rid()
    const a = await h.call('collections.add_note', { noteId: await h.mk('RT-R5-17a', 'x'), collectionTitle: t })
    const b = await h.call('collections.add_note', { noteId: await h.mk('RT-R5-17b', 'x'), collectionTitle: t })
    ok(a.createdCollection === true && b.createdCollection === false, `${a.createdCollection}/${b.createdCollection}`)
    return '自动创建并正确标记'
  },
  async 'RT-R5-18'(h) {
    const noteId = await h.mk('RT-R5-18', 'x'); const t = 'RT-Agent集合-' + rid()
    h.llm.script('r5-18', toolSeq([ctx => ({ name: 'collections__add_note', args: { noteId: arg(ctx, 'noteId'), collectionTitle: arg(ctx, 'col') } })]))
    const chatId = await h.chat('RT-R5-18'); await h.send(chatId, `⟦SCN:r5-18⟧ noteId=${noteId} col=${t}`, {}, { confirm: () => ({ approved: true }) })
    const list = items(await h.call('vault.list', { chatId }))
    ok(list.some(x => x.type === 'note-collection' || /collection/.test(JSON.stringify(x))), `保险箱条目：${JSON.stringify(list).slice(0, 300)}`)
    await h.call('vault.rollback', { chatId, all: true })
    const n = await h.note(noteId)
    ok(!JSON.stringify(n.collections ?? []).includes(t), '回滚后仍在集合中')
    return '集合变更可回滚'
  },
  async 'RT-R5-19'(h) {
    const d = h.tmpDir(); const img = path.join(d, 'outside.png'); fs.copyFileSync(path.join(h.WFX, 'images/ocr-clean.png'), img)
    const noteId = await h.mk('RT-R5-19', 'x')
    await h.reject('notes.attach_image', { noteId, path: img })
    await h.reject('notes.attach_image', { noteId, path: '/etc/hosts' })
    return '工作区外路径被拒绝'
  },
  async 'RT-R5-20'(h) {
    h.copyIntoWs(path.join(h.FX, 'office/rt-sheets.xlsx'), 'rt/rt-sheets.xlsx')
    const r = await h.call('file.read_document', { path: 'rt/rt-sheets.xlsx' })
    ok(JSON.stringify(r).includes('订单号'), '未转出表头')
    await h.reject('file.read_document', { path: path.join(h.FX, 'office/rt-sheets.xlsx') })
    return '工作区内可读，工作区外拒绝'
  },
  async 'RT-R5-21'(h) {
    const base = fs.readFileSync(path.join(h.FX, 'notes/edit-target.md'), 'utf-8')
    const noteId = await h.mk('RT-R5-21', base); const before = await h.body(noteId)
    h.llm.script('r5-21', toolSeq([ctx => ({ name: 'notes__update', args: { noteId: arg(ctx, 'noteId'), edits: [{ oldText: 'EDIT-L010', newText: 'AGENT-EDITED' }] } })]))
    const chatId = await h.chat('RT-R5-21'); await h.send(chatId, `⟦SCN:r5-21⟧ noteId=${noteId}`, {}, { confirm: () => ({ approved: true }) })
    ok((await h.body(noteId)).includes('AGENT-EDITED'), 'Agent 编辑未生效')
    await h.call('vault.rollback', { chatId, all: true })
    ok((await h.body(noteId)) === before, '回滚后正文不一致')
    return '局部编辑可回滚'
  },

  // ============================== R2 ==============================
  async 'RT-R2-01'(h) {
    const { cite01 } = await h.corpus()
    h.llm.script('r2-01', () => ({ text: '收到' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R2-01'); await h.send(chatId, '⟦SCN:r2-01⟧ 看看', { refs: { noteIds: [cite01] } })
    ok(h.reqsSince(mark, { scenario: 'r2-01' })[0]?.ctx.allText.includes('CITE-F01'), '引用正文未注入')
    h.cache.r201 = chatId
    return '引用正文已注入'
  },
  async 'RT-R2-02'(h) {
    const chatId = await h.chat('RT-R2-02')
    await h.reject('chat.send', { chatId, text: 'x', selection: h.sel, refs: { noteIds: Array.from({ length: 11 }, (_, i) => `fake-${i}`) } })
    await h.reject('chat.send', { chatId, text: 'x', selection: h.sel, refs: { skills: ['a', 'b', 'c', 'd'] } })
    return '上限生效'
  },
  async 'RT-R2-03'(h) {
    const ids = await h.importFiles([1, 2, 3, 4].map(n => path.join(h.FX, `notes/long-ref-${n}.md`)))
    const budget = JSON.parse(fs.readFileSync(path.join(h.ORACLE, 'expected.json'), 'utf-8')).longRefBudget
    h.llm.script('r2-03', () => ({ text: '收到' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R2-03'); await h.send(chatId, '⟦SCN:r2-03⟧ x', { refs: { noteIds: ids } })
    const t = h.reqsSince(mark, { scenario: 'r2-03' })[0]?.ctx.allText ?? ''
    for (const m of budget.mustContain) ok(t.includes(m), `缺少 ${m}`)
    for (const m of budget.mustNotContain) ok(!t.includes(m), `不应包含 ${m}`)
    const injected = (t.match(/填|REF\d-AT-\d{4}/g) ?? []).reduce((s, x) => s + x.length, 0)
    ok(injected <= budget.total, `注入 ${injected} 字超过 ${budget.total}`)
    ok(/截断/.test(t), '没有截断说明')
    return `注入约 ${injected} 字`
  },
  async 'RT-R2-04'(h) {
    h.copyIntoWs(path.join(h.FX, 'skills/rt-skill-alpha'), '.whywork/skills/rt-skill-alpha')
    await h.call('skills.reload', {}).catch(() => {})
    h.llm.script('r2-04', () => ({ text: '收到' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R2-04'); await h.send(chatId, '⟦SCN:r2-04⟧ x', { refs: { skills: ['rt-skill-alpha'] } })
    ok(h.reqsSince(mark, { scenario: 'r2-04' })[0]?.ctx.allText.includes('SKILL-MARKER-ALPHA'), '技能正文未注入')
    return '技能强制注入'
  },
  async 'RT-R2-05'(h) {
    const { cite01 } = await h.corpus()
    const chatId = h.cache.r201 ?? (await (async () => { const c = await h.chat('RT-R2-05'); await h.send(c, 'x', { refs: { noteIds: [cite01] } }); return c })())
    const u = (await h.messages(chatId)).find(m => m.role === 'user')
    ok(JSON.stringify(u?.refs ?? '').includes(cite01), `refs=${JSON.stringify(u?.refs)}`)
    return '引用已持久化'
  },
  async 'RT-R2-06'(h) {
    await h.corpus()
    await h.toChat(); await h.page.getByRole('button', { name: '新对话' }).first().click()
    const input = h.page.getByLabel('对话输入')
    await input.fill(''); await input.pressSequentially('@北辰', { delay: 60 })
    const opts = h.page.locator('[role=option], [role=menuitem], .ww-mention-option')
    await h.needUi(opts, '@ 笔记浮层')
    ok(await opts.count() <= 8, `浮层 ${await opts.count()} 项`)
    const labels = await opts.allInnerTexts()
    ok(labels.every(l => l.includes('北辰')), `浮层未按标题匹配（任务书要求实时检索标题）：${labels.join('、')}`)
    await h.page.keyboard.press('Enter')
    ok(!(await input.inputValue()).includes('@北辰'), '正文中仍有 @北辰')
    await h.needUi(h.page.locator('.ww-chat-pane .ant-tag, .ww-chat-pane [data-ref]').filter({ hasText: '北辰' }), '笔记标签')
    return '浮层按标题匹配，标签正常'
  },
  async 'RT-R2-07'(h) {
    h.copyIntoWs(path.join(h.FX, 'skills/rt-skill-alpha'), '.whywork/skills/rt-skill-alpha'); await h.call('skills.reload', {}).catch(() => {})
    await h.toChat(); await h.page.getByRole('button', { name: '新对话' }).first().click()
    const input = h.page.getByLabel('对话输入'); const opts = h.page.locator('[role=option], [role=menuitem]')
    await input.fill(''); await input.pressSequentially('/', { delay: 60 })
    await h.needUi(opts.filter({ hasText: 'rt-skill-alpha' }), '/ 技能浮层')
    await h.page.keyboard.press('Escape'); await input.fill('你好'); await input.press('End'); await input.pressSequentially('/', { delay: 60 })
    ok(!(await h.exists(opts.filter({ hasText: 'rt-skill-alpha' }), 1500)), '行中输入 / 也弹出了技能')
    await input.fill('')
    return '仅行首触发'
  },
  async 'RT-R2-08'(h) {
    await h.corpus()
    await h.toChat(); await h.page.getByRole('button', { name: '新对话' }).first().click()
    const input = h.page.getByLabel('对话输入'); const opts = h.page.locator('[role=option], [role=menuitem]')
    // @ 按标题检索；使用两篇笔记各自的标题词，保证选中不同笔记
    for (const q of ['@北辰计划', '@北辰风险']) {
      await input.pressSequentially(q, { delay: 50 }); await h.needUi(opts, '浮层'); await h.page.keyboard.press('Enter')
    }
    const chips = h.page.locator('.ww-chat-pane .ant-tag, .ww-chat-pane [data-ref]').filter({ hasText: '@' })
    const n0 = await chips.count(); ok(n0 === 2, `标签数 ${n0}`)
    const closeOne = chips.first().locator('.ant-tag-close-icon, [aria-label*="移除"], [aria-label*="lose"]').first()
    await closeOne.click(); await h.sleep(300); ok(await chips.count() === 1, '单个移除失败')
    await (await h.needUi(h.page.getByRole('button', { name: /全部移除/ }), '“全部移除”')).click()
    await h.sleep(300); ok(await chips.count() === 0, '全部移除失败')
    return '2→1→0'
  },
  async 'RT-R2-10'(h) {
    const html = path.join(h.WFX, 'web/offline.html')
    const srv = require('node:http').createServer((q, s) => { s.setHeader('Content-Type', 'text/html'); s.end(fs.readFileSync(html)) })
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/page`
    try {
      const old = (await h.call('clip.blacklist_get')).items ?? []
      await h.call('clip.blacklist_set', { items: [...old, '127.0.0.1'] })
      const total0 = (await h.call('notes.list', { limit: 1 })).total
      await h.toChat()
      const direct = h.page.locator('.ww-chat-pane').getByRole('button', { name: /添加网页/ })
      if (await h.exists(direct, 3000)) await direct.first().click()
      else {
        await (await h.needUi(h.page.locator('.ww-chat-pane').getByRole('button', { name: /^添\s*加$/ }), '“添加”按钮')).click()
        await (await h.needUi(h.page.getByText('添加网页'), '“添加网页”')).click()
      }
      const urlInput = await h.needUi(h.page.locator('.ant-modal input, [role=dialog] input'), '网址输入框')
      await urlInput.fill(url); await h.page.locator('.ant-modal, [role=dialog]').getByRole('button', { name: /确\s*定|确\s*认|添\s*加/ }).last().click()
      await h.needUi(h.page.getByText(/黑名单/), '黑名单提示')
      ok((await h.call('notes.list', { limit: 1 })).total === total0, '仍新增了笔记')
      await h.call('clip.blacklist_set', { items: old })
      return '被黑名单拦截'
    } finally { srv.close() }
  },

  // ============================== R3 ==============================
  async 'RT-R3-01'(h) {
    const { cite01 } = await h.corpus()
    h.llm.script('r3-01', ctx => ctx.step === 0 ? { tool: { name: 'notes__search', args: { query: '北辰计划' } } } : { text: `北辰计划由周岚负责[${sourceNumber(ctx, /北辰计划(?!风险)/)}]。` })
    const chatId = await h.chat('RT-R3-01 引用'); await h.send(chatId, '⟦SCN:r3-01⟧ 北辰计划谁负责？')
    ok((await h.events()).some(e => e.topic === 'chat.sources' && e.payload?.chatId === chatId), '没有 chat.sources 事件')
    const req = h.llm.chatRequests({ scenario: 'r3-01' }).pop()
    const n = sourceNumber(req.ctx, /北辰计划(?!风险)/)
    const src = await sourcesOf(h, chatId)
    ok(src.some(s => s.n === n && s.noteId === cite01), `来源=${JSON.stringify(src)}，期望 ${n}→${cite01}`)
    h.cache.r301 = { chatId, n }
    return `来源 ${n} 指向北辰计划`
  },
  async 'RT-R3-02'(h) {
    await h.corpus()
    h.llm.script('r3-02', ctx => ctx.step === 0 ? { tool: { name: 'notes__search', args: { query: '北辰计划' } } } : { text: '周岚负责[1]，另见[9]。' })
    const chatId = await h.chat('RT-R3-02'); await h.send(chatId, '⟦SCN:r3-02⟧ x')
    const src = await sourcesOf(h, chatId)
    ok(!src.some(s => s.n === 9), `出现未登记编号：${JSON.stringify(src)}`)
    return `来源编号 ${src.map(s => s.n)}`
  },
  async 'RT-R3-03'(h) {
    await h.corpus()
    h.llm.script('r3-03', ctx => ctx.step === 0 ? { tool: { name: 'notes__search', args: { query: '北辰计划' } } } : { text: '周岚负责[1]。\n\n```js\nconst x = arr[1]\n```' })
    const chatId = await h.chat('RT-R3-03 角标'); await h.send(chatId, '⟦SCN:r3-03⟧ x')
    await h.openChatUi('RT-R3-03 角标')
    await h.needUi(h.chatPane().getByText('arr[1]'), '代码块原文')
    const sups = h.chatPane().locator('sup, [data-citation]')
    ok(await sups.count() === 1, `角标数量 ${await sups.count()}`)
    return '只渲染正文角标'
  },
  async 'RT-R3-04'(h) {
    const { cite01 } = await h.corpus()
    h.llm.script('r3-04', () => ({ text: '收到' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R3-04'); await h.send(chatId, '⟦SCN:r3-04⟧ x', { useKnowledge: false, refs: { noteIds: [cite01] } })
    const r = h.reqsSince(mark, { scenario: 'r3-04' })[0]
    ok(!r.ctx.toolNames.some(n => /^notes__(search|get|list)$/.test(n)), `仍提供检索工具：${r.ctx.toolNames}`)
    ok(r.ctx.allText.includes('CITE-F01'), '@ 引用失效')
    return '检索工具已移除，引用保留'
  },
  async 'RT-R3-05'(h) {
    const { cite02 } = await h.corpus()
    h.llm.script('r3-05', () => ({ text: '三项风险[1]。' }))
    const chatId = await h.chat('RT-R3-05'); await h.send(chatId, '⟦SCN:r3-05⟧ x', { refs: { noteIds: [cite02] } })
    const src = await sourcesOf(h, chatId)
    ok(src.some(s => s.n === 1 && s.noteId === cite02), `来源=${JSON.stringify(src)}`)
    return '@ 引用登记为来源 1'
  },
  async 'RT-R3-06'(h) {
    if (!h.cache.r301) await module.exports['RT-R3-01'](h)
    await h.openChatUi('RT-R3-01 引用')
    await (await h.needUi(h.chatPane().locator('sup, [data-citation]').filter({ hasText: String(h.cache.r301.n) }), '引用角标')).click()
    await h.needUi(h.page.locator('mark, [data-highlight], [class*="highlight"], [class*="citation-hit"]').filter({ hasText: '周岚' }), '高亮片段')
    return '打开并高亮'
  },
  async 'RT-R3-07'(h) {
    if (!h.cache.r301) await module.exports['RT-R3-01'](h)
    await h.openChatUi('RT-R3-01 引用'); await hoverAssistant(h)
    await (await h.needUi(h.chatPane().getByRole('button', { name: /复制（带引用）|复制\(带引用\)/ }), '“复制（带引用）”')).click()
    const clip = await h.clipboard()
    ok(clip.includes('来源') && clip.includes('北辰计划'), `剪贴板：${clip}`)
    return '含来源列表'
  },

  // ============================== R4 ==============================
  async 'RT-R4-01'(h) {
    const noteId = await h.mk('RT-R4-01 待删除', 'x')
    h.llm.script('r4-01', toolSeq([ctx => ({ name: 'notes__delete', args: { noteId: arg(ctx, 'noteId') } })]))
    const chatId = await h.chat('RT-R4-01 确认卡'); await h.send(chatId, `⟦SCN:r4-01⟧ noteId=${noteId}`, {}, { noWait: true })
    await h.waitEvent(e => e.topic === 'chat.confirm' && e.payload?.chatId === chatId, 20_000, '确认事件')
    await h.openChatUi('RT-R4-01 确认卡')
    const card = await h.needUi(h.chatPane().locator('.ant-card, [data-confirm-card]').filter({ hasText: '删除笔记' }), '删除笔记确认卡')
    h.cache.r401 = { noteId, chatId }
    ok(!(await h.page.locator('.ant-modal-confirm').isVisible().catch(() => false)), '仍弹出了 Modal 确认框')
    const text = await card.innerText()
    ok(text.includes('保险箱'), '卡片缺少保险箱说明')
    ok(text.includes('RT-R4-01 待删除'), `卡片未显示笔记标题（只显示：${text.replace(/\s+/g, ' ').slice(0, 80)}）`)
    return '对话内确认卡'
  },
  async 'RT-R4-02'(h) {
    if (!h.cache.r401) await module.exports['RT-R4-01'](h)
    const { noteId, chatId } = h.cache.r401
    await h.chatPane().getByRole('button', { name: /^拒\s*绝$/ }).last().click()
    await h.needUi(h.chatPane().getByText('已拒绝'), '“已拒绝”状态')
    await h.waitEvent(e => (e.topic === 'chat.done' || e.topic === 'chat.error') && e.payload?.chatId === chatId, 20_000, '结束')
    ok(!isDeleted(await h.note(noteId)), '拒绝后笔记仍被删除')
    return '拒绝不执行'
  },
  async 'RT-R4-03'(h) {
    const noteId = await h.mk('RT-R4-03 待删除', 'x')
    h.llm.script('r4-03', toolSeq([ctx => ({ name: 'notes__delete', args: { noteId: arg(ctx, 'noteId') } })]))
    const chatId = await h.chat('RT-R4-03'); await h.send(chatId, `⟦SCN:r4-03⟧ noteId=${noteId}`, {}, { noWait: true })
    await h.waitEvent(e => e.topic === 'chat.confirm' && e.payload?.chatId === chatId, 20_000, '确认事件')
    await h.openChatUi('RT-R4-03')
    await (await h.needUi(h.chatPane().getByRole('button', { name: /^允\s*许$/ }), '“允许”')).click()
    await h.needUi(h.chatPane().getByText('已允许'), '“已允许”状态')
    await waitFor(async () => isDeleted(await h.note(noteId)), 15_000, '删除生效')
    return '允许后执行'
  },
  async 'RT-R4-04'(h) {
    const noteId = await h.mk('RT-R4-04', 'x')
    h.llm.script('r4-04', toolSeq([ctx => ({ name: 'notes__delete', args: { noteId: arg(ctx, 'noteId') } })]))
    const chatId = await h.chat('RT-R4-04')
    await h.openChatUi('RT-R4-04'); await h.sendUi(`⟦SCN:r4-04⟧ noteId=${noteId}`)
    await h.waitEvent(e => e.topic === 'chat.confirm' && e.payload?.chatId === chatId, 20_000, '确认事件')
    await (await h.needUi(h.chatPane().getByRole('button', { name: '停止' }), '“停止”')).click()
    await h.needUi(h.chatPane().getByText('已取消'), '“已取消”状态')
    ok(!isDeleted(await h.note(noteId)), '停止后仍执行了删除')
    return '停止即取消'
  },
  async 'RT-R4-05'(h) {
    h.llm.script('r4-05', toolSeq([{ name: 'file__write', args: { path: `rt/r405-${rid()}.md`, content: '第一行内容RT\n第二行' } }]))
    let preview
    const chatId = await h.chat('RT-R4-05'); await h.send(chatId, '⟦SCN:r4-05⟧ x', {}, { confirm: p => { preview = p.preview; return { approved: false } } })
    ok(preview?.kind === 'file_write', `preview=${JSON.stringify(preview)}`)
    const s = JSON.stringify(preview)
    ok(/r405-/.test(s) && s.includes('第一行内容RT'), '缺少路径或内容')
    return 'file_write 预览完整'
  },
  async 'RT-R4-06'(h) {
    const calls = Array.from({ length: 6 }, (_, i) => ({ name: 'notes__create', args: { title: `RT-R4-06 批量${i}`, body: 'x' } }))
    h.llm.script('r4-06', toolSeq(calls))
    const previews = []
    const chatId = await h.chat('RT-R4-06'); await h.send(chatId, '⟦SCN:r4-06⟧ x', {}, { confirm: p => { previews.push(p.preview); return { approved: true } } })
    ok(previews.some(p => p?.kind === 'bulk'), `确认预览：${JSON.stringify(previews).slice(0, 300)}`)
    return `批量确认 ${previews.length} 次`
  },
  async 'RT-R4-07'(h) {
    const acct = h.cache.mailAccount ?? (h.cache.mailAccount = (await h.call('mail.save_account', { name: 'RT账户', host: '127.0.0.1', port: 9, user: 'rt@example.com', password: 'synthetic', smtpHost: '127.0.0.1', smtpPort: 9 })).id)
    h.llm.script('r4-07m', toolSeq([ctx => ({ name: 'mail__send', args: { id: arg(ctx, 'acct'), to: 'a@example.com', subject: '原主题', text: '正文' } })]))
    let res
    const c1 = await h.chat('RT-R4-07 mail')
    await h.send(c1, `⟦SCN:r4-07m⟧ acct=${acct}`, {}, { confirm: async p => { res = await h.raw('chat.confirm', { id: p.id, chatId: c1, approved: true, override: { subject: '改后主题' } }); return { approved: false } } }).catch(() => {})
    ok(res?.ok, `允许字段 override 被拒绝：${res?.error?.message}`)
    const a = await h.mk('RT-R4-07 A', 'x'), b = await h.mk('RT-R4-07 B', 'x')
    h.llm.script('r4-07d', toolSeq([ctx => ({ name: 'notes__delete', args: { noteId: arg(ctx, 'noteId') } })]))
    let bad
    const c2 = await h.chat('RT-R4-07 del')
    await h.send(c2, `⟦SCN:r4-07d⟧ noteId=${a}`, {}, { confirm: async p => { bad = await h.raw('chat.confirm', { id: p.id, chatId: c2, approved: true, override: { noteId: b } }); return { approved: false } } }).catch(() => {})
    ok(!isDeleted(await h.note(b)), '越权 override 删除了 B')
    ok(!bad?.ok || !isDeleted(await h.note(a)), '越权 override 未被拒绝')
    return '白名单生效'
  },
  async 'RT-R4-08'(h) {
    const accounts = items(await h.call('mail.accounts'))
    for (const x of accounts) if (x.id !== h.cache.mailAccount) await h.call('mail.remove_account', { id: x.id })
    const acct = h.cache.mailAccount ?? (h.cache.mailAccount = (await h.call('mail.save_account', { name: 'RT账户', host: '127.0.0.1', port: 9, user: 'rt@example.com', password: 'synthetic', smtpHost: '127.0.0.1', smtpPort: 9 })).id)
    h.llm.script('r4-08', toolSeq([ctx => ({ name: 'mail__send', args: { id: arg(ctx, 'acct'), to: 'card@example.com', subject: 'RT卡片主题', text: 'RT卡片正文' } })]))
    const chatId = await h.chat('RT-R4-08 发信卡'); await h.send(chatId, `⟦SCN:r4-08⟧ acct=${acct}`, {}, { noWait: true })
    await h.waitEvent(e => e.topic === 'chat.confirm' && e.payload?.chatId === chatId, 20_000, '确认事件')
    await h.openChatUi('RT-R4-08 发信卡')
    const card = await h.needUi(h.chatPane().locator('.ant-card, [data-confirm-card]').filter({ hasText: '发送邮件' }), '发信卡')
    ok(await card.locator('input, textarea').count() >= 1, '发信卡没有可编辑字段')
    ok(await card.locator('input[value="card@example.com"], input').count() >= 1, '收件人不可编辑')
    ok(await card.locator('.ant-select, select, [role=combobox]').count() === 0, '单账户仍显示选择器')
    await card.getByRole('button', { name: /^拒\s*绝$/ }).click()
    return '单账户隐藏选择器'
  },
  async 'RT-R4-09'(h) {
    const noteId = await h.mk('RT-R4-09', 'x')
    h.llm.script('r4-09', toolSeq([ctx => ({ name: 'notes__delete', args: { noteId: arg(ctx, 'noteId') } })]))
    const chatId = await h.chat('RT-R4-09 单卡')
    await h.openChatUi('RT-R4-09 单卡'); await h.sendUi(`⟦SCN:r4-09⟧ noteId=${noteId}`)
    await h.waitEvent(e => e.topic === 'chat.confirm' && e.payload?.chatId === chatId, 20_000, '确认事件')
    const mark = h.llm.mark()
    const input = h.page.getByLabel('对话输入')
    if (await input.isEnabled()) { await input.fill('RT-R4-09 新消息'); await input.press('Enter') }
    await h.needUi(h.page.getByText(/确认/).filter({ hasText: /先|处理/ }), '“先处理确认卡”提示', 4000).catch(async e => { if (await input.isEnabled()) throw e })
    ok(!h.llm.requests.slice(mark).some(r => r.ctx?.userText?.includes('RT-R4-09 新消息')), '仍发出了新消息')
    await h.chatPane().getByRole('button', { name: /^拒\s*绝$/ }).last().click()
    return '待确认期间不能发新消息'
  },
  async 'RT-R4-10'(h) {
    const srv = require('node:http').createServer((q, s) => s.end('<html><body>rt</body></html>'))
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${srv.address().port}/`
      h.llm.script('r4-10', toolSeq([{ name: 'browser__eval', args: { url, script: '1+1' } }]))
      let preview
      const chatId = await h.chat('RT-R4-10'); await h.send(chatId, '⟦SCN:r4-10⟧ x', {}, { confirm: p => { preview = p.preview; return { approved: false } } })
      ok(preview?.kind === 'browser_eval' && JSON.stringify(preview).includes(url) && JSON.stringify(preview).includes('1+1'), `preview=${JSON.stringify(preview)}`)
      return 'browser_eval 预览完整'
    } finally { srv.close() }
  },

  // ============================== R6 ==============================
  async 'RT-R6-01'(h) {
    const title = 'RT-R6-01 待删会话'; const chatId = await h.chat(title)
    await h.refreshUi()
    await h.page.locator('.ww-sidebar').getByText(title).first().hover()
    await (await h.needUi(h.chatRowMenu(title), '会话“…”菜单')).click()
    await (await h.needUi(h.page.getByRole('menuitem', { name: /删除/ }), '“删除”菜单项')).click()
    await h.page.locator('.ant-modal, [role=dialog]').getByRole('button', { name: /^(删\s*除.*|确\s*定)$/ }).last().click()
    await waitFor(async () => !items(await h.call('chat.list')).some(c => c.chatId === chatId), 8000, '会话删除')
    return '可从侧栏删除'
  },
  async 'RT-R6-02'(h) {
    h.llm.script('r6-02', () => ({ delayMs: 4000, text: '慢' }))
    const chatId = await h.chat('RT-R6-02'); await h.send(chatId, '⟦SCN:r6-02⟧ x', {}, { noWait: true })
    await h.sleep(500); await h.reject('chat.delete', { chatId })
    await h.waitEvent(e => e.topic === 'chat.done' && e.payload?.chatId === chatId, 20_000, '完成')
    return '运行中拒绝删除'
  },
  async 'RT-R6-03'(h) {
    const title = 'RT-R6-03 原名'; const chatId = await h.chat(title)
    await h.refreshUi()
    const rename = async (current, value, key) => {
      await h.page.locator('.ww-sidebar').getByText(current).first().hover()
      await (await h.needUi(h.chatRowMenu(current), '会话菜单')).click()
      await (await h.needUi(h.page.getByRole('menuitem', { name: /重命名/ }), '“重命名”')).click()
      const input = h.page.locator('.ww-sidebar input:focus'); await input.fill(value); await input.press(key)
    }
    await rename(title, 'RT-R6-03 新名', 'Enter')
    await waitFor(async () => items(await h.call('chat.list')).find(c => c.chatId === chatId)?.title === 'RT-R6-03 新名', 5000, '重命名')
    await h.refreshUi()
    await rename('RT-R6-03 新名', 'RT-R6-03 不该保存', 'Escape'); await h.sleep(500)
    ok(items(await h.call('chat.list')).find(c => c.chatId === chatId)?.title === 'RT-R6-03 新名', 'Esc 未取消')
    return '回车保存，Esc 取消'
  },
  async 'RT-R6-04'(h) {
    const tag = 'R604' + rid()
    for (let i = 0; i < 25; i++) await h.chat(`${tag}-${i}`)
    const all = await h.call('chat.list', { query: tag, limit: 100 })
    ok(items(all).length === 25 && items(all).every(c => c.title.startsWith(tag)), `过滤结果 ${items(all).length}`)
    const page3 = await h.call('chat.list', { query: tag, limit: 10, offset: 20 })
    ok(items(page3).length === 5, `第三页 ${items(page3).length}`)
    return '过滤与分页正确'
  },
  async 'RT-R6-05'(h) {
    await h.bg(true); await h.settings({ 'chat.autoTitle': 'true' })
    try {
      h.llm.script('r6-05', () => ({ text: '回答' })); const mark = h.llm.mark()
      const chatId = (await h.call('chat.create', { selection: h.sel })).chatId
      await h.send(chatId, '⟦SCN:r6-05⟧ 介绍一下北辰计划')
      await waitFor(async () => items(await h.call('chat.list')).find(c => c.chatId === chatId)?.title === '合成标题', 15_000, 'AI 命名')
      ok(h.reqsSince(mark, { model: 'bg-model' }).length >= 1, '命名未使用后台模型')
      return 'AI 命名生效'
    } finally { await h.settings({ 'chat.autoTitle': 'false' }) }
  },
  async 'RT-R6-06'(h) {
    await h.bg(true); await h.settings({ 'chat.autoTitle': 'true' })
    try {
      h.llm.script('r6-06', () => ({ text: '回答' }))
      const c1 = (await h.call('chat.create', { selection: h.sel })).chatId
      await h.call('chat.rename', { chatId: c1, title: 'RT手动标题' })
      await h.send(c1, '⟦SCN:r6-06⟧ x'); await h.sleep(3000)
      ok(items(await h.call('chat.list')).find(c => c.chatId === c1)?.title === 'RT手动标题', '手动标题被覆盖')
      await h.settings({ 'chat.autoTitle': 'false' })
      const c2 = (await h.call('chat.create', { selection: h.sel })).chatId
      await h.send(c2, '⟦SCN:r6-06⟧ y'); await h.sleep(3000)
      ok(items(await h.call('chat.list')).find(c => c.chatId === c2)?.title !== '合成标题', '关闭后仍 AI 命名')
      return '两种情况均未改写'
    } finally { await h.settings({ 'chat.autoTitle': 'false' }) }
  },
  async 'RT-R6-07'(h) {
    const tag = 'RT607' + rid(); await h.chat(`${tag} 目标`); await h.chat('RT-R6-07 干扰')
    await h.refreshUi()
    const search = await h.needUi(h.page.locator('.ww-sidebar').getByPlaceholder(/搜索/), '侧栏会话搜索框')
    await search.fill(tag)
    await h.needUi(h.page.locator('.ww-sidebar').getByText(`${tag} 目标`), '匹配会话')
    const other = h.page.locator('.ww-sidebar').getByText('RT-R6-07 干扰')
    await other.first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
    ok(!(await other.first().isVisible().catch(() => false)), '未过滤非匹配会话')
    await search.fill('')
    return '过滤正确'
  },

  // ============================== R7 ==============================
  async 'RT-R7-01'(h) {
    const noteId = await h.mk('RT-R7-01 笔记', '原文 V1')
    h.llm.script('r7-01', toolSeq([ctx => ({ name: 'notes__update', args: { noteId: arg(ctx, 'noteId'), edits: [{ oldText: 'V1', newText: 'V2' }] } })]))
    const chatId = await h.chat('RT-R7-01'); await h.send(chatId, `⟦SCN:r7-01⟧ noteId=${noteId}`, {}, { confirm: () => ({ approved: true }) })
    const list = items(await h.call('vault.list', { chatId }))
    h.cache.r701 = { chatId, list }
    ok(list.some(x => x.type === 'note' && x.noteTitle === 'RT-R7-01 笔记'), `条目：${JSON.stringify(list).slice(0, 300)}`)
    return 'type/noteTitle 正确'
  },
  async 'RT-R7-02'(h) {
    if (!h.cache.r701) await module.exports['RT-R7-01'](h)
    const { chatId } = h.cache.r701
    const target = items(await h.call('vault.list', { chatId })).find(x => x.type === 'note' || x.kind === 'note')
    const id = idOf(target)
    const first = await h.call('vault.rollback', { changeId: id })
    ok(JSON.stringify(first.restored ?? []).includes(id), `第一次 restored=${JSON.stringify(first)}`)
    const second = await h.call('vault.rollback', { changeId: id })
    const sk = (second.skipped ?? []).find(s => (s.changeId ?? s.id ?? s) === id)
    ok(sk && (sk.reason ?? '') !== '', `第二次 skipped=${JSON.stringify(second)}`)
    return '摘要与跳过原因正确'
  },
  async 'RT-R7-03'(h) {
    const dir = `rt-dir-${rid()}`
    h.llm.script('r7-03', toolSeq([ctx => ({ name: 'file__write', args: { path: `${arg(ctx, 'dir')}/a.md`, content: 'A' } })]))
    const chatId = await h.chat('RT-R7-03'); await h.send(chatId, `⟦SCN:r7-03⟧ dir=${dir}`, {}, { confirm: () => ({ approved: true }) })
    fs.writeFileSync(path.join(h.ws, dir, 'b.md'), 'B')
    const r1 = await h.call('vault.rollback', { chatId, all: true })
    ok(r1.needsConfirm && JSON.stringify(r1.needsConfirm).includes('b.md'), `未要求确认：${JSON.stringify(r1)}`)
    await h.call('vault.rollback', { chatId, all: true, confirm: true })
    ok(!fs.existsSync(path.join(h.ws, dir, 'a.md')), '确认后 a.md 仍存在')
    return '需确认并列出嵌套文件'
  },
  async 'RT-R7-04'(h) {
    const rel = `rt/new-${rid()}.md`
    h.llm.script('r7-04', toolSeq([ctx => ({ name: 'file__write', args: { path: arg(ctx, 'p'), content: '新建' } })]))
    const chatId = await h.chat('RT-R7-04'); await h.send(chatId, `⟦SCN:r7-04⟧ p=${rel}`, {}, { confirm: () => ({ approved: true }) })
    ok(fs.existsSync(path.join(h.ws, rel)), '文件未写入')
    await h.call('vault.rollback', { chatId, all: true })
    ok(!fs.existsSync(path.join(h.ws, rel)), '回滚后文件仍在')
    return '新建文件已移走'
  },
  async 'RT-R7-05'(h) {
    h.llm.script('r7-05', () => ({ text: 'x' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R7-05'); await h.send(chatId, '⟦SCN:r7-05⟧ x')
    const names = h.reqsSince(mark, { scenario: 'r7-05' })[0].ctx.toolNames
    ok(!names.some(n => /vault/.test(n)), `暴露了：${names.filter(n => /vault/.test(n))}`)
    return `工具数 ${names.length}，无 vault`
  },
  async 'RT-R7-06'(h) {
    const noteId = await h.mk('RT-R7-06 笔记', '原文 V1')
    h.llm.script('r7-06', toolSeq([ctx => ({ name: 'notes__update', args: { noteId: arg(ctx, 'noteId'), edits: [{ oldText: 'V1', newText: 'V2' }] } })]))
    const chatId = await h.chat('RT-R7-06 保险箱'); await h.send(chatId, `⟦SCN:r7-06⟧ noteId=${noteId}`, {}, { confirm: () => ({ approved: true }) })
    await h.openChatUi('RT-R7-06 保险箱')
    const btn = await h.needUi(h.chatPane().getByRole('button', { name: /保险箱|变更记录/ }), '保险箱按钮')
    await waitFor(async()=>/1/.test(await btn.innerText()),5000,'保险箱徽标数量 1')
    await btn.click()
    const drawer = h.page.locator('.ant-drawer')
    await h.needUi(drawer.getByText('笔记'), '“笔记”分组'); await h.needUi(drawer.getByText('修改'), '“修改”标签')
    ok(!/\bmodify\b|\bnote\b/.test(await drawer.innerText()), '显示了内部英文代码')
    return '徽标与中文分组正常'
  },

  // ============================== R8 ==============================
  async 'RT-R8-01'(h) {
    await h.settings({ 'profile.nickname': 'RT昵称', 'profile.instructions': 'RT-INSTR-MARK' })
    h.llm.script('r8-01', () => ({ text: 'x' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R8-01'); await h.send(chatId, '⟦SCN:r8-01⟧ x')
    const sys = h.reqsSince(mark, { scenario: 'r8-01' })[0].ctx.system
    ok(sys.includes('RT昵称') && sys.includes('RT-INSTR-MARK'), '系统提示词缺少档案或指令')
    return '已注入'
  },
  async 'RT-R8-02'(h) { await h.reject('settings.set', { settings: { 'profile.instructions': '长'.repeat(2001) } }); return '超长被拒绝' },
  async 'RT-R8-03'(h) {
    // 任务书未规定取值写法：先试语言代码，再试显示名
    await h.settings({ 'memory.mode': 'quality' })
    const lang = await h.raw('settings.set', { settings: { 'ai.responseLanguage': 'en-US' } })
    if (!lang.ok) await h.settings({ 'ai.responseLanguage': 'English' })
    h.llm.script('r8-03', () => ({ text: 'ok' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R8-03'); await h.send(chatId, '⟦SCN:r8-03⟧ 请记住我喜欢简短回答')
    const sys = h.reqsSince(mark, { scenario: 'r8-03' })[0].ctx.system
    ok(/en-US|English/.test(sys), '系统提示词缺少回复语言')
    await h.call('chat.flush_now', { chatId }); await h.sleep(3000)
    const memDir = path.join(h.ws, '.whywork/memory')
    const text = fs.existsSync(memDir) ? fs.readdirSync(memDir, { recursive: true }).map(f => path.join(memDir, f)).filter(f => fs.statSync(f).isFile()).map(f => fs.readFileSync(f, 'utf-8')).join('\n') : ''
    ok(!/en-US|English|回复语言/.test(text), '回复语言被写入记忆')
    await h.settings({ 'ai.responseLanguage': null })
    return '注入但未写入记忆'
  },
  async 'RT-R8-04'(h) {
    await h.settings({ 'memory.mode': 'off' })
    h.llm.script('r8-04', () => ({ text: 'ok' }))
    const chatId = await h.chat('RT-R8-04'); await h.send(chatId, '⟦SCN:r8-04⟧ x')
    const mark = h.llm.mark()
    await h.call('chat.flush_now', { chatId }); await h.sleep(2500)
    ok(h.llm.requests.slice(mark).filter(r => r.kind === 'chat').length === 0, '关闭后仍整理记忆')
    return '未整理'
  },
  async 'RT-R8-05'(h) {
    const run = async mode => {
      await h.settings({ 'memory.mode': mode })
      h.llm.script('r8-05', () => ({ text: 'ok' }))
      const a = `RT-R8-05 A ${mode}`, b = `RT-R8-05 B ${mode}`
      const ca = await h.chat(a); await h.chat(b)
      await h.openChatUi(a); await h.send(ca, '⟦SCN:r8-05⟧ 我偏好表格形式')
      const mark = h.llm.mark()
      await h.page.locator('.ww-sidebar button, .ww-sidebar [role=button]').filter({ hasText: b }).first().click()
      await h.sleep(3000)
      return h.llm.requests.slice(mark).filter(r => r.kind === 'chat').length
    }
    const q = await run('quality'); const e = await run('economy')
    ok(q >= 1, `quality 切换会话未整理（${q}）`); ok(e === 0, `economy 切换会话仍整理（${e}）`)
    return `quality ${q} 次，economy 0 次`
  },
  async 'RT-R8-06'(h) {
    const memFile = path.join(h.ws, '.whywork/memory/MEMORY.md'); fs.mkdirSync(path.dirname(memFile), { recursive: true }); fs.writeFileSync(memFile, '# RT 记忆\n- RT-MEM-KEEP\n')
    await h.page.locator('.ww-sidebar-footer').getByRole('button', { name: '设置' }).click()
    const tab = h.page.getByRole('tab', { name: /个性化|记忆/ })
    if (await h.exists(tab, 3000)) await tab.first().click()
    await (await h.needUi(h.page.getByRole('button', { name: /清空长期记忆/ }), '“清空长期记忆”')).click()
    await h.needUi(h.page.locator('.ant-modal, .ant-popover').filter({ hasText: /确认|确定|清空/ }), '二次确认')
    await h.page.getByRole('button', { name: /取\s*消/ }).last().click()
    ok(fs.readFileSync(memFile, 'utf-8').includes('RT-MEM-KEEP'), '取消后记忆被清空')
    return '需确认，取消不清空'
  },

  // ============================== R9 ==============================
  async 'RT-R9-01'(h) {
    const tag = 'R901' + rid()
    const pdf = await h.mk(`${tag} pdf`, tag, { source: 'pdf' }); const man = await h.mk(`${tag} 手动`, tag)
    const ids = r => items(r).map(i => i.noteId ?? i.note_id)
    const bySource = ids(await h.call('notes.list', { query: tag, filter: { sources: ['pdf'] } }))
    ok(bySource.length === 1 && bySource[0] === pdf, `来源过滤：${bySource}`)
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0)
    let r = await h.raw('notes.list', { query: tag, filter: { modifiedFrom: tomorrow.getTime() } })
    if (!r.ok) r = await h.raw('notes.list', { query: tag, filter: { modifiedFrom: h.today(1) } })
    ok(r.ok, `modifiedFrom 不被接受：${r.error?.message}`)
    ok(ids(r.data).length === 0, '时间区间外仍返回笔记')
    void man
    return '来源与时间过滤正确'
  },
  async 'RT-R9-02'(h) {
    const a = await h.mk('RT-R9-02a', 'x'), b = await h.mk('RT-R9-02b', 'x')
    const r = await h.call('notes.batch_set_status', { noteIds: [a, b, 'missing-id'], favorite: true })
    const failed = r.failed ?? r.failures ?? []
    ok(failed.length === 1 && JSON.stringify(failed).includes('missing-id'), `失败列表：${JSON.stringify(r)}`)
    for (const id of [a, b]) ok(Number(h.noteField(await h.note(id), 'favorite')) === 1, '有效项未更新')
    return '部分失败正确返回'
  },
  async 'RT-R9-03'(h) {
    const ids = [await h.mk('RT-R9-03a', 'x'), await h.mk('RT-R9-03b', 'x'), await h.mk('RT-R9-03c', 'x')]
    await h.call('notes.batch_delete', { noteIds: ids })
    for (const id of ids) ok(isDeleted(await h.note(id)), '未进入回收站')
    await h.call('notes.batch_restore', { noteIds: ids })
    for (const id of ids) ok(!isDeleted(await h.note(id)), '未恢复')
    return '删除与恢复正确'
  },
  async 'RT-R9-04'(h) {
    const t = 'RT批量集合-' + rid(); const ids = [await h.mk('RT-R9-04a', 'x'), await h.mk('RT-R9-04b', 'x')]
    await h.call('collections.batch_add', { noteIds: ids, collectionTitle: t })
    const col = items(await h.call('notes.collections_list')).find(c => c.title === t)
    ok(col, '集合未创建')
    const inCol = items(await h.call('notes.list', { filter: { collectionId: col.id } })).map(i => i.noteId ?? i.note_id)
    ok(ids.every(id => inCol.includes(id)), '笔记未全部加入')
    return '按标题创建并加入'
  },
  async 'RT-R9-05'(h) { await h.reject('notes.batch_set_status', { noteIds: Array.from({ length: 501 }, (_, i) => `id-${i}`), favorite: true }); return '上限生效' },
  async 'RT-R9-06'(h) {
    const tag = 'RT906' + rid(); const a = await h.mk(`${tag} 甲`, 'x'), b = await h.mk(`${tag} 乙`, 'x')
    await h.openNotesUi()
    await h.page.locator('.ww-note-search input').fill(tag); await h.sleep(600)
    await (await h.needUi(h.page.getByRole('button', { name: /^选\s*择$/ }), '“选择”按钮')).click()
    const boxes = h.page.locator('.ww-note-list input[type=checkbox], .ww-note-list [role=checkbox]')
    await h.needUi(boxes, '行复选框'); await boxes.nth(0).click(); await boxes.nth(1).click()
    await h.needUi(h.page.getByText(/已选\s*2\s*项/), '“已选 2 项”')
    await h.page.getByRole('button', { name: /^收\s*藏$/ }).click(); await h.sleep(800)
    for (const id of [a, b]) ok(Number(h.noteField(await h.note(id), 'favorite')) === 1, '批量收藏未生效')
    return '多选批量收藏'
  },
  async 'RT-R9-07'(h) {
    const t = 'RT最近集合-' + rid(); const n = await h.mk('RT-R9-07 行', 'x')
    await h.call('collections.add_note', { noteId: n, collectionTitle: t }).catch(() => h.call('notes.collections_add_note', { noteId: n, collectionTitle: t }))
    await h.openNotesUi(); await h.page.locator('.ww-note-search input').fill('RT-R9-07'); await h.sleep(600)
    await h.page.locator('.ww-note-row').first().hover()
    await (await h.needUi(h.page.locator('.ww-note-row').first().getByRole('button', { name: /更多/ }), '行“更多”按钮')).click()
    // “在 Finder 中显示”在非 macOS 平台可用等价的“文件管理器/文件夹”文案
    for (const label of ['加入集合', '稍后', '复制标题', /在\s*(Finder|文件管理器|文件夹)中显示/, '导出 PDF']) await h.needUi(h.page.getByRole('menuitem').filter({ hasText: label }), `菜单项 ${label}`)
    await h.page.getByRole('menuitem').filter({ hasText: '加入集合' }).click()
    const picker = h.page.locator('.ant-modal .ant-select, [role=dialog] .ant-select').first()
    if (await h.exists(picker, 3000)) await picker.click()
    await h.needUi(h.page.locator('.ant-select-item-option, [role=option]').filter({ hasText: t }), '最近使用的集合')
    return '菜单完整，含最近集合'
  },
  async 'RT-R9-08'(h) {
    await h.mk('RT-R9-08 pdf', 'x', { source: 'pdf' })
    await h.openNotesUi()
    await (await h.needUi(h.page.getByText('按来源分组'), '“按来源分组”开关')).click()
    await h.needUi(h.page.locator('.ww-resource-pane').getByText(/\d+/).filter({ hasText: /pdf|文档|PDF/ }), '分组标题与数量')
    return '分组显示'
  },

  // ============================== R10 ==============================
  async 'RT-R10-01'(h) {
    await h.bg(true); h.llm.setBackground(null)
    const t = 'RT-R10-01-' + rid()
    const ids = [await h.mk(`${t} 甲`, '内容甲'), await h.mk(`${t} 乙`, '内容乙'), await h.mk(`${t} FAIL-ME`, '内容丙')]
    for (const id of ids) await h.call('collections.add_note', { noteId: id, collectionTitle: t })
    const col = items(await h.call('notes.collections_list')).find(c => c.title === t)
    const start = await h.call('llm.summarize_batch_start', { filter: { collectionId: col.id, unprocessed: true } })
    const fin = await h.waitEvent(e => e.topic === 'summarize.progress' && (e.payload?.finished || e.payload?.done === e.payload?.total) && (!start.batchId || e.payload?.batchId === start.batchId), 60_000, '批量完成')
    ok(Number(h.noteField(await h.note(ids[0]), 'processed')) === 1 && Number(h.noteField(await h.note(ids[1]), 'processed')) === 1, '成功项未处理')
    ok(Number(h.noteField(await h.note(ids[2]), 'processed')) !== 1, '失败项被标为已处理')
    ok(Array.isArray(fin.payload.failed) ? fin.payload.failed.length === 1 : Number(fin.payload.failed ?? fin.payload.failures) === 1, `未汇总失败：${JSON.stringify(fin.payload)}`)
    return '2 成功 1 失败并汇总'
  },
  async 'RT-R10-02'(h) {
    await h.bg(true)
    h.llm.setBackground(async () => { await new Promise(r => setTimeout(r, 1500)); return { text: JSON.stringify({ summary: 's', keywords: [], topic: 't' }) } })
    try {
      const t = 'RT-R10-02-' + rid(); const ids = []
      for (let i = 0; i < 4; i++) { const id = await h.mk(`${t} ${i}`, 'x'); ids.push(id); await h.call('collections.add_note', { noteId: id, collectionTitle: t }) }
      const col = items(await h.call('notes.collections_list')).find(c => c.title === t)
      const mark = h.llm.mark()
      const { batchId } = await h.call('llm.summarize_batch_start', { filter: { collectionId: col.id, unprocessed: true } })
      await h.sleep(300); await h.call('llm.summarize_batch_cancel', { batchId }); await h.sleep(4000)
      const n = h.reqsSince(mark, { model: 'bg-model' }).length
      ok(n < 4, `取消后仍处理了 ${n} 条`)
      return `取消后共 ${n} 次请求`
    } finally { h.llm.setBackground(null) }
  },
  async 'RT-R10-03'(h) {
    // 用干净标题建笔记，并先为 rel-01 生成关键词：任务书规定“优先用关键词，没有关键词时用标题分词”
    const body = f => fs.readFileSync(path.join(h.FX, 'notes', f), 'utf-8').replace(/^# .*\n/, '')
    const r1 = await h.mk('量子退火调度', body('rel-01_量子退火.md')), r2 = await h.mk('调度优化实践', body('rel-02_调度优化实践.md')), r3 = await h.mk('园艺记录', body('rel-03_无关.md'))
    await h.bg(true)
    h.llm.setBackground(() => ({ text: JSON.stringify({ summary: 'RT', keywords: ['量子退火', '调度优化'], topic: 'RT' }) }))
    try { await h.call('llm.summarize', { noteId: r1 }) } finally { h.llm.setBackground(null) }
    const gone = await h.mk('量子退火 临时', '量子退火 调度优化'); await h.call('notes.delete', { noteId: gone })
    const ids = items(await h.call('notes.related', { noteId: r1 })).map(i => i.noteId ?? i.note_id)
    ok(ids.includes(r2), '缺少相关笔记 rel-02'); ok(!ids.includes(r1), '包含自身'); ok(!ids.includes(gone), '包含已删除'); ok(!ids.includes(r3), '包含无关笔记')
    h.cache.rel01 = r1
    return `相关 ${ids.length} 条`
  },
  async 'RT-R10-04'(h) {
    const id = h.cache.rel01 ?? (await h.mk('RT-R10-04', '量子退火'))
    const r = await h.raw('notes.related', { noteId: id, limit: 50 })
    if (r.error?.code === 'UNKNOWN_ACTION') throw new h.NotImplemented('notes.related')
    ok(!r.ok || items(r.data).length <= 10, '超过 10 条')
    return r.ok ? '截断到 10 条以内' : '超限被拒绝'
  },
  async 'RT-R10-05'(h) {
    await h.bg(false)
    try {
      await h.mk('RT-R10-05 详情', '正文')
      await h.openNotesUi(); await h.page.locator('.ww-note-search input').fill('RT-R10-05'); await h.sleep(600)
      await h.page.locator('.ww-note-row').first().click()
      await (await h.needUi(h.page.getByRole('button', { name: /生成摘要/ }), '“生成摘要”按钮')).click()
      await h.needUi(h.page.getByText(/请先在设置中选择后台任务模型/), '未设置提示')
      return '提示正确'
    } finally { await h.bg(true) }
  },

  // ============================== R14 ==============================
  async 'RT-R14-01'(h) {
    const d = h.tmpDir('w1'); const { id } = await h.call('watch.folders_add', { dir: d })
    try { await h.reject('watch.folders_add', { dir: d }); return '重复被拒绝' } finally { await h.call('watch.folders_remove', { id }) }
  },
  async 'RT-R14-02'(h) {
    const p = h.tmpDir('w2'); const c = path.join(p, 'child'); fs.mkdirSync(c)
    const { id } = await h.call('watch.folders_add', { dir: p })
    try { await h.reject('watch.folders_add', { dir: c }, /上级/); return '子目录被覆盖' } finally { await h.call('watch.folders_remove', { id }) }
  },
  async 'RT-R14-03'(h) {
    const p = h.tmpDir('w3'); const c = path.join(p, 'child'); fs.mkdirSync(c)
    const cid = (await h.call('watch.folders_add', { dir: c })).id
    let r = await h.raw('watch.folders_add', { dir: p })
    if (!r.ok || r.data?.needsConfirm) r = await h.raw('watch.folders_add', { dir: p, confirmMerge: true, merge: true })
    ok(r.ok, `合并失败：${r.error?.message}`)
    const list = items(await h.call('watch.folders_list'))
    const real = x => fs.realpathSync(x)
    ok(list.some(f => f.dir === real(p)) && !list.some(f => f.dir === real(c)), `登记：${list.map(f => f.dir)}`)
    for (const f of list.filter(f => [real(p), real(c)].includes(f.dir))) await h.call('watch.folders_remove', { id: f.id })
    void cid
    return '合并为上级目录'
  },
  async 'RT-R14-04'(h) {
    const realDir = h.tmpDir('w4'); const link = path.join(h.tmpDir('w4l'), 'link'); fs.symlinkSync(realDir, link)
    const { id } = await h.call('watch.folders_add', { dir: realDir })
    try { await h.reject('watch.folders_add', { dir: link }); return '符号链接判重' } finally { await h.call('watch.folders_remove', { id }) }
  },
  async 'RT-R14-05'(h) {
    // 主目录取执行器启动应用时设置的沙箱 HOME；系统目录用小而无可导入文件的目录，绝不传入 “/”
    const systemDir = process.platform === 'darwin' ? '/System/Library/Sounds' : '/usr/share/zoneinfo'
    const accepted = []
    for (const d of [h.ws, h.sandboxHome, systemDir]) {
      const r = await h.raw('watch.folders_add', { dir: d })
      if (r.error?.code === 'UNKNOWN_ACTION') throw new h.NotImplemented('watch.folders_add')
      if (r.ok) { accepted.push(d); await h.raw('watch.folders_remove', { id: r.data.id }) }
    }
    ok(accepted.length === 0, `以下目录未被拒绝（已立即移除登记）：${accepted.join('、')}`)
    return '工作区、主目录、系统目录均被拒绝'
  },
  async 'RT-R14-06'(h) {
    const d = h.tmpDir('w6'); fs.writeFileSync(path.join(d, 'a.md'), '# A\nRT-W6-A'); fs.writeFileSync(path.join(d, 'b.md'), '# B\nRT-W6-B')
    const { id } = await h.call('watch.folders_add', { dir: d })
    try {
      await h.call('watch.scan_now', { id })
      const f = await waitFor(async () => { const x = items(await h.call('watch.folders_list')).find(v => v.id === id); return Number(x?.imported) === 2 ? x : null }, 20_000, '导入计数')
      ok(f.state && Number(f.failed) === 0 && (f.last_scan_at ?? f.lastScanAt), `状态：${JSON.stringify(f)}`)
      return JSON.stringify({ state: f.state, imported: f.imported })
    } finally { await h.call('watch.folders_remove', { id }) }
  },
  async 'RT-R14-07'(h) {
    if (process.getuid?.() === 0) throw new h.Blocked('root 用户无法验证权限错误')
    const d = h.tmpDir('w7'); fs.writeFileSync(path.join(d, 'a.md'), 'x'); fs.chmodSync(d, 0o000)
    try {
      const r = await h.raw('watch.folders_add', { dir: d })
      if (!r.ok) { ok(/权限/.test(r.error.message), `提示：${r.error.message}`); return r.error.message }
      await h.raw('watch.scan_now', { id: r.data.id })
      const f = await waitFor(async () => { const x = items(await h.call('watch.folders_list')).find(v => v.id === r.data.id); return x && /error|出错/.test(String(x.state)) ? x : null }, 10_000, '出错状态')
      ok(/权限/.test(JSON.stringify(f)), `提示：${JSON.stringify(f)}`)
      await h.call('watch.folders_remove', { id: r.data.id })
      return '出错并提示权限'
    } finally { fs.chmodSync(d, 0o700) }
  },
  async 'RT-R14-08'(h) {
    const r = await h.call('watch.suggested_folders')
    const list = items(r).map(x => typeof x === 'string' ? x : x.path ?? x.dir)
    ok(list.every(p => fs.existsSync(p)), `存在不存在的目录：${list}`)
    return `推荐 ${list.length} 个`
  },

  // ============================== R17 ==============================
  async 'RT-R17-01'(h) {
    const audio = await h.synthWebm()
    const r = await h.call('media.save_recording', { id: crypto.randomUUID(), mode: 'synthetic', ...audio, keyPoints: 'RT-KEYPOINT' })
    h.cache.recNote = r.noteId
    ok((await h.body(r.noteId)).includes('RT-KEYPOINT'), '要点未保存')
    return '要点已保存'
  },
  async 'RT-R17-02'(h) {
    const session = crypto.randomUUID(); const a1 = await h.synthWebm(); const a2 = await h.synthWebm()
    const id2 = crypto.randomUUID()
    const s1 = await h.call('media.save_recording', { id: session, mode: 'synthetic', ...a1, segmentIndex: 1 })
    const s2 = await h.call('media.save_recording', { id: id2, mode: 'synthetic', ...a2, segmentOf: session, segmentIndex: 2 })
    const total = (await h.call('notes.list', { limit: 1 })).total
    const s2b = await h.call('media.save_recording', { id: id2, mode: 'synthetic', ...a2, segmentOf: session, segmentIndex: 2 })
    ok((await h.call('notes.list', { limit: 1 })).total === total && s2b.noteId === s2.noteId, '重复保存新增了笔记')
    const n2 = await h.note(s2.noteId)
    const visible = JSON.stringify(n2)
    ok(visible.includes(s1.noteId) || visible.includes(session) || /第\s*2\s*段/.test(visible), '第 2 段笔记中看不到与第 1 段的关联（正文、链接、标题均未体现）')
    return '分段关联且幂等'
  },
  async 'RT-R17-03'(h) {
    for (let i = 0; i < 2; i++) await h.call('media.save_recording', { id: crypto.randomUUID(), mode: 'synthetic', ...(await h.synthWebm(1500)) })
    const r = await h.call('media.pending_transcriptions')
    const n = Number(r.count ?? r.total ?? items(r).length)
    ok(n >= 2, `待转写 ${n}`)
    return `待转写 ${n}`
  },
  async 'RT-R17-04'(h) {
    await h.settings({ 'media.asrBaseUrl': h.llmUrl, 'media.asrKey': 'synthetic-only', 'media.asrModel': 'whisper-rt', 'media.dictionary': fs.readFileSync(path.join(h.FX, 'media/dictionary.txt'), 'utf-8') })
    if (!h.cache.recNote) await module.exports['RT-R17-01'](h)
    const rec = await h.note(h.cache.recNote)
    // 音频可能登记在 resources，也可能只以资源链接写在正文
    const res = (rec.resources ?? []).find(r => /webm|m4a/.test(r.relative_path ?? r.relativePath ?? r.mime ?? ''))
    const audioPath = res ? (res.relative_path ?? res.relativePath) : (String(rec.body ?? '').match(/resources\/recordings\/[\w-]+\.(webm|m4a)/) ?? [])[0]
    ok(audioPath, '录音笔记中找不到音频文件')
    const mark = h.llm.mark()
    const r = await h.call('media.transcribe', { path: audioPath, language: 'zh-CN' })
    h.cache.transcriptNote = r.noteId
    const asr = h.llm.requests.slice(mark).find(x => x.kind === 'asr')
    ok(asr && /北辰计划/.test(asr.prompt ?? ''), `ASR prompt=${asr?.prompt}`)
    const tNote = await h.note(r.noteId)
    ok(h.noteField(tNote, 'noteSource') === 'meeting_transcript', `来源=${h.noteField(tNote, 'noteSource')}`)
    ok(JSON.stringify(tNote.links ?? {}).includes(h.cache.recNote), '转写稿未与录音互链')
    h.cache.transcriptNote = r.noteId
    return '转写稿生成且携带词典'
  },
  async 'RT-R17-05'(h) {
    await h.bg(true); h.llm.setBackground(null)
    if (!h.cache.transcriptNote) await module.exports['RT-R17-04'](h)
    const mark = h.llm.mark()
    const r = await h.call('media.generate_minutes', { recordingNoteId: h.cache.recNote })
    const req = h.reqsSince(mark, { model: 'bg-model' })[0]
    ok(req && req.ctx.allText.includes('RT-KEYPOINT') && req.ctx.allText.includes('北辰计划'), '纪要请求缺少要点或词典')
    const m = await h.note(r.noteId)
    ok(h.noteField(m, 'noteSource') === 'meeting_overview', `来源=${h.noteField(m, 'noteSource')}`)
    const links = JSON.stringify(m.links ?? {})
    ok(links.includes(h.cache.recNote) && links.includes(h.cache.transcriptNote), '纪要未与录音、转写稿互链')
    return '纪要生成并三方关联'
  },
  async 'RT-R17-06'(h) {
    await h.bg(true); if (!h.cache.transcriptNote) await module.exports['RT-R17-04'](h)
    let n = 0; h.llm.setBackground(() => (++n === 1 ? { error: { status: 500 } } : { text: '## 概览\n重试成功' }))
    try {
      await h.reject('media.generate_minutes', { recordingNoteId: h.cache.recNote })
      ok(!isDeleted(await h.note(h.cache.recNote)) && !isDeleted(await h.note(h.cache.transcriptNote)), '失败影响了已有笔记')
      const r = await h.call('media.generate_minutes', { recordingNoteId: h.cache.recNote })
      ok((await h.body(r.noteId)).includes('重试成功'), '重试未生成纪要')
      return '失败可重试'
    } finally { h.llm.setBackground(null) }
  },
  async 'RT-R17-07'(h) {
    // 规格：已配置 ASR 时才在保存后提示转写
    await h.settings({ 'media.asrBaseUrl': h.llmUrl, 'media.asrKey': 'synthetic-only', 'media.asrModel': 'whisper-rt' })
    await h.page.getByRole('navigation', { name: '工具竖栏' }).getByRole('button', { name: '录音', exact: true }).click()
    await h.needUi(h.page.locator('.ww-resource-pane').getByLabel(/语言/).or(h.page.locator('.ww-resource-pane').getByText(/语言/)), '录音语言选择')
    // 隔离实例没有麦克风：有“合成音频验证”入口时用它，否则用普通开始按钮
    const synth = h.page.locator('.ww-resource-pane').getByRole('button', { name: /合成音频/ })
    if (await h.exists(synth, 2000)) await synth.click()
    else await (await h.needUi(h.page.locator('.ww-resource-pane').getByRole('button', { name: /开始/ }), '开始按钮')).click()
    await h.needUi(h.page.getByPlaceholder(/要点/).or(h.page.getByLabel(/要点/)), '“要点”输入框')
    await h.page.getByPlaceholder(/要点/).or(h.page.getByLabel(/要点/)).first().fill('RT界面要点')
    await h.sleep(1500)
    await (await h.needUi(h.page.getByRole('button', { name: /停止|结束/ }), '停止按钮')).click()
    const save = h.page.getByRole('button', { name: /保存/ }); if (await h.exists(save, 3000)) await save.first().click()
    await h.needUi(h.page.getByText(/是否转写/), '转写提示')
    await h.needUi(h.page.getByText(/另有\s*\d+\s*条/), '待转写数量')
    return '界面流程完整'
  },

  // ============================== R12 ==============================
  async 'RT-R12-01'(h) {
    const s = await saveHttpMcp(h, { name: 'RT-HTTP', transport: 'http', url: h.httpMcp.url, token: 'RT-SECRET' })
    h.cache.httpServer = s.id ?? s.server?.id ?? items(await h.call('mcp.servers_list')).find(x => x.name === 'RT-HTTP')?.id
    ok(!JSON.stringify(await h.call('mcp.servers_list')).includes('RT-SECRET'), 'token 明文回显')
    return '已保存且脱敏'
  },
  async 'RT-R12-02'(h) {
    if (!h.cache.httpServer) await module.exports['RT-R12-01'](h)
    const r = await testMcp(h, h.cache.httpServer)
    ok(r.ok, `连接失败：${r.error?.message}`)
    const n = Number(r.data.toolCount ?? r.data.count ?? items(r.data).length ?? (r.data.tools ?? []).length)
    ok(n === 3, `工具数 ${n}`)
    return '工具数 3'
  },
  async 'RT-R12-03'(h) {
    const s = await saveHttpMcp(h, { name: 'RT-HTTP-BAD', transport: 'http', url: h.httpMcp.url, token: 'WRONG' })
    const id = s.id ?? items(await h.call('mcp.servers_list')).find(x => x.name === 'RT-HTTP-BAD')?.id
    const r = await testMcp(h, id)
    const msg = r.ok ? JSON.stringify(r.data) : r.error.message
    ok(/认证|401|token|授权/i.test(msg), `未归类为认证失败：${msg}`)
    await h.call('mcp.servers_delete', { id })
    return msg
  },
  async 'RT-R12-04'(h) {
    if (!h.cache.httpServer) await module.exports['RT-R12-01'](h)
    const s = await h.call('mcp.servers_save', { name: 'RT四十五', transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'mcp-fixtures.cjs'), '--stdio'] })
    h.cache.stdioServer = s.id ?? items(await h.call('mcp.servers_list')).find(x => x.name === 'RT四十五')?.id
    await h.sleep(2000)
    h.llm.script('r12-04', () => ({ text: 'x' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R12-04'); await h.send(chatId, '⟦SCN:r12-04⟧ x')
    const r = h.reqsSince(mark, { scenario: 'r12-04' })[0]
    ok(!r.ctx.toolNames.some(n => /^mcp__.+__(filler_\d+|export)(_[0-9a-f]+)?$/.test(n)), '仍逐个注入 MCP 工具')
    ok(['mcp__search_tools', 'mcp__list_tools', 'mcp__call'].every(n => r.ctx.toolNames.includes(n)), `元工具：${r.ctx.toolNames.filter(n => n.startsWith('mcp'))}`)
    ok(r.ctx.system.includes('RT四十五'), '系统提示词未列出服务器')
    return '切换为元工具'
  },
  async 'RT-R12-05'(h) {
    if (!h.cache.stdioServer) await module.exports['RT-R12-04'](h)
    const crash = await h.call('mcp.servers_save', { name: 'RT崩溃', transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'mcp-fixtures.cjs'), '--stdio-crash'] })
    const crashId = crash.id ?? items(await h.call('mcp.servers_list')).find(x => x.name === 'RT崩溃')?.id
    try {
      const r = await h.call('mcp.search_tools', { query: 'export' })
      const names = items(r).map(x => x.originalName ?? x.toolName ?? x.name)
      ok(names[0] === 'export', `首位：${names[0]}`)
      ok(new Set(names.slice(1, 3)).size === 2 && names.slice(1, 3).every(n => ['export_csv', 'bulk_export_jobs'].includes(n)), `名称包含组：${names.slice(1, 3)}`)
      ok(names[3] === 'archive_records', `描述匹配：${names[3]}`)
      ok(JSON.stringify(r.errors ?? []).includes(crashId) || /RT崩溃/.test(JSON.stringify(r.errors ?? [])), `errors=${JSON.stringify(r.errors)}`)
      return names.slice(0, 4).join(' > ')
    } finally { await h.call('mcp.servers_delete', { id: crashId }) }
  },
  async 'RT-R12-06'(h) {
    if (!h.cache.stdioServer) await module.exports['RT-R12-04'](h)
    const p = await h.call('mcp.list_tools', { serverId: h.cache.stdioServer, limit: 10, offset: 40 })
    ok(items(p).length === 5, `第二页 ${items(p).length}`)
    const one = await h.call('mcp.list_tools', { serverId: h.cache.stdioServer, toolName: 'export' })
    ok(items(one)[0]?.inputSchema, '缺少 inputSchema')
    return '分页与完整定义正确'
  },
  async 'RT-R12-07'(h) {
    if (!h.cache.httpServer) await module.exports['RT-R12-01'](h)
    if (h.cache.stdioServer) await h.call('mcp.enable', { id: h.cache.stdioServer, enabled: false })
    await h.sleep(1000)
    h.llm.script('r12-07', () => ({ text: 'x' })); const mark = h.llm.mark()
    const chatId = await h.chat('RT-R12-07'); await h.send(chatId, '⟦SCN:r12-07⟧ x')
    const names = h.reqsSince(mark, { scenario: 'r12-07' })[0].ctx.toolNames
    ok(['rt_echo', 'rt_sum', 'rt_time'].every(t => names.some(n => n.startsWith('mcp__') && n.includes(`__${t}`))), `MCP 工具：${names.filter(n => n.startsWith('mcp__'))}`)
    return '直接注入'
  },

  // ============================== R13 ==============================
  async 'RT-R13-01'(h) {
    await h.call('skills.add', { path: path.join(h.FX, 'skills/rt-skill-beta'), dir: path.join(h.FX, 'skills/rt-skill-beta') })
    const s = items(await h.call('skills.list')).find(x => x.name === 'rt-skill-beta')
    ok(s && /workspace|工作区/.test(s.source), `技能：${JSON.stringify(s)}`)
    return '已添加'
  },
  async 'RT-R13-02'(h) {
    h.copyIntoWs(path.join(h.FX, 'skills/rt-skill-alpha'), '.whywork/skills/rt-skill-alpha'); await h.call('skills.reload', {}).catch(() => {})
    await h.reject('skills.add', { path: path.join(h.FX, 'skills/bad-no-frontmatter'), dir: path.join(h.FX, 'skills/bad-no-frontmatter') })
    await h.reject('skills.add', { path: path.join(h.FX, 'skills/dup-alpha'), dir: path.join(h.FX, 'skills/dup-alpha') })
    ok(!fs.existsSync(path.join(h.ws, '.whywork/skills/bad-no-frontmatter')) && !fs.existsSync(path.join(h.ws, '.whywork/skills/dup-alpha')), '被拒绝的技能写入了目录')
    return '两类均被拒绝'
  },
  async 'RT-R13-03'(h) {
    if (!items(await h.call('skills.list')).some(x => x.name === 'rt-skill-beta')) await h.call('skills.add', { path: path.join(h.FX, 'skills/rt-skill-beta'), dir: path.join(h.FX, 'skills/rt-skill-beta') })
    await h.call('skills.remove', { name: 'rt-skill-beta', confirmed: true })
    ok(!items(await h.call('skills.list')).some(x => x.name === 'rt-skill-beta'), '仍在列表')
    ok(!fs.existsSync(path.join(h.ws, '.whywork/skills/rt-skill-beta')), '目录仍存在')
    return '已移除'
  },
  async 'RT-R13-04'(h) {
    h.copyIntoWs(path.join(h.FX, 'skills/rt-skill-alpha'), '.whywork/skills/rt-skill-alpha'); await h.call('skills.reload', {}).catch(() => {})
    await h.page.locator('.ww-sidebar-footer').getByRole('button', { name: '设置' }).click()
    await (await h.needUi(h.page.getByRole('tab', { name: /^技能$/ }), '技能设置分页')).dispatchEvent('click') // 分页可能处于溢出遮罩下
    await (await h.needUi(h.page.locator('.ant-tabs-tabpane-active').getByPlaceholder(/搜索/), '技能搜索框')).fill('alpha')
    await (await h.needUi(h.page.getByText('rt-skill-alpha'), '搜索结果')).click()
    await h.needUi(h.page.getByText('SKILL-MARKER-ALPHA'), '技能详情')
    return '搜索与详情正常'
  },

  // ============================== R15 ==============================
  async 'RT-R15-01'(h) {
    await h.reject('settings.set', { settings: { 'shortcuts.focusChat': 'A' } })
    const cur = await h.getSetting('shortcuts.newNote') ?? 'CommandOrControl+Alt+N'
    await h.reject('settings.set', { settings: { 'shortcuts.focusChat': cur } })
    const r = await h.raw('settings.set', { settings: { 'shortcuts.focusChat': 'CommandOrControl+Q' } })
    ok(!r.ok || /冲突|警告|warning/i.test(JSON.stringify(r.data)), '系统组合没有冲突提示')
    await h.settings({ 'shortcuts.focusChat': null })
    return '校验生效'
  },
  async 'RT-R15-02'(h) {
    await h.settings({ 'shortcuts.focusChat': 'CommandOrControl+Alt+K' })
    ok(await h.getSetting('shortcuts.focusChat') === 'CommandOrControl+Alt+K', '设置未保存')
    await h.settings({ 'shortcuts.focusChat': null })
    const v = await h.getSetting('shortcuts.focusChat')
    ok(v == null || v === 'CommandOrControl+Alt+Space', `恢复后为 ${v}`)
    return '恢复默认'
  },

  // ============================== R16 ==============================
  async 'RT-R16-01'(h) { await h.reject('media.add_urls', { urls: Array.from({ length: 11 }, (_, i) => `https://example.invalid/v${i}`) }); return '上限生效' },
  async 'RT-R16-02'(h) {
    await h.settings({ 'media.downloaderPath': null }).catch(() => {}); await h.settings({ 'media.ytdlpPath': null }).catch(() => {})
    const r = await h.raw('media.add_urls', { urls: ['https://example.invalid/video'] })
    if (r.error?.code === 'UNKNOWN_ACTION') throw new h.NotImplemented('media.add_urls')
    if (!r.ok) { ok(/下载器|yt-dlp/.test(r.error.message), `提示：${r.error.message}`); return r.error.message }
    const job = await waitFor(async () => items(await h.call('media.jobs')).find(j => /failed|失败/.test(String(j.status))), 15_000, '任务失败')
    ok(/下载器|yt-dlp/.test(JSON.stringify(job)), `提示：${JSON.stringify(job)}`)
    return '提示配置下载器'
  },

  // ============================== R18 ==============================
  async 'RT-R18-01'(h) {
    await ocrImport(h)
    const hit = h.cache.ocrHit
    ok(/图片文字/.test(String(hit.searchSnippet ?? hit.snippet ?? '') + String(hit.searchSource ?? hit.sourceLabel ?? '')), `命中片段未注明“图片文字”：${String(hit.searchSnippet ?? hit.snippet ?? '').slice(0, 120)}`)
    return '图片文字可检索'
  },
  async 'RT-R18-02'(h) {
    const n = await h.note(await ocrImport(h))
    ok((n.images ?? []).some(i => /ORION-17/.test(i.ocrText ?? '')), `images=${String(JSON.stringify(n.images ?? null)).slice(0, 200)}`)
    return '附带图片文字'
  },
  async 'RT-R18-03'(h) {
    const [noteId] = await h.importFiles([path.join(h.FX, 'pdf/scanned.pdf')])
    await waitFor(async () => { const status=await h.call('media.ocr_status',{noteId}); const failure=items(status).find(x=>x.state==='error'); if(failure)throw Object.assign(new Error('扫描PDF OCR失败：'+JSON.stringify(failure)),{fatal:true}); if(items(status).length&&items(status).every(x=>x.state==='done')){const hit=items(await h.call('notes.list', {query:'OCR_MARKER_742'})).some(i=>(i.noteId??i.note_id)===noteId);if(!hit)throw Object.assign(new Error('OCR已完成但标记未命中：'+JSON.stringify((await h.note(noteId)).images)),{fatal:true});return hit} return items(await h.call('notes.list', { query: 'OCR_MARKER_742' })).some(i => (i.noteId ?? i.note_id) === noteId) }, 100_000, '扫描 PDF OCR')
    return '扫描 PDF 可检索'
  },
  async 'RT-R18-04'(h) {
    await h.call('notes.delete', { noteId: await ocrImport(h) })
    ok(!items(await h.call('notes.list', { query: 'OCR_MARKER_742' })).some(i => (i.noteId ?? i.note_id) === h.cache.ocrNote), '删除后仍命中')
    return '已移出索引'
  },

  // ============================== R19 ==============================
  async 'RT-R19-01'(h) {
    h.copyIntoWs(path.join(h.FX, 'office/rt-sheets.xlsx'), 'rt/rt-sheets.xlsx')
    const exp = JSON.parse(fs.readFileSync(path.join(h.ORACLE, 'expected.json'), 'utf-8')).xlsx
    const r = await h.call('office.xlsx_summary', { path: 'rt/rt-sheets.xlsx' })
    const sheets = r.sheets ?? []
    for (const e of exp.sheets) {
      const s = sheets.find(x => x.name === e.name)
      ok(s, `缺少工作表 ${e.name}`)
      ok([e.rows, e.rows - 1].includes(Number(s.rows ?? s.rowCount)) && Number(s.cols ?? s.columns ?? s.columnCount) === e.cols, `${e.name} 行列：${JSON.stringify(s)}`)
    }
    ok(JSON.stringify(r).includes('订单号'), '缺少表头样例')
    return '结构概览正确'
  },
  async 'RT-R19-02'(h) {
    h.copyIntoWs(path.join(h.FX, 'office/rt-sheets.xlsx'), 'rt/rt-sheets.xlsx')
    let rr = await h.raw('office.xlsx_read', { path: 'rt/rt-sheets.xlsx', sheets: [0, 1] })
    if (rr.error?.code === 'BAD_PAYLOAD') rr = await h.raw('office.xlsx_read', { path: 'rt/rt-sheets.xlsx', sheets: ['订单', '汇总'] })
    if (rr.error?.code === 'UNKNOWN_ACTION') throw new h.NotImplemented('office.xlsx_read')
    ok(rr.ok, `读取失败：${rr.error?.message}`)
    const r = rr.data
    const text = String(r.content ?? r.text ?? JSON.stringify(r.sheets ?? r))
    ok(text.length <= 20_000 + 2000, `返回 ${text.length} 字符`)
    const sheet0 = (r.sheets ?? [])[0] ?? {}
    const next = r.nextOffset ?? r.next_offset ?? r.continuation?.offset ?? sheet0.nextOffset
    const remaining = r.remainingRows ?? r.remaining ?? r.continuation?.remaining ?? (r.sheets ?? []).reduce((n, x) => n + Number(x.remaining ?? 0), 0)
    ok(next != null && Number(remaining) > 0, `缺少续读信息：${JSON.stringify(Object.keys(r))}`)
    let r2 = await h.raw('office.xlsx_read', { path: 'rt/rt-sheets.xlsx', sheets: [0], offset: Number(next) })
    if (r2.error?.code === 'BAD_PAYLOAD') r2 = await h.raw('office.xlsx_read', { path: 'rt/rt-sheets.xlsx', sheets: ['订单'], offset: Number(next) })
    r2 = r2.data ?? {}
    const t2 = String(r2.content ?? r2.text ?? JSON.stringify(r2))
    ok(t2 !== text && /ORD-\d{4}/.test(t2), '续读没有新数据')
    return `首段 ${text.length} 字符，续读 offset=${next}`
  },
  async 'RT-R19-03'(h) { await h.reject('office.xlsx_summary', { path: path.join(h.FX, 'office/rt-sheets.xlsx') }); return '工作区外拒绝' },
  async 'RT-R19-04'(h) {
    const outline = JSON.parse(fs.readFileSync(path.join(h.FX, 'office/ppt-outline.json'), 'utf-8'))
    const themes = items(await h.call('office.slide_themes'))
    ok(themes.length >= 3, `主题数 ${themes.length}`)
    const theme = themes[0]
    const r = await h.call('office.slides', { outline, themeId: theme.id })
    const file = path.isAbsolute(r.path) ? r.path : path.join(h.ws, r.path)
    const JSZip = require(path.join(h.REPO, 'node_modules/jszip'))
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const slides = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    ok(slides.length === 3, `页数 ${slides.length}`)
    const color = String(theme.primaryColor ?? theme.color ?? '').replace('#', '').toUpperCase()
    const xml = (await Promise.all(Object.keys(zip.files).filter(f => /\.xml$/.test(f)).map(f => zip.file(f).async('string')))).join('').toUpperCase()
    ok(color && xml.includes(color), `未找到主题色 ${color}`)
    return `3 页，主题色 ${color}`
  },
  async 'RT-R19-05'(h) {
    await h.mk('RT-R19-05 页纲', '# 标题\n- 要点一\n- 要点二')
    await h.page.getByRole('navigation', { name: '工具竖栏' }).getByRole('button', { name: 'Office 表格', exact: true }).click()
    await h.page.locator('.ant-tabs-tabpane-active .ant-select').filter({ hasText: /选择.*笔记/ }).first().click()
    await h.page.locator('.ant-select-dropdown').getByText('RT-R19-05 页纲').last().click()
    await h.bg(true)
    await h.page.getByRole('button', { name: /AI 生成 PPT/ }).click()
    await h.needUi(h.page.getByRole('button', { name: /添加页|新增页/ }), '页纲增删')
    await h.needUi(h.page.getByRole('button', { name: /生成|确认/ }).filter({ hasNotText: 'AI 生成 PPT' }), '确认生成按钮')
    return '先编辑页纲再生成'
  },

  // ============================== R20 ==============================
  async 'RT-R20-01'(h) {
    const acct = h.cache.mailAccount ?? (h.cache.mailAccount = (await h.call('mail.save_account', { name: 'RT账户', host: '127.0.0.1', port: 9, user: 'rt@example.com', password: 'synthetic', smtpHost: '127.0.0.1', smtpPort: 9 })).id)
    const mkFile = (rel, mb) => { const f = path.join(h.ws, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(mb * 1024 * 1024)); return rel }
    const base = { id: acct, to: 'a@example.com', subject: 's', text: 't', confirmed: true }
    await h.reject('mail.send', { ...base, attachments: [{ path: mkFile('rt/big21.bin', 21) }] }, /20|大小|超过/)
    await h.reject('mail.send', { ...base, attachments: [{ path: mkFile('rt/a13.bin', 13) }, { path: mkFile('rt/b13.bin', 13) }] }, /25|大小|超过/)
    const out = path.join(h.tmpDir(), 'o.txt'); fs.writeFileSync(out, 'x')
    await h.reject('mail.send', { ...base, attachments: [{ path: out }] })
    for (const f of ['rt/big21.bin', 'rt/a13.bin', 'rt/b13.bin']) fs.rmSync(path.join(h.ws, f), { force: true })
    return '三种情况均被拒绝'
  },
  async 'RT-R20-02'(h) {
    const acct = h.cache.mailAccount ?? (h.cache.mailAccount = (await h.call('mail.save_account', { name: 'RT账户', host: '127.0.0.1', port: 9, user: 'rt@example.com', password: 'synthetic', smtpHost: '127.0.0.1', smtpPort: 9 })).id)
    await h.reject('mail.send', { id: acct, to: 'a@example.com', subject: 'RT-R20-02', text: 't', confirmed: true }, /无法连接|连接/)
    const failed = items(await h.call('mail.failed_list'))
    const f = failed.find(x => JSON.stringify(x).includes('RT-R20-02'))
    ok(f && /连接/.test(JSON.stringify(f)), `失败列表：${JSON.stringify(failed).slice(0, 200)}`)
    h.cache.failedMail = f.id
    return '分类正确并入失败列表'
  },
  async 'RT-R20-03'(h) {
    if (!h.cache.failedMail) await module.exports['RT-R20-02'](h)
    await h.reject('mail.retry', { id: h.cache.failedMail }, /确认/)
    return '未确认不重试'
  },

  // ============================== R21 ==============================
  async 'RT-R21-01'(h) {
    const day = n => { const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() + n); return d }
    const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const ev = (uid, title, d) => `BEGIN:VEVENT\r\nUID:${uid}@rt\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(d)}\r\nDTEND:${fmt(new Date(d.getTime() + 3600000))}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\n`
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//RT//EN\r\n' + [
      ev('y', 'RT日历 昨天', day(-1)), ev('t', 'RT日历 今天', day(0)), ev('m', 'RT日历 明天', day(1)),
      ev('p11', 'RT日历 十一个月后', day(330)), ev('p13', 'RT日历 十三个月后', day(395)), ev('old', 'RT日历 一年零一天前', day(-367)),
      ...Array.from({ length: 30 }, (_, i) => ev(`bulk${i}`, `RT批量事件 ${i}`, day(2 + i)))
    ].join('') + 'END:VCALENDAR\r\n'
    const file = path.join(h.tmpDir(), 'rt.ics'); fs.writeFileSync(file, ics)
    await h.stubOpenDialog([file])
    try { await h.call('calendar.import') } finally { await h.restoreOpenDialog() }
    const titles = r => items(r).map(e => e.title ?? e.summary)
    const def = titles(await h.call('calendar.search', { query: 'RT日历', limit: 100 }))
    ok(def.includes('RT日历 十一个月后') && !def.includes('RT日历 十三个月后') && !def.includes('RT日历 一年零一天前'), `默认范围：${def}`)
    const range = titles(await h.call('calendar.search', { start: h.today(), end: h.today(1), query: 'RT日历' }))
    ok(range.includes('RT日历 今天') && !range.includes('RT日历 明天'), `半开区间：${range}`)
    const dflt = await h.call('calendar.search', { query: 'RT批量事件' })
    ok(items(dflt).length === 20, `默认 limit：${items(dflt).length}`)
    const big = await h.raw('calendar.search', { query: 'RT批量事件', limit: 500 })
    ok(!big.ok || items(big.data).length <= 100, '上限未生效')
    return '范围、区间、上限均正确'
  },
  async 'RT-R21-02'(h) {
    await h.page.getByRole('navigation', { name: '工具竖栏' }).getByRole('button', { name: '日历', exact: true }).click()
    await h.page.locator('.ant-tabs-tabpane-active').waitFor()
    ok(!(await h.exists(h.page.getByText('连接系统日历'), 2000)), 'Linux 显示了系统日历入口')
    return '入口已隐藏'
  },

  // ============================== R22 ==============================
  async 'RT-R22-01'(h) {
    await h.page.getByRole('navigation', { name: '工具竖栏' }).getByRole('button', { name: '设备绑定', exact: true }).click()
    await h.page.getByRole('button', { name: '生成配对码' }).click()
    const t1 = await (await h.needUi(h.page.getByText(/\d+:\d{2}|剩余\s*\d+/), '倒计时')).innerText()
    await h.sleep(2200)
    const t2 = await h.page.getByText(/\d+:\d{2}|剩余\s*\d+/).first().innerText()
    ok(t1 !== t2, '倒计时没有变化')
    await h.page.getByRole('button', { name: '关闭服务' }).click()
    return `${t1} → ${t2}`
  },

  // ============================== 横向 ==============================
  async 'RT-X-01'(h) {
    const extracted = '/home/orca/work/remio-research/extracted'
    const root = process.env.REMIO_EXTRACTED ?? extracted
    if (!fs.existsSync(root)) throw new h.Blocked('未找到 remio 解包目录（可用 REMIO_EXTRACTED 指定）')
    const remio = new Set()
    for (const f of fs.readdirSync(root, { recursive: true })) {
      const full = path.join(root, f); const st = fs.statSync(full)
      if (st.isFile() && st.size >= 64) remio.add(crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'))
    }
    const git = require('node:child_process').spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: h.REPO, encoding: 'utf-8' })
    const hits = []
    for (const rel of git.stdout.split('\n').filter(Boolean)) {
      const full = path.join(h.REPO, rel)
      if (!fs.existsSync(full) || !fs.statSync(full).isFile() || fs.statSync(full).size < 64) continue
      if (/^(LICEN[CS]E|NOTICE|COPYING)(\.|$)/i.test(path.basename(rel))) continue // 公开许可证文本相同不代表复制了 remio 内容
      if (remio.has(crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'))) hits.push(rel)
    }
    ok(hits.length === 0, `与 remio 文件相同：${hits.join(', ')}`)
    return `比对 ${remio.size} 个 remio 文件，无相同`
  },
  async 'RT-X-02'(h) {
    const providers = items(await h.call('provider.list'))
    const remote = providers.filter(p => p.baseUrl && !/^http:\/\/127\.0\.0\.1[:/]/.test(p.baseUrl) && p.enabled !== false && String(p.id).includes('rt'))
    ok(remote.length === 0, `存在非本机供应商：${remote.map(p => p.id)}`)
    const nonLocal = h.llm.requests.filter(r => r.headers?.host && !/^127\.0\.0\.1(:\d+)?$/.test(r.headers.host))
    ok(nonLocal.length === 0, '伪造服务收到非本机请求')
    return `伪造服务共收到 ${h.llm.requests.length} 个请求，全部本机`
  }
}
