import {summarize,cancelSummary,startSummaryBatch,cancelSummaryBatch,relatedNotes} from '../services/summaries'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { register, invokeSys } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
import {backgroundText} from '../providers/background'
import {resolveWorkspacePath} from '../security/paths'

/** llm 域（单次调用/决策）+ chart 域（Vega-Lite→SVG）+ notes.summarize（DEVELOPMENT.md §6.4/§6.5） */

async function oneShot(_legacyRole: 'fast' | 'expert', system: string, user: string, timeoutMs = 60_000): Promise<string> {
  return backgroundText(system,user,AbortSignal.timeout(timeoutMs))
}

export function registerLlmDomain(): void {
  register('llm', {
    summarize_cancel:{schema:z.object({noteId:z.string().min(1)}),handler:async(p:{noteId:string})=>{cancelSummary(p.noteId);return {ok:true}}},
    summarize_batch_start:{schema:z.object({filter:z.object({collectionId:z.string().optional(),favorite:z.boolean().optional(),pinned:z.boolean().optional(),later:z.boolean().optional(),sources:z.array(z.string()).max(30).optional(),modifiedFrom:z.number().optional(),modifiedTo:z.number().optional()}).optional(),query:z.string().max(200).optional(),searchMode:z.enum(['fts','text']).optional()}),handler:async(p:{filter?:import('../db/repos/notes').ListFilter;query?:string;searchMode?:'fts'|'text'},ctx)=>startSummaryBatch(p.filter??{},ctx,p)},
    summarize_batch_cancel:{schema:z.object({batchId:z.string()}),handler:async(p:{batchId:string})=>{cancelSummaryBatch(p.batchId);return {ok:true}}},
    summarize: {schema:z.object({noteId:z.string().min(1)}),handler:async(p,ctx)=>{const r=await invokeSys('notes.summarize',p,ctx);if(!r.ok)throw new Error(r.error.message);return r.data}},
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
    related:{schema:z.object({noteId:z.string().min(1),limit:z.number().int().min(1).max(10).default(5)}),handler:async(p:{noteId:string;limit:number})=>relatedNotes(p.noteId,p.limit)},
    summarize:{schema:z.object({noteId:z.string().min(1)}),handler:async(p:{noteId:string},ctx)=>summarize(p.noteId,ctx,ctx.signal)}
  })
}
