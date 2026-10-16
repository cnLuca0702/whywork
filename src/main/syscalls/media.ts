import {addMediaUrls,mediaJobs,cancelMediaJob,retryMediaJob} from '../services/media-jobs'
import {ocrStatus} from '../services/ocr-index'
import {generateMinutes,cancelMinutes,pendingTranscriptions,transcribeRecording} from '../services/recording-notes'
import crypto from 'node:crypto'
import {resolveWorkspacePath} from '../security/paths'
import { getSetting as setting } from './settings'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { register } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
import { createNote } from '../db/repos/notes'

/** media 域（MEDIA 用例）：ASR 转写（BYOG OpenAI 兼容 /audio/transcriptions）+ OCR（tesseract.js）
 *  MEDIA-08：模型/语言数据未就绪时给出明确“准备中/失败”状态，不假报成功 */


function wsJoin(rel: string): string {
  return path.join(getWorkspacePath(), rel)
}

export async function transcribeAudio(absPath: string, language?: string, signal?:AbortSignal): Promise<{ text: string; model: string }> {
  const baseUrl = setting('media.asrBaseUrl') ?? 'https://api.openai.com/v1'
  const key = setting('media.asrKey')
  const model = setting('media.asrModel') ?? 'whisper-1'
  if (!key) {
    throw new Error('未配置转写模型：请到 设置 → 媒体 填写 ASR 服务的 Base URL 与 API Key（MEDIA-08）')
  }
  const buf = fs.readFileSync(absPath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), path.basename(absPath))
  form.append('model', model)
  if (language) form.append('language', language)
  const dictionary=setting('media.dictionary');if(dictionary)form.append('prompt',dictionary)
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: signal?AbortSignal.any([signal,AbortSignal.timeout(300_000)]):AbortSignal.timeout(300_000)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`转写失败 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const j = (await res.json()) as { text?: string }
  return { text: j.text ?? '', model }
}

export async function ocrImage(absPath: string, langs = 'chi_sim+eng'): Promise<{ text: string; engine: string }> {
  const { createWorker } = await import('tesseract.js')
  // 语言数据本地化（resources/tessdata/*.traineddata.gz），避免在线 CDN 下载失败
  const pathMod = await import('node:path')
  const fsMod = await import('node:fs')
  const candidates = [
    pathMod.join(process.cwd(), 'resources', 'tessdata'),
    pathMod.join(process.resourcesPath ?? process.cwd(), 'tessdata')
  ]
  const langPath = candidates.find((d) => fsMod.existsSync(pathMod.join(d, 'chi_sim.traineddata.gz'))) ?? candidates[0]!
  for(const lang of langs.split('+'))if(!/^[a-z_]+$/.test(lang)||!fsMod.existsSync(pathMod.join(langPath,lang+'.traineddata.gz')))throw new Error('本地OCR语言包未就绪：'+lang)
  const worker = await createWorker(langs, 1, { langPath, gzip: true, logger: () => undefined })
  try {
    const { data } = await worker.recognize(absPath)
    return { text: data.text ?? '', engine: `tesseract.js:${langs}` }
  } finally {
    await worker.terminate()
  }
}

export function registerMediaDomain(): void {
  register('media', {
    add_urls:{schema:z.object({urls:z.array(z.url()).min(1).max(10)}),handler:async(p:{urls:string[]},ctx)=>addMediaUrls(p.urls,ctx)},
    jobs:{handler:async()=>mediaJobs()},
    cancel_job:{schema:z.object({jobId:z.string()}),handler:async(p:{jobId:string},ctx)=>cancelMediaJob(p.jobId,ctx)},
    retry_job:{schema:z.object({jobId:z.string()}),handler:async(p:{jobId:string},ctx)=>retryMediaJob(p.jobId,ctx)},
    ocr_status:{schema:z.object({noteId:z.string()}),handler:async(p:{noteId:string})=>ocrStatus(p.noteId)},
    recording_info:{schema:z.object({noteId:z.string()}),handler:async(p:{noteId:string})=>({recording:getDb().prepare('SELECT note_id,path,transcript_note_id,minutes_note_id FROM saved_recordings WHERE note_id=? OR transcript_note_id=? OR minutes_note_id=?').get(p.noteId,p.noteId,p.noteId)??null})},
    pending_transcriptions:{handler:async()=>pendingTranscriptions()},
    generate_minutes:{schema:z.object({recordingNoteId:z.string().min(1),template:z.enum(['general','interview','lecture']).default('general')}),handler:async(p:{recordingNoteId:string;template:'general'|'interview'|'lecture'},ctx)=>generateMinutes(p.recordingNoteId,p.template,ctx)},
    cancel_minutes:{schema:z.object({recordingNoteId:z.string().min(1)}),handler:async(p:{recordingNoteId:string})=>{cancelMinutes(p.recordingNoteId);return {ok:true}}},
    recording_capabilities:{handler:async()=>({isolatedUI:process.argv.includes('--ui-check'),asrConfigured:!!setting('media.asrKey')})},
    save_recording:{schema:z.object({id:z.string().uuid(),mime:z.string().max(100),data:z.string().min(1).max(70*1024*1024),durationMs:z.number().int().min(0).max(4*3600*1000),mode:z.enum(['microphone','system','synthetic']),keyPoints:z.string().max(20000).default(''),language:z.enum(['zh-CN','en-US','auto']).default('auto'),segmentOf:z.uuid().optional(),segmentIndex:z.number().int().min(1).max(10000).optional()}),
      handler:async(p:{id:string;mime:string;data:string;durationMs:number;mode:string;keyPoints:string;language:string;segmentOf?:string;segmentIndex?:number},ctx)=>{
        if(ctx.source!=='user')throw new Error('录音保存必须由用户发起')
        if(p.mode==='synthetic'&&!process.argv.some(a=>['--ui-check','--feature-check'].includes(a)))throw new Error('合成音源仅用于隔离验收')
        if(p.durationMs<1000)throw new Error('录音过短，请至少录制1秒')
        const ext=p.mime.startsWith('audio/webm')?'webm':p.mime.startsWith('audio/mp4')?'m4a':null
        if(!ext||!(/^[A-Za-z0-9+/]+={0,2}$/).test(p.data))throw new Error('不支持的音频编码')
        const bytes=Buffer.from(p.data,'base64')
        if(!bytes.length||bytes.length>50*1024*1024)throw new Error('录音为空或超过50MB，请分段录制')
        if(ext==='webm'&&!bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))||ext==='m4a'&&bytes.toString('ascii',4,8)!=='ftyp')throw new Error('录音格式校验失败')
        const db=getDb(),hash=crypto.createHash('sha256').update(bytes).digest('hex')
        db.exec('CREATE TABLE IF NOT EXISTS saved_recordings(id TEXT PRIMARY KEY,note_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,duration_ms INTEGER NOT NULL)')
        const old=db.prepare('SELECT * FROM saved_recordings WHERE id=?').get(p.id) as {note_id:string;path:string;hash:string;key_points:string;language:string;segment_of:string|null;segment_index:number|null}|undefined
        if(old){if(old.key_points!==p.keyPoints||old.language!==p.language||old.segment_of!==(p.segmentOf??null)||old.segment_index!==(p.segmentIndex??null))throw new Error('保存标识重复但录音元数据不同');if(old.hash!==hash)throw new Error('保存标识重复但内容不同');if(!fs.existsSync(resolveWorkspacePath(old.path)))throw new Error('已保存的录音文件不存在');return{noteId:old.note_id,path:old.path}}
        const dir=resolveWorkspacePath('resources/recordings');fs.mkdirSync(dir,{recursive:true})
        const rel=`resources/recordings/${p.id}.${ext}`,abs=resolveWorkspacePath(rel)
        let createdNote:ReturnType<typeof createNote>|undefined,wrote=false
        try{
          fs.writeFileSync(abs,bytes,{flag:'wx'});wrote=true
          db.transaction(()=>{
            createdNote=createNote({title:`录音-${new Date().toLocaleString()}`,body:`[播放录音](whywork-res://${rel})\n\n时长：${(p.durationMs/1000).toFixed(1)} 秒\n音源：${p.mode==='synthetic'?'合成验证':p.mode==='system'?'系统音频':'麦克风'}\n\n音频已保存在本地，尚未转写。\n\n## 要点\n${p.keyPoints}\n\n${p.segmentIndex?`第 ${p.segmentIndex} 段（分段组：${p.segmentOf??p.id}）`:""}`,source:'audio'})
            db.prepare('INSERT INTO saved_recordings(id,note_id,path,hash,duration_ms) VALUES(?,?,?,?,?)').run(p.id,createdNote.note_id,rel,hash,p.durationMs)
            db.prepare('UPDATE saved_recordings SET key_points=?,language=?,segment_of=?,segment_index=? WHERE id=?').run(p.keyPoints,p.language,p.segmentOf??null,p.segmentIndex??null,p.id)
          })()
        }catch(e){if(wrote)fs.rmSync(abs,{force:true});if(createdNote)fs.rmSync(resolveWorkspacePath(createdNote.relative_path),{force:true});throw e}
        ctx.emit('notes.changed',{kind:'recording',noteIds:[createdNote!.note_id]});return{noteId:createdNote!.note_id,path:rel}
      }
    },
    transcribe: {
      schema: z.object({
        path: z.string().min(1),
        language: z.enum(['zh-CN', 'en-US', 'auto']).optional(),
        createNote: z.boolean().default(true)
      }),
      handler: async (p: { path: string; language?: 'zh-CN' | 'en-US' | 'auto'; createNote: boolean }, ctx) => {
        const abs = resolveWorkspacePath(p.path)
        if (!fs.existsSync(abs)) throw new Error('音频文件不存在')
        const recording=getDb().prepare('SELECT note_id FROM saved_recordings WHERE path=?').get(path.relative(getWorkspacePath(),abs)) as {note_id:string}|undefined
        if(recording&&p.createNote)return transcribeRecording(recording.note_id,p.language,ctx)
        const lang = p.language && p.language !== 'auto' ? p.language.split('-')[0] : undefined
        const r = await transcribeAudio(abs, lang)
        let noteId: string | null = null
        if (p.createNote) {
          const title = `转写-${path.basename(abs, path.extname(abs))}`
          const note = createNote({ title, body: `${r.text}\n\n---\n音频：${path.basename(abs)}（${r.model}）`, source: 'meeting_transcript' })
          noteId = note.note_id
          ctx.emit('notes.changed', { kind: 'transcribe', noteIds: [noteId] })
        }
        return { text: r.text, model: r.model, noteId }
      }
    },
    ocr: {
      schema: z.object({ path: z.string().min(1), langs: z.string().optional() }),
      handler: async (p: { path: string; langs?: string }, ctx) => {
        const abs = resolveWorkspacePath(p.path)
        if (!fs.existsSync(abs)) throw new Error('图片文件不存在')
        const r = await ocrImage(abs, p.langs ?? 'chi_sim+eng')
        const note = createNote({
          title: `OCR-${path.basename(abs, path.extname(abs))}`,
          body: `${r.text}\n\n---\n图片：${path.basename(abs)}（${r.engine}）`,
          source: 'image'
        })
        ctx.emit('notes.changed', { kind: 'ocr', noteIds: [note.note_id] })
        return { text: r.text, engine: r.engine, noteId: note.note_id }
      }
    }
  })
}
