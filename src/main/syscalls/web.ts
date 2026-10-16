import {routeSearch,type SearchMode} from '../services/search-routing'
import { getSetting } from './settings'
import { z } from 'zod'
import { register } from './registry'
import { getDb } from '../db/client'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

/** web 域：搜索（Brave/Tavily BYOK + DuckDuckGo 兜底）与网页转 markdown（DEVELOPMENT.md §6.3） */

interface SearchItem {
  title: string
  url: string
  snippet: string
}


async function braveSearch(query: string, count: number, key: string): Promise<SearchItem[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`)
  const j = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } }
  return (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }))
}

async function tavilySearch(query: string, count: number, key: string): Promise<SearchItem[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: count }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
  const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] }
  return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) ?? '' }))
}

/** DuckDuckGo HTML 免费兜底（无 key、轻量解析） */
async function ddgSearch(query: string, count: number): Promise<SearchItem[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WhyWork/0.1' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
  const html = await res.text()
  const items: SearchItem[] = []
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decodeURIComponent((m[1] ?? '').replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0] ?? '')
    const title = (m[2] ?? '').replace(/<[^>]+>/g, '').trim()
    if (url.startsWith('http') && title) items.push({ title, url, snippet: '' })
    if (items.length >= count) break
  }
  return items
}

export function registerWebDomain(): void {
  register('web', {
    get_media:{schema:z.object({url:z.url()}),handler:async(p:{url:string},ctx)=>{const {addMediaUrls}=await import('../services/media-jobs');return addMediaUrls([p.url],ctx)}},
    verify_key:{schema:z.object({engine:z.enum(['brave','tavily'])}),handler:async(p:{engine:'brave'|'tavily'},ctx)=>{
      if(ctx.source==='agent')throw new Error('验证密钥仅由用户触发')
      const key=getSetting(`search.${p.engine}Key`);if(!key)throw new Error('请先保存密钥')
      await (p.engine==='brave'?braveSearch:tavilySearch)('connection test',1,key);return {connected:true}
    }},
    search: {
      schema: z.object({
        query: z.string().min(1),
        count: z.number().int().min(1).max(20).default(5),
        freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional()
      }),
      handler: async (p: { query: string; count: number; freshness?: 'pd' | 'pw' | 'pm' | 'py' }) => {
        const brave=getSetting('search.braveKey'),tavily=getSetting('search.tavilyKey')
        return routeSearch((getSetting('search.mode')??'basic') as SearchMode,[
          {name:'duckduckgo',run:()=>ddgSearch(p.query,p.count)},
          ...(brave?[{name:'brave',run:()=>braveSearch(p.query,p.count,brave)}]:[]),
          ...(tavily?[{name:'tavily',run:()=>tavilySearch(p.query,p.count,tavily)}]:[])
        ],p.count)
      }
    },

    get: {
      schema: z.object({ url: z.string().url(), timeout: z.number().optional() }),
      handler: async (p: { url: string; timeout?: number }) => {
        const res = await fetch(p.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 WhyWork/0.1',
            Accept: 'text/html,application/xhtml+xml'
          },
          signal: AbortSignal.timeout(p.timeout ?? 20_000),
          redirect: 'follow'
        })
        if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
        const html = await res.text()
        const dom = parseHTML(html)
        const doc = dom.document ?? dom
        const readable = new Readability(doc as never)
        const article = readable.parse()
        const title = article?.title ?? p.url
        const contentHtml = article?.content ?? html
        const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
        const markdown = td.turndown(contentHtml).slice(0, 100_000)
        return { title, markdown, siteName: article?.siteName ?? new URL(p.url).hostname }
      }
    }
  })
}
