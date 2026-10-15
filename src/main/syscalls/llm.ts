import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { register } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
import { resolveModel, getProvider } from '../providers/store'

/** llm 域（单次调用/决策）+ chart 域（Vega-Lite→SVG）+ notes.summarize（DEVELOPMENT.md §6.4/§6.5） */

async function oneShot(role: 'fast' | 'expert', system: string, user: string, timeoutMs = 60_000): Promise<string> {
  const { providerId, model } = resolveModel(role)
  const provider = getProvider(providerId)
  let out = ''
  const result = await provider.stream(
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], signal: AbortSignal.timeout(timeoutMs) },
    (e) => {
      if (e.type === 'text') out += e.delta
    }
  )
  if (result.finishReason === 'length') throw new Error('模型输出被截断，请缩短输入或调整模型')
  return out
}

export function registerLlmDomain(): void {
  register('llm', {
    complete: {
      schema: z.object({
        prompt: z.string().optional(),
        messages: z.array(z.object({ role: z.enum(['system', 'user']), content: z.string() })).optional(),
        modelRole: z.enum(['fast', 'expert']).default('fast')
      }),
      handler: async (p: { prompt?: string; messages?: { role: 'system' | 'user'; content: string }[]; modelRole: 'fast' | 'expert' }) => {
        if (p.messages && p.messages.length > 0) {
          const sys = p.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
          const user = p.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
          return { text: await oneShot(p.modelRole, sys || '你是助手', user) }
        }
        if (!p.prompt) throw new Error('需要 prompt 或 messages')
        return { text: await oneShot(p.modelRole, '你是 WhyWork 的助手，回答简洁准确。', p.prompt) }
      }
    },
    decide: {
      schema: z.object({ question: z.string().min(1) }),
      handler: async (p: { question: string }) => {
        const out = await oneShot(
          'fast',
          '判断问题并只输出 JSON：{"yes": true/false, "confidence": 0-1}。不要输出其他内容。',
          p.question,
          20_000
        )
        const m = /\{[\s\S]*\}/.exec(out)
        if (!m) return { yes: false, confidence: 0 }
        const parsed = JSON.parse(m[0]) as { yes?: boolean; confidence?: number }
        return { yes: !!parsed.yes, confidence: parsed.confidence ?? 0.5 }
      }
    }
  })

  register('chart', {
    generate: {
      schema: z.object({ spec: z.record(z.string(), z.unknown()) }),
      handler: async (p: { spec: Record<string, unknown> }) => {
        const vegaLite = await import('vega-lite')
        const vega = await import('vega')
        const compiled = vegaLite.compile(p.spec as never).spec
        const view = new vega.View(vega.parse(compiled), { renderer: 'none' })
        const svg = await view.toSVG()
        const rel = path.join('.whywork', 'tmp', `chart-${crypto.randomUUID().slice(0, 8)}.svg`)
        const abs = path.join(getWorkspacePath(), rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, svg)
        return { path: rel, url: `whywork-res://${rel}`, svgLength: svg.length }
      }
    }
  })

  register('notes', {
    summarize: {
      schema: z.object({ noteId: z.string().min(1) }),
      handler: async (p: { noteId: string }, ctx) => {
        const row = getDb().prepare('SELECT title, relative_path FROM notes WHERE note_id = ?').get(p.noteId) as
          | { title: string; relative_path: string }
          | undefined
        if (!row) throw new Error(`笔记不存在: ${p.noteId}`)
        const body = fs.readFileSync(path.join(getWorkspacePath(), row.relative_path), 'utf-8').slice(0, 12_000)
        const out = await oneShot(
          'fast',
          '为笔记生成摘要。只输出 JSON：{"summary":"120字内摘要","keywords":["关键词"],"topic":"主题"}',
          `# ${row.title}\n\n${body}`,
          90_000
        )
        const m = /\{[\s\S]*\}/.exec(out)
        if (!m) throw new Error('模型输出无法解析')
        const parsed = JSON.parse(m[0]) as { summary?: string; keywords?: string[]; topic?: string }
        getDb()
          .prepare('UPDATE notes SET summary=?, keywords=?, topic=?, processed=1, accessed_at=? WHERE note_id=?')
          .run(parsed.summary ?? '', JSON.stringify(parsed.keywords ?? []), parsed.topic ?? '', Date.now(), p.noteId)
        // 更新 FTS（summary/keywords 变化）
        const { upsertFts } = await import('../db/repos/notes')
        upsertFts(p.noteId)
        ctx.emit('notes.changed', { kind: 'summarize', noteId: p.noteId })
        return { summary: parsed.summary ?? '', keywords: parsed.keywords ?? [], topic: parsed.topic ?? '' }
      }
    }
  })
}
