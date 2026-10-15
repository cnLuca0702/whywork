import { z } from 'zod'
import { register } from './registry'
import { getDb } from '../db/client'

/** clip 域：网页剪藏（PRIV-03/04：黑名单先于采集；只抓单页正文，不加载外链资源） */

function blacklist(): string[] {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('web.blacklist') as { value: string | null } | undefined
  if (!row?.value) return []
  try {
    return JSON.parse(row.value) as string[]
  } catch {
    return []
  }
}

export function isBlacklisted(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return blacklist().some((b) => {
    const item = b.trim().toLowerCase()
    if (!item) return false
    if (item.includes('/') || item.includes(':')) return url.toLowerCase().includes(item)
    return host === item || host.endsWith(`.${item}`) || host.includes(item)
  })
}

export function registerClipDomain(): void {
  register('clip', {
    save_url: {
      schema: z.object({ url: z.string().url() }),
      handler: async (p: { url: string }, ctx) => {
        // 黑名单先于任何采集动作（PRIV-03）
        if (isBlacklisted(p.url)) {
          return { blocked: true, reason: '命中黑名单' }
        }
        const { invokeSys } = await import('./registry')
        const r = await invokeSys('web.get', { url: p.url }, { win: () => null, emit: () => undefined })
        if (!r.ok) throw new Error(r.error.message)
        const page = r.data as { title: string; markdown: string; siteName: string }
        const { createNote } = await import('../db/repos/notes')
        const note = createNote({
          title: page.title || p.url,
          body: `${page.markdown}\n\n---\n来源：${p.url}`,
          source: 'page'
        })
        ctx.emit('notes.changed', { kind: 'clip', noteIds: [note.note_id] })
        return { blocked: false, noteId: note.note_id }
      }
    },
    blacklist_get: {
      handler: async () => ({ items: blacklist() })
    },
    blacklist_set: {
      schema: z.object({ items: z.array(z.string()) }),
      handler: async (p: { items: string[] }) => {
        getDb()
          .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run('web.blacklist', JSON.stringify(p.items))
        return { ok: true }
      }
    }
  })
}
