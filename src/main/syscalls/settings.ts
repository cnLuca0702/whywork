import { encryptSecret, decryptSecret, isEncrypted, SECRET_MASK } from '../security/secrets'
import { z } from 'zod'
import { register } from './registry'
import { getDb } from '../db/client'

/** settings 域（DEVELOPMENT.md §6.9）：白名单键 */

const ALLOWED_KEYS = new Set([
  'search.braveKey',
  'search.tavilyKey',
  'ui.language',
  'agent.maxTurns',
  'agent.confirmDestructive',
  'media.asrBaseUrl',
  'media.asrKey',
  'media.asrModel'
])

const SECRET_KEYS = new Set(['search.braveKey','search.tavilyKey','media.asrKey'])

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined
  if (!row?.value) return null
  const value = JSON.parse(row.value) as string | null
  if (!value || !SECRET_KEYS.has(key)) return value
  if (isEncrypted(value)) return decryptSecret(value)
  // Migrate only during the application's legitimate use of the configured key.
  getDb().prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(encryptSecret(value)), key)
  return value
}

export function registerSettingsDomain(): void {
  register('settings', {
    get: {
      schema: z.object({ keys: z.array(z.string()).optional() }),
      handler: async (p: { keys?: string[] }) => {
        const want = p.keys ?? [...ALLOWED_KEYS]
        const out: Record<string, string | null> = {}
        for (const k of want) {
          if (ALLOWED_KEYS.has(k)) {
            if (SECRET_KEYS.has(k)) {
              const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(k) as {value:string|null}|undefined
              out[k] = row?.value && JSON.parse(row.value) ? SECRET_MASK : null
            } else out[k] = getSetting(k)
          }
        }
        return { settings: out }
      }
    },
    set: {
      schema: z.object({ settings: z.record(z.string(), z.string().nullable()) }),
      handler: async (p: { settings: Record<string, string | null> }) => {
        const stmt = getDb().prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        getDb().transaction(() => {
        for (const [k, v] of Object.entries(p.settings)) {
          if(k==='agent.confirmDestructive' && v!==null && v!=='true')throw new Error('危险操作确认不可关闭')
          if (!ALLOWED_KEYS.has(k)) throw new Error(`不支持的设置键: ${k}`)
          if (SECRET_KEYS.has(k) && v === SECRET_MASK) continue
          const value = v && SECRET_KEYS.has(k) ? encryptSecret(v) : v
          stmt.run(k, value === null ? null : JSON.stringify(value))
        }
        })()
        return { ok: true }
      }
    }
  })
}
