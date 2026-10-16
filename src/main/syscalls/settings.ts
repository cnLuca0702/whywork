import fs from 'node:fs'
import path from 'node:path'
import {resolveWorkspacePath} from '../security/paths'
import { encryptSecret, decryptSecret, isEncrypted, SECRET_MASK } from '../security/secrets'
import { z } from 'zod'
import { register } from './registry'
import { getDb } from '../db/client'

/** settings 域（DEVELOPMENT.md §6.9）：白名单键 */

const ALLOWED_KEYS = new Set([
  'profile.nickname','profile.role','profile.instructions','ai.responseLanguage','memory.mode',
  'mcp.directToolLimit',
  'ai.backgroundModel',
  'chat.autoTitle','shortcuts.focusChat','shortcuts.newNote',
  'search.mode',
  'search.braveKey',
  'search.tavilyKey',
  'ui.language',
  'agent.maxTurns',
  'agent.confirmDestructive',
  'media.asrBaseUrl',
  'media.asrKey',
  'media.asrModel','media.transcriptionLanguage','media.dictionary','media.ocrEnabled','media.downloaderPath'
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

function memoryFile(kind:'root'|'daily') {return resolveWorkspacePath('.whywork/memory/'+(kind==='root'?'MEMORY.md':`MEM-${new Date().toISOString().slice(0,10).replaceAll('-','')}.md`),true)}
export function registerSettingsDomain(): void {
  register('memory',{
    read:{schema:z.object({kind:z.enum(['root','daily'])}),handler:async(p:{kind:'root'|'daily'},ctx)=>{if(ctx.source==='agent')throw new Error('仅用户可编辑记忆');const file=memoryFile(p.kind);return {text:fs.existsSync(file)?fs.readFileSync(file,'utf8'):''}}},
    update:{schema:z.object({kind:z.enum(['root','daily']),text:z.string().max(100000),previous:z.string().max(100000)}),handler:async(p:{kind:'root'|'daily';text:string;previous:string},ctx)=>{
      if(ctx.source==='agent')throw new Error('仅用户可编辑记忆');const file=memoryFile(p.kind),old=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';if(old!==p.previous)throw new Error('记忆已变化，请重新打开后编辑');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,p.text);return {ok:true}
    }},
    clear:{schema:z.object({confirmed:z.literal(true)}),handler:async(_p,ctx)=>{if(ctx.source==='agent')throw new Error('仅用户可清空记忆');const file=memoryFile('root');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'');return {ok:true}}}
  })
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
        if(p.settings['ai.backgroundModel']){
          const {parseBackgroundModel}=await import('../providers/background')
          const {validateSelection}=await import('../providers/catalog')
          await validateSelection(parseBackgroundModel(p.settings['ai.backgroundModel']))
        }
        const mode=p.settings['search.mode']
        if(mode&&!['basic','smart','hq_first'].includes(mode))throw new Error('无效搜索模式')
        if(mode&&mode!=='basic'){
          const configured=['search.braveKey','search.tavilyKey'].some(k=>k in p.settings?!!p.settings[k]:!!getSetting(k))
          if(!configured)throw new Error('请先配置搜索密钥；当前保持普通搜索')
        }
        const stmt = getDb().prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        let undoShortcuts:(()=>void)|undefined
        if('shortcuts.focusChat' in p.settings||'shortcuts.newNote' in p.settings){
          const {configureShortcuts}=await import('../services/capture'),{shortcutDefaults}=await import('../services/shortcut-validation')
          undoShortcuts=configureShortcuts({focusChat:('shortcuts.focusChat' in p.settings?p.settings['shortcuts.focusChat']:getSetting('shortcuts.focusChat'))??shortcutDefaults.focusChat,newNote:('shortcuts.newNote' in p.settings?p.settings['shortcuts.newNote']:getSetting('shortcuts.newNote'))??shortcutDefaults.newNote})
        }
        try{getDb().transaction(() => {
        for (const [k, v] of Object.entries(p.settings)) {
          if(k==='mcp.directToolLimit'&&v&&(!/^\d+$/.test(v)||Number(v)<1||Number(v)>1000))throw new Error('MCP工具阈值应为1到1000')
          if(k==='media.dictionary'&&v&&v.length>10000)throw new Error('专有名词词典最多10000字')
          if(k==='media.transcriptionLanguage'&&v&&!['zh-CN','en-US','auto'].includes(v))throw new Error('无效转写语言')
          if(k==='profile.instructions'&&v&&v.length>2000)throw new Error('自定义指令最多2000字')
          if((k==='profile.nickname'||k==='profile.role')&&v&&v.length>200)throw new Error('称呼或角色最多200字')
          if(k==='memory.mode'&&v&&!['quality','economy','off'].includes(v))throw new Error('无效记忆模式')
          if(k==='ai.responseLanguage'&&v&&!['auto','简体中文','English','繁體中文','日本語'].includes(v))throw new Error('无效回复语言')
          if(k==='agent.confirmDestructive' && v!==null && v!=='true')throw new Error('危险操作确认不可关闭')
          if (!ALLOWED_KEYS.has(k)) throw new Error(`不支持的设置键: ${k}`)
          if (SECRET_KEYS.has(k) && v === SECRET_MASK) continue
          const value = v && SECRET_KEYS.has(k) ? encryptSecret(v) : v
          stmt.run(k, value === null ? null : JSON.stringify(value))
        }
        })()}catch(e){undoShortcuts?.();throw e}
        return { ok: true }
      }
    }
  })
}
