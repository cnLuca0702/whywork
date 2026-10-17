// Only the application's --ui-check temporary workspace is used. No real accounts.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const http = require('node:http')
const { _electron: electron } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'release/verification/ui', new Date().toISOString().replace(/[:.]/g, '-'))
const entry = path.join(root, 'out/main/index.js')
const report = { status: 'RUNNING', platform: process.platform, captures: [], errors: [] }
let fixtureServer
let application
const watchdog = setTimeout(() => {
  report.status = 'FAIL'
  report.errors.push('UI capture exceeded 180 seconds')
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  application?.process().kill('SIGKILL')
  process.exit(1)
}, 180_000)

async function run() {
  fs.mkdirSync(output, { recursive: true })
  assert(fs.existsSync(entry), 'Run npm run build before check:ui')
  report.buildFiles = Object.fromEntries(fs.readdirSync(path.join(root, 'out'), { recursive: true })
    .filter(file => fs.statSync(path.join(root, 'out', file)).isFile()).sort()
    .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'out', file))).digest('hex')]))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const fixtureMarkdown = '## 合成回复\n\n| 项目 | 数量 |\n| --- | --- |\n| 验证 | 3 |\n\n```javascript\nconst answer = 42;\n```\n\n$x^2$ 与 [[截图来源]]'
  fixtureServer = http.createServer((request, response) => {
    if(request.url === '/models') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'synthetic-model'}]}));return}
    response.setHeader('Content-Type','text/event-stream')
    response.end('data: '+JSON.stringify({choices:[{delta:{content:fixtureMarkdown,reasoning_content:'这是测试服务返回的合成推理文本。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  })
  await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve))
  application = await electron.launch({ args: [entry, '--ui-check'], cwd: root, env, timeout: 30_000 })
  report.syntheticSecretStore = await application.evaluate(({safeStorage,app})=>{
    if(safeStorage.isEncryptionAvailable())return false
    if(!app.getPath('userData').includes('whywork-isolated-'))throw new Error('Refusing synthetic secret store outside isolated profile')
    safeStorage.isEncryptionAvailable=()=>true
    safeStorage.encryptString=value=>Buffer.from('ui-synthetic:'+value)
    safeStorage.decryptString=value=>Buffer.from(value).toString().replace(/^ui-synthetic:/,'')
    return true
  })
  const page = await application.firstWindow()
  // Playwright's default light emulation would mask nativeTheme change events.
  await page.emulateMedia({ colorScheme: null })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.locator('.ww-shell').waitFor()
  const workspace = await page.evaluate(() => window.whywork.sys('app.get_workspace'))
  assert(workspace.ok && /whywork-isolated-[^/\\]+[/\\]workspace$/.test(workspace.data.path), 'Expected isolated workspace')
  await page.evaluate(async baseUrl=>{
    const call=async(action,payload)=>{const r=await window.whywork.sys(action,payload);if(!r.ok)throw new Error(r.error.message);return r.data}
    await call('provider.save',{id:'openai-compat:ui-fixture',kind:'openai-compat',name:'合成模型',baseUrl,apiKey:'synthetic-only',models:{fast:['synthetic-model'],expert:[]}})
    await call('notes.create',{title:'截图来源',body:'合成来源正文'})
    const selection={providerId:'openai-compat:ui-fixture',model:'synthetic-model'}
    const {chatId}=await call('chat.create',{title:'合成界面验收',selection})
    await call('chat.send',{chatId,text:'仅用于界面验收',selection})
  }, `http://127.0.0.1:${fixtureServer.address().port}`)
  await page.waitForFunction(async()=>{
    const chats=await window.whywork.sys('chat.list')
    const id=chats.data?.items?.find(c=>c.title==='合成界面验收')?.chatId
    if(!id)return false
    const result=await window.whywork.sys('chat.messages',{chatId:id})
    return result.data?.messages?.some(m=>m.role==='assistant'&&m.reasoning)
  })
  await page.locator('.ww-sidebar-footer').getByRole('button',{name:'设置'}).click()
  await page.locator('.ww-sidebar button').filter({hasText:'合成界面验收'}).click()
  await page.locator('.ww-markdown table').waitFor()
  assert.equal(await page.locator('.ww-markdown .katex').count(),1)
  assert(await page.locator('.ww-markdown .hljs-keyword').count()>0)
  assert.equal(await page.locator('.ww-markdown [data-target="截图来源"]').count(),1)
  const rail = page.getByRole('navigation', { name: '工具竖栏' })
  const views = [
    ['chat', () => rail.getByRole('button', { name: 'AI 问答', exact: true }).click(), '.ww-chat-pane'],
    ['notes', () => page.locator('.ww-sidebar button').filter({ hasText: /^全部笔记$/ }).click(), '.ww-resource-pane'],
    ['settings', () => page.locator('.ww-sidebar-footer').getByRole('button', { name: '设置' }).click(), '.ww-provider-settings'],
    ['record', () => rail.getByRole('button', { name: '录音', exact: true }).click(), '.ww-recording'],
    ...[['capture', '采集'], ['office', '表格与文档'], ['calendar', '日历'], ['mail', '邮件'], ['browser', '网页浏览'], ['pair', '设备绑定']]
      .map(([id, label]) => [id, () => rail.getByRole('button', { name: label, exact: true }).click(), '.ww-tool-page'])
  ]
  for (const theme of ['light', 'dark']) {
    await application.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value }, theme)
    await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark && matchMedia('(prefers-color-scheme: dark)').matches === dark, theme === 'dark')
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return Object.fromEntries(['--ww-bg', '--ww-card', '--ww-text', '--ww-primary'].map(key => {
        const value = style.getPropertyValue(key).trim()
        // Production CSS may shorten #ffffff to #fff without changing its color.
        return [key, /^#[\da-f]{3}$/i.test(value) ? '#' + [...value.slice(1)].map(c => c + c).join('') : value]
      }))
    })
    assert.deepEqual(tokens, theme === 'dark'
      ? { '--ww-bg': '#15171c', '--ww-card': '#20232b', '--ww-text': '#e8eaf2', '--ww-primary': '#7b8aff' }
      : { '--ww-bg': '#f3f4f6', '--ww-card': '#ffffff', '--ww-text': '#15141a', '--ww-primary': '#5768ff' })
    for (const [view, navigate, ready] of views) {
      await navigate()
      await page.locator(ready).first().waitFor()
      // Allow lazy views, fonts and Ant Design transitions to settle before capture.
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(350)
      // U-03：页面文本不得出现内部追踪注释或 front matter 残留
      const bodyText = await page.evaluate(() => document.body.innerText)
      assert(!bodyText.includes('source-path') && !bodyText.includes('<!--'), '页面泄露内部注释')
      if (view === 'office') {
        const cardBackground = await page.locator('.ww-tool-page .ant-card').first()
          .evaluate(card => getComputedStyle(card).backgroundColor)
        assert.equal(cardBackground, theme === 'dark' ? 'rgb(32, 35, 43)' : 'rgb(255, 255, 255)', 'Ant Design theme did not update')
      }
      const file = `${theme}-${view}.png`
      const captured = await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const shot = await window.webContents.capturePage()
        if (shot.isEmpty()) throw new Error('Empty capture')
        return { size: shot.getSize(), png: shot.toPNG().toString('base64') }
      })
      const { size } = captured
      fs.writeFileSync(path.join(output, file), Buffer.from(captured.png, 'base64'))
      assert(size.width > 0 && size.height > 0)
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')
      if (theme === 'dark') assert.notEqual(sha256, report.captures.find(c => c.view === view).sha256, 'Themes produced identical screenshots')
      report.captures.push({ theme, view, file, size, tokens, sha256 })
      console.log(`[UI-CAPTURE] ${theme}/${view}`)
    }
  }
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark') && !matchMedia('(prefers-color-scheme: dark)').matches)
  report.themeRoundTrip = 'light → dark → light'
  assert.equal(report.errors.length, 0, 'Renderer errors occurred')
  report.status = 'PASS'
}
run().catch(error => {
  console.error(error.message)
  report.status = 'FAIL'
  report.errors.push(error.message)
  process.exitCode = 1
}).finally(async () => {
  try { if (application) await application.close() }
  catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1 }
  if(fixtureServer){fixtureServer.closeAllConnections();await new Promise(resolve=>fixtureServer.close(resolve))}
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  clearTimeout(watchdog)
  console.log(`[UI-CAPTURE] ${report.status}: ${path.join(output, 'report.json')}`)
})
