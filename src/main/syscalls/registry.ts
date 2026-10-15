import type { BrowserWindow } from 'electron'
import { executionContext } from '../agent/context'
import type { SysResult } from '../../shared/types'

/** syscall 注册表：单一入口、zod 契约校验（docs/DEVELOPMENT.md §2.2/§6） */
export interface SysContext {
  chatId?: string
  source?: 'agent' | 'user'
  signal?: AbortSignal
  win: () => BrowserWindow | null
  /** 向渲染层广播 sys:event（如 notes.changed / chat.delta / vault.changed） */
  emit: (topic: string, payload: unknown) => void
}

export interface SysActionDef {
  /** payload 的 zod schema；undefined 表示无参 */
  schema?: import('zod').ZodType
  handler: (payload: never, ctx: SysContext) => Promise<unknown>
}

const actions = new Map<string, SysActionDef>()

/** 注册一个域的多个 action，action 名为 `域.动作` */
export function register(domain: string, defs: Record<string, SysActionDef>): void {
  for (const [name, def] of Object.entries(defs)) {
    const key = `${domain}.${name}`
    if (actions.has(key)) throw new Error(`syscall 重复注册: ${key}`)
    actions.set(key, def)
  }
}

export function listActions(): string[] {
  return [...actions.keys()].sort()
}

/** 内置 meta 域：列出全部已注册 action（调试/自省用） */
export function registerMetaDomain(): void {
  register('meta', {
    actions: { handler: async () => ({ actions: listActions() }) }
  })
}

export async function invokeSys(action: string, payload: unknown, ctx: SysContext): Promise<SysResult> {
  const def = actions.get(action)
  if (!def) {
    return { ok: false, error: { code: 'UNKNOWN_ACTION', message: `未知动作: ${action}` } }
  }
  try {
    const parsed = def.schema ? def.schema.parse(payload ?? {}) : undefined
    const effective = { ...executionContext.getStore(), ...ctx }
    const data = await executionContext.run(effective, () => def.handler(parsed as never, effective))
    return { ok: true, data }
  } catch (err) {
    if (err instanceof Error && err.name === 'ZodError') {
      return { ok: false, error: { code: 'BAD_PAYLOAD', message: `参数校验失败: ${err.message}` } }
    }
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') {
      return { ok: false, error: { code: 'NOT_FOUND', message } }
    }
    console.error(`[sys:${action}]`, err)
    return { ok: false, error: { code: 'INTERNAL', message } }
  }
}
