#!/usr/bin/env node
// REMIO-R 验收执行器（黑盒）。只使用 --ui-check 隔离实例、本机伪造模型/MCP 服务与合成 fixtures。
//
// 用法（先 npm run build；Linux 无显示器时加 xvfb-run -a）：
//   node tests/acceptance/remio-r/run.cjs                 运行全部自动用例
//   node tests/acceptance/remio-r/run.cjs --only=R1,R5    只运行指定任务
//   node tests/acceptance/remio-r/run.cjs --ids=RT-R1-01,RT-R5-02
//   node tests/acceptance/remio-r/run.cjs --level=AUTO-API
//   node tests/acceptance/remio-r/run.cjs --list          只打印用例清单
// 报告：release/verification/remio-r/<时间>/report.json 与 summary.md
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const HERE = __dirname
const REPO = path.resolve(HERE, '../../..')
const { cases } = require('./cases.json')
const { createFakeLlm } = require('./fake-llm.cjs')
const { startHttpMcp } = require('./mcp-fixtures.cjs')
const IMPL = require('./cases-impl.cjs')

const argv = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const only = argv.only ? new Set(String(argv.only).split(',')) : null
const ids = argv.ids ? new Set(String(argv.ids).split(',')) : null
const levelFilter = argv.level ? new Set(String(argv.level).split(',')) : null
const CASE_TIMEOUT = Number(argv.timeout ?? 120_000)

class NotImplemented extends Error {}
class Blocked extends Error {}

function selected(c) {
  if (only && !only.has(c.task)) return false
  if (ids && !ids.has(c.id)) return false
  if (levelFilter && !levelFilter.has(c.level)) return false
  return true
}

if (argv.list) {
  for (const c of cases.filter(selected)) console.log(`${c.id}\t${c.level}\t${c.env}\t${c.title}`)
  process.exit(0)
}

// 自检：每个自动用例都必须有实现，实现不得多出未登记的用例
const autoIds = cases.filter(c => c.level.startsWith('AUTO')).map(c => c.id)
const missing = autoIds.filter(id => !IMPL[id])
const extra = Object.keys(IMPL).filter(id => !autoIds.includes(id))
if (missing.length || extra.length) {
  console.error('[REMIO-R] 用例登记与实现不一致', { missing, extra })
  process.exit(2)
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const entry = path.join(REPO, 'out/main/index.js')
  if (!fs.existsSync(entry)) { console.error('请先 npm run build'); process.exit(2) }
  const verify = spawnSync(process.execPath, [path.join(REPO, 'tests/fixtures/remio-r/generate.cjs'), '--verify'], { encoding: 'utf-8' })
  if (verify.status !== 0) { console.error('fixtures 校验失败：', verify.stdout, verify.stderr); process.exit(2) }

  const outDir = path.join(REPO, 'release/verification/remio-r', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(outDir, { recursive: true })
  // 从构建快照启动：其他 agent 在运行期间重新构建 out/ 不会影响本次执行
  const snapshotRoot = path.join(outDir, 'app')
  const stampOf = root => ['main/index.js', 'renderer/index.html', 'preload/index.js'].map(f => { try { return fs.statSync(path.join(root, f)).mtimeMs } catch { return 0 } }).join('|')
  let snapshotOk = false
  for (let attempt = 0; attempt < 5 && !snapshotOk; attempt++) {
    const before = stampOf(path.join(REPO, 'out'))
    fs.rmSync(snapshotRoot, { recursive: true, force: true })
    fs.cpSync(path.join(REPO, 'out'), path.join(snapshotRoot, 'out'), { recursive: true })
    const html = fs.readFileSync(path.join(snapshotRoot, 'out/renderer/index.html'), 'utf-8')
    const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1])
    snapshotOk = before === stampOf(path.join(REPO, 'out')) && refs.every(r => fs.existsSync(path.join(snapshotRoot, 'out/renderer', r)))
    if (!snapshotOk) { console.error('[REMIO-R] out/ 正在被改写，3 秒后重新拍摄快照'); await sleep(3000) }
  }
  if (!snapshotOk) { console.error('[REMIO-R] 无法得到完整的构建快照，请在构建稳定后重跑'); process.exit(2) }
  const snapshotOut = path.join(snapshotRoot, 'out')
  const report = {
    suite: 'REMIO-R', startedAt: new Date().toISOString(), platform: process.platform,
    build: Object.fromEntries(fs.readdirSync(snapshotOut, { recursive: true }).filter(f => fs.statSync(path.join(snapshotOut, f)).isFile()).sort().map(f => [f, sha(fs.readFileSync(path.join(snapshotOut, f)))])),
    results: []
  }

  const llm = createFakeLlm()
  const llmUrl = await llm.start()
  const httpMcp = await startHttpMcp({ token: 'RT-SECRET' })
  const { _electron: electron } = require(path.join(REPO, 'node_modules/playwright'))
  // HOME 指向沙箱：涉及“主目录”“推荐目录”的用例只会接触这里，不会扫描真实用户目录
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whywork-remio-r-home-'))
  for (const d of ['Downloads', 'Documents', 'Desktop']) fs.mkdirSync(path.join(sandboxHome, d))
  const env = { ...process.env, HOME: sandboxHome }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.join(snapshotOut, 'main/index.js'), '--ui-check'], cwd: REPO, env, timeout: 60_000 })
  let ws = null
  const cleanup = async () => {
    const proc = app.process()
    await app.close().catch(() => proc?.kill('SIGKILL'))
    // 等进程真正退出后再删目录，否则退出过程中的写入会让隔离目录残留
    for (let i = 0; i < 50 && proc && proc.exitCode === null && proc.signalCode === null; i++) await sleep(100)
    if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    await llm.close().catch(() => {}); await httpMcp.close().catch(() => {})
    if (ws) { const root = path.dirname(ws); if (/whywork-isolated-/.test(path.basename(root))) fs.rmSync(root, { recursive: true, force: true }) }
    fs.rmSync(sandboxHome, { recursive: true, force: true })
    fs.rmSync(snapshotRoot, { recursive: true, force: true })
  }
  try {
    await runAll()
  } catch (e) {
    console.error('[REMIO-R] 执行器错误', e)
    await cleanup()
    process.exit(2)
  }
  async function runAll() {
  const page = await app.firstWindow()
  await page.emulateMedia({ colorScheme: null })
  report.theme=argv.theme==='dark'?'dark':'light'
  await app.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme},report.theme)
  page.setDefaultTimeout(15_000)
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.locator('.ww-shell').waitFor()
  await page.evaluate(() => { window.__rt = []; window.whywork.onEvent(e => window.__rt.push({ t: Date.now(), topic: e.topic, payload: e.payload })) })

  const raw = (action, payload) => page.evaluate(([a, p]) => window.whywork.sys(a, p), [action, payload])
  ws = (await raw('app.get_workspace')).data.path
  if (!/whywork-isolated-[^/\\]+[/\\]workspace$/.test(ws)) throw new Error('不是隔离工作区，停止执行：' + ws)

  const h = createHarness({ app, page, raw, ws, llm, llmUrl, httpMcp, pageErrors })
  h.sandboxHome = sandboxHome
  await h.bootstrap()

  // 快照在运行期间不应变化；若被改写（例如人工误操作），已加载页面的引用会失效，结果不可信
  const buildStamp = () => stampOf(snapshotOut)
  const stamp0 = buildStamp()
  report.buildChangedDuringRun = false
  for (const c of cases) {
    if (!selected(c)) continue
    if (buildStamp() !== stamp0) {
      report.buildChangedDuringRun = true
      console.error(`[REMIO-R] 构建产物在运行期间被修改，于 ${c.id} 前中止；本次结果无效，请在构建稳定后重跑`)
      break
    }
    const result = { id: c.id, task: c.task, level: c.level, env: c.env, title: c.title, status: 'PASS', detail: '', ms: 0 }
    const t0 = Date.now()
    if (c.level === 'MANUAL') { result.status = 'MANUAL'; result.detail = '人工用例：按 docs/TEST-PLAN-REMIO-R.md 执行并补结论' }
    else if (c.level === 'REAL') { result.status = 'BLOCKED'; result.detail = '需要真实账号/服务（REAL），自动执行器不运行' }
    else if (c.env === 'mac' && process.platform !== 'darwin') { result.status = 'BLOCKED'; result.detail = '需要 macOS' }
    else if (c.env === 'linux' && process.platform !== 'linux') { result.status = 'BLOCKED'; result.detail = '用例依赖 Linux 文件权限语义' }
    else {
      process.stdout.write(`[REMIO-R] ${c.id} ${c.title} … `)
      await page.evaluate(() => { window.__rt = [] })
      h.caseStart()
      try {
        const detail = await Promise.race([IMPL[c.id](h), sleep(CASE_TIMEOUT).then(() => { throw new Error(`超时 ${CASE_TIMEOUT}ms`) })])
        result.detail = String(detail ?? '')
        if(c.level==='AUTO-UI')await page.screenshot({path:path.join(outDir,`${c.id}.png`)})
      } catch (e) {
        result.status = e instanceof NotImplemented || e?.name === 'NotImplemented' ? 'NOT_IMPLEMENTED' : e instanceof Blocked || e?.name === 'Blocked' ? 'BLOCKED' : 'FAIL'
        result.detail = e?.message ?? String(e)
        try { await page.screenshot({ path: path.join(outDir, `${c.id}.png`) }) } catch {}
      }
      await h.caseEnd()
      console.log(result.status)
    }
    result.ms = Date.now() - t0
    report.results.push(result)
  }

  report.finishedAt = new Date().toISOString()
  report.fakeLlmRequests = llm.requests.length
  report.nonLocalRequests = llm.requests.filter(r => r.headers?.host && !/^127\.0\.0\.1(:\d+)?$/.test(r.headers.host)).length
  report.pageErrors = pageErrors
  report.secretStoreStub = h.secretStoreStub
  const counts = report.results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  report.counts = counts
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  const lines = ['# REMIO-R 验收报告', '', `- 时间：${report.startedAt} ～ ${report.finishedAt}`, `- 平台：${report.platform}`, `- 密钥存储：${report.secretStoreStub ? '测试替身（系统密钥库不可用，本报告不证明真实加密）' : '系统密钥库'}`, ...(report.buildChangedDuringRun ? ['- **构建产物在运行期间被修改，执行已中止，本报告无效**'] : []), `- 统计：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}`, '', '| ID | 级别 | 状态 | 标题 | 说明 |', '|---|---|---|---|---|',
    ...report.results.map(r => `| ${r.id} | ${r.level} | ${r.status} | ${r.title} | ${String(r.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`)]
  fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n') + '\n')
  console.log('[REMIO-R]', JSON.stringify(counts), '报告：', path.relative(REPO, outDir))

  await cleanup()
  for (const d of h.tempDirs) { try { fs.chmodSync(d, 0o700) } catch {} fs.rmSync(d, { recursive: true, force: true }) }
  process.exit(report.buildChangedDuringRun ? 3 : (counts.FAIL ?? 0) + (counts.NOT_IMPLEMENTED ?? 0) > 0 ? 1 : 0)
  }
}

// ---------------------------------------------------------------------------
function createHarness({ app, page, raw, ws, llm, llmUrl, httpMcp, pageErrors }) {
  const PROVIDER = 'openai-compat:rt-fake'
  const tempDirs = []
  let errorMark = 0
  const h = {
    app, page, ws, llm, llmUrl, httpMcp, tempDirs, REPO,
    FX: path.join(REPO, 'tests/fixtures/remio-r/importable'),
    ORACLE: path.join(REPO, 'tests/fixtures/remio-r/oracle'),
    WFX: path.join(REPO, 'tests/fixtures/work/importable'),
    PROVIDER,
    sel: { providerId: PROVIDER, model: 'scripted' },
    bgSel: { providerId: PROVIDER, model: 'bg-model' },
    NotImplemented, Blocked, sleep,
    cache: {},

    caseStart() { errorMark = pageErrors.length },
    newPageErrors() { return pageErrors.slice(errorMark) },
    async caseEnd() {
      // 关闭残留浮层/抽屉，清空输入框上的引用标签，避免影响下一条用例
      try { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); const close=page.locator('.ant-modal:visible .ant-modal-close'); if(await close.count())await close.last().click() } catch {}
      try {
        await h.toChat()
        const clear = page.locator('.ww-chat-pane').getByRole('button', { name: /全部移除/ })
        if (await clear.isVisible({ timeout: 500 }).catch(() => false)) await clear.click()
        await page.getByLabel('对话输入').fill('').catch(() => {})
      } catch {}
      await h.restoreOpenDialog().catch(() => {})
    },

    secretStoreStub: false,
    async bootstrap() {
      // Linux 无密钥库时 safeStorage 不可用；仅在隔离实例内换成可逆的测试替身，凭据均为合成值。
      // 真实加密由 --core-check（macOS 钥匙串）另行验证，报告中会注明 secretStoreStub。
      h.secretStoreStub = await app.evaluate(({ safeStorage }) => {
        if (safeStorage.isEncryptionAvailable()) return false
        safeStorage.isEncryptionAvailable = () => true
        safeStorage.encryptString = s => Buffer.from('rt-stub:' + s, 'utf-8')
        safeStorage.decryptString = b => Buffer.from(b).toString('utf-8').replace(/^rt-stub:/, '')
        return true
      })
      // 默认让原生“打开”对话框直接返回取消，防止误触后阻塞；需要选文件的用例再临时替换
      await app.evaluate(({ dialog }) => {
        dialog.__rtDefault = async () => ({ canceled: true, filePaths: [] })
        dialog.showOpenDialog = dialog.__rtDefault
      })
      await h.call('provider.save', { id: PROVIDER, kind: 'openai-compat', name: 'RT伪造模型', baseUrl: llmUrl, apiKey: 'synthetic-only', models: { fast: ['scripted', 'bg-model'], expert: [] } })
      await h.raw('settings.set', { settings: { 'chat.autoTitle': 'false' } })
    },

    raw,
    /** 调用接口；未实现时抛 NotImplemented */
    async call(action, payload) {
      const r = await raw(action, payload)
      if (r.ok) return r.data
      const code = r.error?.code, msg = r.error?.message ?? ''
      if (code === 'UNKNOWN_ACTION') throw new NotImplemented(`接口未实现：${action}`)
      const e = new Error(`[${code}] ${action}: ${msg}`); e.code = code; e.sysMessage = msg; throw e
    },
    /** 期望失败；返回错误信息。接口不存在时抛 NotImplemented */
    async reject(action, payload, re) {
      const r = await raw(action, payload)
      if (r.ok) throw new Error(`期望 ${action} 被拒绝，实际成功：${JSON.stringify(r.data).slice(0, 200)}`)
      if (r.error?.code === 'UNKNOWN_ACTION') throw new NotImplemented(`接口未实现：${action}`)
      const msg = `${r.error?.code} ${r.error?.message ?? ''}`
      if (re && !re.test(msg)) throw new Error(`${action} 的错误信息不符合 ${re}：${msg}`)
      return msg
    },
    async settings(obj) {
      const settings = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === null || typeof v === 'string' ? v : JSON.stringify(v)]))
      return h.call('settings.set', { settings })
    },
    async getSetting(key) { const r = await h.call('settings.get', { keys: [key] }); return (r.values ?? r.settings ?? r)[key] },
    async bg(on) { await h.settings({ 'ai.backgroundModel': on ? h.bgSel : null }) },

    // ---------- 笔记 ----------
    async mk(title, body = '', extra = {}) { return (await h.call('notes.create', { title, body, ...extra })).noteId },
    async note(noteId, extra = {}) { return h.call('notes.get', { noteId, ...extra }) },
    async body(noteId) { const n = await h.note(noteId); return String(n.body ?? n.content ?? '') },
    noteField(n, key) { const o = n.note ?? n; return o[key] ?? o[key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())] },
    async importFiles(files) {
      const r = await h.call('app.import', { paths: files })
      if (r.errors?.length) throw new Error('导入失败：' + r.errors.join('; '))
      return r.noteIds
    },
    async corpus() {
      if (h.cache.corpus) return h.cache.corpus
      const files = ['cite-01_北辰计划.md', 'cite-02_北辰风险.md', 'cite-03_南岭计划.md'].map(f => path.join(h.FX, 'notes', f))
      const idsArr = await h.importFiles(files)
      h.cache.corpus = { cite01: idsArr[0], cite02: idsArr[1], cite03: idsArr[2] }
      return h.cache.corpus
    },
    copyIntoWs(src, rel) {
      const dest = path.join(ws, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(src, dest, { recursive: true })
      return dest
    },
    tmpDir(prefix = 'rt-') { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'whywork-remio-r-' + prefix)); tempDirs.push(d); return d },
    today(offsetDays = 0) { const d = new Date(Date.now() + offsetDays * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },

    // ---------- 事件与对话 ----------
    async events() { return page.evaluate(() => window.__rt) },
    async waitEvent(pred, timeout = 30_000, what = '事件') {
      const end = Date.now() + timeout
      while (Date.now() < end) {
        const hit = (await h.events()).find(pred)
        if (hit) return hit
        await sleep(100)
      }
      throw new Error(`等待${what}超时`)
    },
    async chat(title, extra = {}) { return (await h.call('chat.create', { title, selection: h.sel, ...extra })).chatId },
    /** 发送并等待结束；遇到确认卡按 confirm 回调处理（默认拒绝） */
    async send(chatId, text, extra = {}, opts = {}) {
      const before = (await h.events()).length
      await h.call('chat.send', { chatId, text, selection: extra.selection ?? h.sel, ...extra })
      if (opts.noWait) return null
      const end = Date.now() + (opts.timeout ?? 45_000)
      const handled = new Set()
      while (Date.now() < end) {
        const evs = (await h.events()).slice(before)
        for (const e of evs) {
          if (e.topic === 'chat.confirm' && e.payload?.chatId === chatId && !handled.has(e.payload.id)) {
            handled.add(e.payload.id)
            const decision = opts.confirm ? await opts.confirm(e.payload) : { approved: false }
            await h.call('chat.confirm', { id: e.payload.id, chatId, approved: decision.approved, ...(decision.override ? { override: decision.override } : {}) })
          }
        }
        const done = evs.find(e => (e.topic === 'chat.done' || e.topic === 'chat.error') && e.payload?.chatId === chatId)
        if (done) return done
        await sleep(100)
      }
      throw new Error('等待对话结束超时')
    },
    async messages(chatId) {
      const r = await h.call('chat.messages', { chatId })
      return (r.messages ?? r.items ?? []).map(m => ({ ...m, reasoning: m.reasoning, refs: h.json(m.refs), sources: h.json(m.sources), usage: h.json(m.usage) }))
    },
    json(v) { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v) } catch { return v } },
    lastAssistant(msgs) { return [...msgs].reverse().find(m => m.role === 'assistant' && (m.content ?? '') !== '') },
    /** 本用例开始后的模型请求 */
    reqsSince(mark, filter = {}) { return llm.chatRequests(filter).filter(r => llm.requests.indexOf(r) >= mark) },

    // ---------- 主进程替身（仅隔离实例） ----------
    async stubOpenDialog(paths) {
      await app.evaluate(({ dialog }, ps) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps }) }, paths)
    },
    async restoreOpenDialog() { await app.evaluate(({ dialog }) => { if (dialog.__rtDefault) dialog.showOpenDialog = dialog.__rtDefault }) },
    /** 侧栏会话行的“…”菜单按钮：同一行中除标题按钮外的按钮 */
    chatRowMenu(title) {
      const titleBtn = page.locator('.ww-sidebar button').filter({ hasText: title }).first()
      return titleBtn.locator('xpath=..').locator('button').filter({ hasNotText: title }).first()
    },
    /** 通过界面在当前会话发送消息（界面才会进入运行状态） */
    async sendUi(text) {
      const input = page.getByLabel('对话输入')
      await input.fill(text); await input.press('Enter')
    },
    async clipboard() { return app.evaluate(({ clipboard }) => clipboard.readText()) },

    // ---------- 合成录音（渲染进程内真实 MediaRecorder） ----------
    async synthWebm(ms = 1500) {
      return page.evaluate(async dur => {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator(); osc.frequency.value = 440
        const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start()
        const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' })
        const parts = []
        rec.ondataavailable = e => parts.push(e.data)
        const stopped = new Promise(r => (rec.onstop = r))
        rec.start(); await new Promise(r => setTimeout(r, dur)); rec.stop(); await stopped
        osc.stop(); await ctx.close()
        const buf = new Uint8Array(await new Blob(parts, { type: 'audio/webm' }).arrayBuffer())
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
        return { mime: 'audio/webm', data: btoa(s), durationMs: dur }
      }, ms)
    },

    // ---------- 界面 ----------
    chatPane() { return page.locator('.ww-chat-pane') },
    async toChat() { await page.getByRole('navigation', { name: '工具竖栏' }).getByRole('button', { name: 'AI 问答', exact: true }).click() },
    async refreshUi() {
      await page.locator('.ww-sidebar-footer').getByRole('button', { name: '设置' }).click()
      await h.toChat()
    },
    async openChatUi(title) {
      await h.refreshUi()
      await page.locator('.ww-sidebar button, .ww-sidebar [role=button]').filter({ hasText: title }).first().click()
    },
    async openNotesUi() { await page.locator('.ww-sidebar button').filter({ hasText: /^全部笔记$/ }).click() },
    // 只认可见元素：antd 等组件会额外渲染隐藏的无障碍副本
    async exists(locator, timeout = 5000) { try { await locator.filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true } catch { return false } },
    async needUi(locator, what, timeout = 8000) {
      if (!(await h.exists(locator, timeout))) throw new NotImplemented(`界面元素不存在：${what}`)
      return locator.filter({ visible: true }).first()
    }
  }
  return h
}

main().catch(e => { console.error('[REMIO-R] 执行器错误', e); process.exit(2) })
