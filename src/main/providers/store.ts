import { createAnthropic } from './anthropic'
import { safeStorage } from 'electron'
import { getDb } from '../db/client'
import { createOpenAICompat, PRESET_PROVIDERS } from './openai-compat'
import type { ChatProvider } from './types'
import { ProviderError } from './types'
import { getChatGPTProvider } from './chatgpt'

/** providers 表 CRUD + safeStorage 加解密 + 工厂（DEVELOPMENT.md §8） */

export interface ProviderRow {
  id: string
  kind: 'openai-compat' | 'anthropic' | 'chatgpt'
  name: string
  base_url: string | null
  api_key_enc: Buffer | null
  models: string | null // JSON {fast:[],expert:[],defaultFast,defaultExpert}
  enabled: number
  extra: string | null
}

export interface ModelsConfig {
  fast: string[]
  expert: string[]
  defaultFast?: string
  defaultExpert?: string
}

export function listProviderRows(): ProviderRow[] {
  return getDb().prepare('SELECT * FROM providers ORDER BY rowid').all() as ProviderRow[]
}

function decodeKey(row: ProviderRow): string {
  if (!row.api_key_enc) return ''
  try {
    return safeStorage.decryptString(Buffer.from(row.api_key_enc))
  } catch {
    throw new ProviderError('PROVIDER_ERROR','供应商凭据无法解密，请重新保存 API Key')
  }
}

export function upsertProvider(input: {
  id: string
  kind: ProviderRow['kind']
  name: string
  baseUrl?: string
  apiKey?: string
  models?: ModelsConfig
  enabled?: boolean
}): ProviderRow {
  const db = getDb()
  if (input.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('系统密钥存储不可用，未保存凭据')
  const enc = input.apiKey ? safeStorage.encryptString(input.apiKey) : null
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(input.id) as ProviderRow | undefined
  if (existing) {
    db.prepare(
      `UPDATE providers SET kind=?, name=?, base_url=COALESCE(?, base_url),
       api_key_enc=COALESCE(?, api_key_enc), models=COALESCE(?, models), enabled=COALESCE(?, enabled) WHERE id=?`
    ).run(
      input.kind,
      input.name,
      input.baseUrl ?? null,
      enc,
      input.models ? JSON.stringify(input.models) : null,
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      input.id
    )
  } else {
    db.prepare(
      `INSERT INTO providers (id, kind, name, base_url, api_key_enc, models, enabled) VALUES (?,?,?,?,?,?,?)`
    ).run(
      input.id,
      input.kind,
      input.name,
      input.baseUrl ?? null,
      enc,
      input.models ? JSON.stringify(input.models) : null,
      input.enabled === false ? 0 : 1
    )
  }
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(input.id) as ProviderRow
}

export function deleteProvider(id: string): void {
  getDb().prepare('DELETE FROM providers WHERE id = ?').run(id)
}

export function getProvider(id: string): ChatProvider {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ? AND enabled = 1').get(id) as
    | ProviderRow
    | undefined
  if (!row) throw new ProviderError('NO_PROVIDER', `供应商不存在或未启用: ${id}`)
  if (row.kind === 'chatgpt') return getChatGPTProvider(row)
  const preset = PRESET_PROVIDERS.find((p) => p.id === row.id)
  return (row.kind === 'anthropic' ? createAnthropic : createOpenAICompat)({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url ?? preset?.baseUrl ?? '',
    apiKey: () => decodeKey(row),
    defaultModels: preset?.models
  })
}

/** 默认可用供应商（Fast/Expert 角色）：优先 settings，其次第一个启用的 */
export function resolveModel(role: 'fast' | 'expert'): { providerId: string; model: string } {
  const rows = listProviderRows().filter((r) => r.enabled)
  for (const r of rows) {
    const cfg = r.models ? (JSON.parse(r.models) as ModelsConfig) : undefined
    const model = role === 'fast' ? cfg?.defaultFast ?? cfg?.fast?.[0] : cfg?.defaultExpert ?? cfg?.expert?.[0]
    if (model) return { providerId: r.id, model }
  }
  // 未配置默认模型：列出第一个供应商的模型清单首个
  if (rows[0]) {
    const preset = PRESET_PROVIDERS.find((p) => p.id === rows[0]!.id)
    if (preset?.models[0]) return { providerId: rows[0]!.id, model: preset.models[0]! }
  }
  throw new ProviderError('NO_PROVIDER', '未配置任何模型供应商，请到 设置 → 模型供应商 添加')
}

export function maskRow(r: ProviderRow): Record<string, unknown> {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    baseUrl: r.base_url,
    hasKey: !!r.api_key_enc,
    models: r.models ? (JSON.parse(r.models) as ModelsConfig) : null,
    enabled: !!r.enabled
  }
}
