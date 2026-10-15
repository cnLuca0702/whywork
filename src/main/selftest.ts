import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { invokeSys } from './syscalls/registry'
import { setWorkspacePath, getWorkspacePath, ensureWorkspace } from './syscalls/app'
import { resetDb } from './db/client'
import type { SysContext } from './syscalls/registry'

/** M1 冒烟验收（DEVELOPMENT.md §11）：在临时工作区跑完整验收序列，输出报告
 *  入口：electron out/main/index.js --smoke-test */

export interface SmokeResult {
  name: string
  ok: boolean
  detail: string
}

const ctx: SysContext = { win: () => null, emit: () => undefined }

async function sys(action: string, payload?: unknown): Promise<any> {
  const r = await invokeSys(action, payload, ctx)
  if (!r.ok) throw new Error(`[${r.error.code}] ${r.error.message}`)
  return r.data
}

export async function runSelftest(): Promise<SmokeResult[]> {
  const results: SmokeResult[] = []
  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn()
      results.push({ name, ok: true, detail })
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  // 临时工作区
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'myremio-selftest-'))
  setWorkspacePath(tmpWs)
  ensureWorkspace()
  resetDb()

  const TOKEN = `SELFTESTTOKEN${Date.now()}`
  let noteA = ''
  let noteB = ''

  await check('notes.create', async () => {
    const r = await sys('notes.create', { title: `SELFTEST-甲-${TOKEN}`, body: `# 甲\n\n包含唯一令牌 ${TOKEN}，链接 [[SELFTEST-乙-${TOKEN}]]。\n` })
    if (!r.noteId) throw new Error('未返回 noteId')
    noteA = r.noteId
    const g = await sys('notes.get', { noteId: noteA })
    if (!String(g.body).includes(TOKEN)) throw new Error('正文未落盘')
    return `noteId=${r.noteId}`
  })

  await check('notes.create(链接目标)', async () => {
    const r = await sys('notes.create', { title: `SELFTEST-乙-${TOKEN}`, body: '乙的正文。\n' })
    noteB = r.noteId
    return `noteId=${r.noteId}`
  })

  await check('links 解析', async () => {
    const g = await sys('notes.get', { noteId: noteA })
    const out = g.links.out as { targetText: string; targetNoteId: string | null }[]
    const link = out.find((l) => l.targetText === `SELFTEST-乙-${TOKEN}`)
    if (!link) throw new Error(`出链未建立: ${JSON.stringify(out)}`)
    if (link.targetNoteId !== noteB) throw new Error(`目标未解析: ${link.targetNoteId} != ${noteB}`)
    const gb = await sys('notes.get', { noteId: noteB })
    const inc = gb.links.in as { sourceNoteId: string }[]
    if (!inc.some((l) => l.sourceNoteId === noteA)) throw new Error('入链缺失')
    return '出链+入链 OK'
  })

  await check('FTS 搜索', async () => {
    const r = await sys('notes.search', { query: TOKEN })
    if (!r.items.some((h: { noteId: string }) => h.noteId === noteA)) throw new Error(`未命中: ${JSON.stringify(r)}`)
    return `命中 ${r.items.length} 条`
  })

  await check('notes.list 筛选 favorite', async () => {
    await sys('notes.set_status', { noteId: noteA, favorite: true })
    const r = await sys('notes.list', { filter: { favorite: true } })
    if (!r.items.some((n: { noteId: string }) => n.noteId === noteA)) throw new Error('收藏筛选未命中')
    return `${r.items.length} 条收藏`
  })

  await check('集合 add/list', async () => {
    await sys('notes.collections_add_note', { noteId: noteA, collectionTitle: `SELFTEST-集合-${TOKEN}` })
    const g = await sys('notes.get', { noteId: noteA })
    if (!g.collections.some((c: { title: string }) => c.title === `SELFTEST-集合-${TOKEN}`)) throw new Error('未加入集合')
    const cols = await sys('notes.collections_list')
    if (!cols.items.some((c: { title: string }) => c.title === `SELFTEST-集合-${TOKEN}`)) throw new Error('集合未列出')
    return '集合 OK'
  })

  await check('notes.update 修改正文', async () => {
    await sys('notes.update', { noteId: noteA, body: `# 甲(改)\n\n令牌仍在 ${TOKEN}，另一链接 [[未解析目标]]。\n` })
    const g = await sys('notes.get', { noteId: noteA })
    if (!String(g.body).includes('甲(改)')) throw new Error('正文未更新')
    return '正文更新 OK'
  })

  await check('软删 + 恢复', async () => {
    await sys('notes.delete', { noteId: noteB })
    const del = await sys('notes.list', { filter: { deleted: true } })
    if (!del.items.some((n: { noteId: string }) => n.noteId === noteB)) throw new Error('未进回收站')
    const hidden = await sys('notes.list', { filter: {} })
    if (hidden.items.some((n: { noteId: string }) => n.noteId === noteB)) throw new Error('常规列表未隐藏')
    await sys('notes.restore', { noteId: noteB })
    const back = await sys('notes.get', { noteId: noteB })
    if (!back.note) throw new Error('恢复失败')
    if (!String(back.body).includes('乙的正文')) throw new Error('恢复后正文缺失')
    return '软删+恢复 OK'
  })

  await check('vault 变更记录', async () => {
    const r = await sys('vault.list')
    const n = (r.changes as unknown[]).length
    if (n < 3) throw new Error(`变更记录过少: ${n}`)
    return `${n} 条变更`
  })

  await check('file.write/read + BOW', async () => {
    await sys('file.write', { path: 'SELFTEST.md', content: 'v1' })
    await sys('file.write', { path: 'SELFTEST.md', content: 'v2' })
    const r = await sys('file.read', { path: 'SELFTEST.md' })
    if (r.content !== 'v2') throw new Error('读写不一致')
    const v = await sys('vault.list')
    const snap = (v.changes as { path: string; op: string }[]).find((c) => c.path === 'SELFTEST.md' && c.op === 'modify')
    if (!snap) throw new Error('BOW 未记录 modify')
    return 'file 域 OK'
  })

  await check('rebuild_index', async () => {
    const r = await sys('app.rebuild_index')
    if (r.scanned < 2) throw new Error(`扫描过少: ${JSON.stringify(r)}`)
    const s = await sys('notes.search', { query: TOKEN })
    if (s.items.length < 1) throw new Error('重建后搜索失败')
    return `scanned=${r.scanned} created=${r.created} updated=${r.updated} removed=${r.removed}`
  })

  await check('chat 会话与消息落库', async () => {
    const c = await sys('chat.create', {})
    const list = await sys('chat.list')
    if (!list.items.some((x: { chatId: string }) => x.chatId === c.chatId)) throw new Error('会话未列出')
    const meta = await sys('meta.actions')
    const actions = meta.actions as string[]
    for (const need of ['chat.send', 'notes.search', 'web.search', 'chart.generate', 'provider.save', 'llm.complete', 'vault.rollback']) {
      if (!actions.includes(need)) throw new Error(`缺少 syscall: ${need}`)
    }
    // A chat without an explicit available model must reject before persisting a message.
    const rejected=await invokeSys('chat.send',{chatId:c.chatId,text:`SELFTEST消息-${TOKEN}`,selection:{providerId:'missing',model:'missing'}},ctx)
    if(rejected.ok)throw new Error('未选择模型的会话不应发送')
    const m=await sys('chat.messages',{chatId:c.chatId})
    if(m.messages.length)throw new Error('拒绝的消息不应落库')
    await sys('chat.delete', { chatId: c.chatId })
    return 'chat 域 + syscall 注册 OK'
  })

  // 清理：硬删行 + 文件 + 恢复原工作区
  try {
    const { getDb } = await import('./db/client')
    getDb()
      .prepare(`DELETE FROM notes WHERE title LIKE ?`)
      .run(`SELFTEST-%`)
    getDb()
      .prepare(`DELETE FROM collections WHERE title LIKE ?`)
      .run(`SELFTEST-%`)
    resetDb()
    fs.rmSync(tmpWs, { recursive: true, force: true })
  } catch {
    // 尽力清理
  }
  void getWorkspacePath

  return results
}
