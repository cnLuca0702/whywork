import { z } from 'zod'
import { register } from './registry'
import { listChanges, rollbackChange, rollbackChat } from '../agent/vault'

/** vault 域：变更列表与回滚（DEVELOPMENT.md §6.10；面板 UI 于 M3） */
export function registerVaultDomain(): void {
  register('vault', {
    list: {
      schema: z.object({ chatId: z.string().optional() }),
      handler: async (p: { chatId?: string }) => ({ changes: listChanges(p.chatId) })
    },
    rollback: {
      schema: z.object({ changeId: z.string().optional(), chatId: z.string().optional(), all: z.boolean().optional() }),
      handler: async (p: { changeId?: string; chatId?: string; all?: boolean }, ctx) => {
        let n = 0
        if (p.changeId) {
          if (!rollbackChange(p.changeId)) throw new Error('变更不存在或已回滚')
          n = 1
        } else if (p.chatId) {
          n = rollbackChat(p.chatId)
        }
        ctx.emit('vault.changed', { rolledBack: n })
        ctx.emit('notes.changed', { kind: 'vault-rollback' })
        return { rolledBack: n }
      }
    }
  })
}
