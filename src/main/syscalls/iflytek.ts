import path from 'node:path'
import { z } from 'zod'
import { register } from './registry'
import { getWorkspacePath } from './app'
import * as iflytek from '../services/iflytek'

/** iflytek 域（DEVELOPMENT.md §6.13 占位 → 实装）：登录/设备/推送/云笔记导入 */

function wsJoin(rel: string): string {
  return path.join(getWorkspacePath(), rel)
}

export function registerIflytekDomain(): void {
  register('iflytek', {
    status: {
      handler: async () => {
        const { loadToken } = await import('../services/iflytek')
        return { loggedIn: !!loadToken() }
      }
    },
    login: {
      schema: z.object({ mobile: z.string().regex(/^\d{11}$/), password: z.string().min(1) }),
      handler: async (p: { mobile: string; password: string }) => {
        const r = await iflytek.loginByPassword(p.mobile, p.password)
        // 不回传 token
        return { ok: true, userId: r.userId, userName: r.userName ?? '', mobile: r.mobile ?? '' }
      }
    },
    logout: {
      handler: async () => {
        iflytek.clearToken()
        return { ok: true }
      }
    },
    devices: {
      handler: async () => ({ devices: await iflytek.getBoundDevices() })
    },
    send_file: {
      schema: z.object({ path: z.string().min(1) }),
      handler: async (p: { path: string }) => {
        const abs = path.isAbsolute(p.path) ? p.path : wsJoin(p.path)
        const r = await iflytek.sendFileToDevice(abs)
        return { ok: true, result: r }
      }
    },
    notes: {
      schema: z.object({ pageIndex: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }),
      handler: async (p: { pageIndex: number; pageSize: number }) => {
        const r = await iflytek.getNotes('0', p.pageIndex, p.pageSize)
        return { notes: r.list ?? [], total: r.total ?? 0 }
      }
    },
    import_note: {
      schema: z.object({ noteId: z.string().min(1), title: z.string().optional() }),
      handler: async (p: { noteId: string; title?: string }, ctx) => {
        // 拉取云笔记详情，下载转写/文本附件为 markdown 笔记
        const detail = await iflytek.getNoteDetail(p.noteId)
        const { createNote } = await import('../db/repos/notes')
        let body = `# ${p.title ?? '讯飞笔记'}\n\n> 来源：科大讯飞智能办公本（noteId: ${p.noteId}）\n\n`
        // 常见字段兜底：转写文本/内容路径
        const texts: string[] = []
        const detailObj = detail as Record<string, unknown>
        for (const key of ['content', 'transcribeText', 'text', 'remark']) {
          const v = detailObj[key]
          if (typeof v === 'string' && v.trim()) texts.push(v)
        }
        // 附件/笔迹：列出可下载项
        const attachments = (detailObj.attachments ?? detailObj.files ?? []) as { fileName?: string; fileUrl?: string }[]
        if (Array.isArray(attachments)) {
          for (const a of attachments.slice(0, 20)) {
            if (a.fileUrl) {
              try {
                const url = await iflytek.getDownloadUrl(a.fileUrl)
                if (url && /\.(txt|md)$/i.test(url)) {
                  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
                  if (res.ok) texts.push(await res.text())
                }
              } catch {
                /* 单个附件失败不阻塞 */
              }
            } else if (a.fileName) {
              body += `- 附件：${a.fileName}\n`
            }
          }
        }
        body += texts.join('\n\n') || '（未能提取文本内容；可在讯飞 App 查看原笔迹）'
        const note = createNote({ title: p.title ?? `讯飞-${p.noteId.slice(0, 8)}`, body, source: 'meeting_transcript' })
        ctx.emit('notes.changed', { kind: 'import', noteIds: [note.note_id] })
        return { noteId: note.note_id, textParts: texts.length }
      }
    }
  })
}
