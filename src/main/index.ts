import {registerSearchDomain} from './syscalls/search'
import { registerOfficeDomain } from './syscalls/office'
import { registerBrowserDomain } from './syscalls/browser'
import { registerMailDomain } from './syscalls/mail'
import { registerCalendarDomain } from './syscalls/calendar'
import { registerPairingDomain } from './syscalls/pairing'
import { closeBrowser } from './services/browser'
import { stopPairing } from './services/pairing'
import { queueCaptureUrl, flushCaptureUrls, registerCaptureShortcuts } from './services/capture'
import { app, BrowserWindow, protocol, net, shell } from 'electron'
import { setupAppMenu, popupEditContextMenu } from './menu'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { resourcePath } from './security/paths'
import { resetDb } from './db/client'
import { setWorkspacePath } from './syscalls/app'
import { pathToFileURL } from 'node:url'
import { wireIpc } from './ipc'
import { registerAppDomain, ensureWorkspace, getWorkspacePath, migrateFromMyRemio } from './syscalls/app'
import { registerNotesDomain } from './syscalls/notes'
import { registerFileDomain } from './syscalls/file'
import { registerVaultDomain } from './syscalls/vault'
import { registerWebDomain } from './syscalls/web'
import { registerLlmDomain } from './syscalls/llm'
import { registerChatDomain } from './syscalls/chat'
import { registerProviderDomain } from './syscalls/provider'
import { registerSettingsDomain } from './syscalls/settings'
import { registerMcpDomain, registerSkillsDomain } from './syscalls/mcp'
import { registerIflytekDomain } from './syscalls/iflytek'
import { closeWatchers, registerWatchDomain, restoreWatchers } from './syscalls/watch'
import { registerClipDomain } from './syscalls/clip'
import { registerExportDomain } from './syscalls/export'
import { registerMediaDomain } from './syscalls/media'
import { closeAll as closeMcp } from './mcp/manager'
import { abortChat } from './agent/loop'
import { registerMetaDomain } from './syscalls/registry'
import {recoveryRoot,runRecoveryPhase} from './recovery-check'

// Local resource responses are streamed; retain the existing CSP and path boundary.
protocol.registerSchemesAsPrivileged(['whywork-res','myremio-res'].map(scheme=>({scheme,privileges:{stream:true}})))

// 保持无菜单（纯本地应用，不需要英文默认菜单）；快捷键在渲染层处理
const recoveryWorker=process.argv.includes('--recovery-worker')
const testMode = recoveryWorker || process.argv.some(a => ['--smoke-test', '--run-cases', '--core-check', '--extended-check', '--browser-check', '--ui-check', '--feature-check', '--model-check'].includes(a))
const uiCheck = process.argv.includes('--ui-check')
const testRoot = recoveryWorker ? recoveryRoot() : testMode ? fs.mkdtempSync(path.join(os.tmpdir(), 'whywork-isolated-')) : null
if (testRoot) {
  app.setPath('userData', path.join(testRoot, 'profile'))
  app.setPath('sessionData', path.join(testRoot, 'session'))
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.mkdirSync(app.getPath('sessionData'), { recursive: true })
  setWorkspacePath(path.join(testRoot, 'workspace'))
}
setupAppMenu() // ⚠ 不能置空：macOS 系统复制粘贴快捷键由菜单角色承载（含右键菜单依赖）

// 进程级兜底：worker/原生库的未捕获异常只记日志，不弹系统错误框（--run-cases 自动化依赖）
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); if(testMode)app.exit(1) })
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); if(testMode)app.exit(1) })

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: uiCheck ? 'WhyWork（隔离验证）' : 'WhyWork',
    show: false,
    autoHideMenuBar: true,
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request,callback)=>callback({}),{useSystemPicker:true})
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^(https?:|mailto:)/i.test(url))void shell.openExternal(url);return{action:'deny'}})
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    const current=mainWindow?.webContents.getURL()
    if(url===current)return
    if(process.env.ELECTRON_RENDERER_URL && new URL(url).origin===new URL(process.env.ELECTRON_RENDERER_URL).origin)return
    event.preventDefault();if(/^(https?:|mailto:)/i.test(url))void shell.openExternal(url)
  })
  mainWindow.webContents.on('context-menu', (_e, params) => popupEditContextMenu(params))
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-finish-load', () => {
    if(uiCheck)mainWindow?.setTitle('WhyWork（隔离验证）')
    flushCaptureUrls({win:()=>mainWindow,emit:(topic,payload)=>mainWindow?.webContents.send('sys:event',{topic,payload})})
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 开发模式由 electron-vite 注入 DEV_SERVER_URL；生产加载打包产物
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.on('open-url', (event, url) => {event.preventDefault();queueCaptureUrl(url);if(mainWindow)flushCaptureUrls({win:()=>mainWindow,emit:(topic,payload)=>mainWindow?.webContents.send('sys:event',{topic,payload})})})
for(const arg of process.argv)queueCaptureUrl(arg)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    for(const arg of argv)queueCaptureUrl(arg)
    if(mainWindow)flushCaptureUrls({win:()=>mainWindow,emit:(topic,payload)=>mainWindow?.webContents.send('sys:event',{topic,payload})})
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
    // whywork-res://<工作区相对路径>：编辑器图片等资源（限工作区内，防越界）
    for (const scheme of ['whywork-res', 'myremio-res']) {
      protocol.handle(scheme, (request) => {
        try { const range=request.headers.get('range');return net.fetch(pathToFileURL(resourcePath(request.url)).toString(),range?{headers:{Range:range}}:undefined) }
        catch { return new Response('forbidden', { status: 403 }) }
      })
    }

    if (!testMode) migrateFromMyRemio()
    ensureWorkspace()
    // 注册所有 syscall 域（新增域在此追加）
    registerAppDomain()
    registerNotesDomain()
    registerSearchDomain()
    registerFileDomain()
    registerVaultDomain()
    registerWebDomain()
    registerLlmDomain()
    registerChatDomain()
    registerProviderDomain()
    registerSettingsDomain()
    registerMcpDomain()
    registerSkillsDomain()
    registerIflytekDomain()
    registerWatchDomain()
    registerClipDomain()
    registerExportDomain()
    registerMediaDomain()
    registerOfficeDomain(); registerBrowserDomain(); registerMailDomain(); registerCalendarDomain(); registerPairingDomain()
    registerMetaDomain()
    wireIpc(() => mainWindow)
    if(recoveryWorker&&testRoot){
      const result=await runRecoveryPhase(testRoot)
      if(result==='quit')app.quit()
      return
    }

    // 冒烟自检模式：electron out/main/index.js --smoke-test（DEVELOPMENT.md §12）
    if (process.argv.includes('--smoke-test')) {
      const { runSelftest } = await import('./selftest')
      const results = await runSelftest()
      console.log('[SMOKE-TEST-RESULT]', JSON.stringify(results))
      const failed = results.filter((r) => !r.ok)
      if (testRoot && !recoveryWorker) { resetDb(); fs.rmSync(testRoot, { recursive: true, force: true }) }
      app.exit(failed.length > 0 ? 1 : 0)
      return
    }

    // 交付包用例执行模式：electron out/main/index.js --run-cases（tests/report.json）
    if (process.argv.includes('--run-cases')) {
      const { runCases } = await import('./case-runner')
      const results = await runCases()
      const summary = { total: results.length, pass: 0, fail: 0, blocked: 0, na: 0, manual: 0 }
      for (const r of results) {
        if (r.status === 'PASS') summary.pass++
        else if (r.status === 'FAIL') summary.fail++
        else if (r.status === 'BLOCKED') summary.blocked++
        else if (r.status === 'N/A') summary.na++
        else summary.manual++
      }
      const reportPath = path.join(process.cwd(), 'tests/report.json')
      fs.mkdirSync(path.dirname(reportPath), { recursive: true })
      fs.writeFileSync(reportPath, JSON.stringify({ product: 'WhyWork', date: new Date().toISOString(), summary, results }, null, 2))
      console.log('[CASE-RUN-SUMMARY]', JSON.stringify(summary))
      console.log('[CASE-RUN-REPORT]', reportPath)
      for (const r of results) {
        if (r.status !== 'PASS') console.log(`[${r.status}] ${r.id} ${r.title} — ${r.detail.slice(0, 100)}`)
      }
      if (testRoot) { resetDb(); fs.rmSync(testRoot, { recursive: true, force: true }) }
      app.exit(summary.fail > 0 ? 1 : 0)
      return
    }

    if (process.argv.includes('--browser-check')) {
      const { runBrowserCheck } = await import('./browser-check');await runBrowserCheck()
      if(testRoot){resetDb();fs.rmSync(testRoot,{recursive:true,force:true})}
      app.exit(0);return
    }
    if (process.argv.includes('--extended-check')) {
      const { runExtendedChecks } = await import('./extended-check')
      await runExtendedChecks()
      if (testRoot) { resetDb(); fs.rmSync(testRoot,{recursive:true,force:true}) }
      app.exit(0);return
    }
    if(process.argv.includes('--model-check')){
      const {runModelChecks}=await import('./model-check');await runModelChecks()
      if(testRoot){resetDb();fs.rmSync(testRoot,{recursive:true,force:true})}
      app.exit(0);return
    }
    if(uiCheck&&process.argv.includes('--model-ui-fixture')){
      const {setupModelFixture}=await import('./model-check');await setupModelFixture()
    }
    if(process.argv.includes('--feature-check')){
      const {runFeatureChecks}=await import('./feature-check');await runFeatureChecks()
      console.log('[FEATURE-CHECK] PASS')
      if(testRoot){resetDb();fs.rmSync(testRoot,{recursive:true,force:true})}
      app.exit(0);return
    }
    if (process.argv.includes('--core-check')) {
      const { runCoreChecks } = await import('./core-check')
      await runCoreChecks()
      console.log('[CORE-CHECK] PASS')
      if (testRoot) { resetDb(); fs.rmSync(testRoot, { recursive: true, force: true }) }
      app.exit(0)
      return
    }
    createWindow()
    if(!testMode) restoreWatchers({emit:(topic,payload)=>mainWindow?.webContents.send('sys:event',{topic,payload})})
    if(!testMode) registerCaptureShortcuts({win:()=>mainWindow,emit:(topic,payload)=>mainWindow?.webContents.send('sys:event',{topic,payload})},()=>{if(!mainWindow)createWindow();mainWindow?.show();mainWindow?.focus()})

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    } catch (e) {
      console.error('[STARTUP-FAILED]', e instanceof Error ? (testMode ? e.stack : e.message) : String(e))
      if (testRoot) { resetDb(); fs.rmSync(testRoot, { recursive: true, force: true }) }
      app.exit(1)
    } finally {
      if (testRoot && !uiCheck && !recoveryWorker) { resetDb(); fs.rmSync(testRoot, { recursive: true, force: true }) }
    }
  })

  app.on('will-quit',()=>{if(testRoot&&!recoveryWorker){resetDb();fs.rmSync(testRoot,{recursive:true,force:true})}})
  app.on('window-all-closed', () => {
    if(testMode)return // Isolated checks own app lifetime; PDF helper windows are transient.
    void closeBrowser(); void stopPairing()
    closeWatchers()
    closeMcp()
    if (process.platform !== 'darwin') app.quit()
  })
}
