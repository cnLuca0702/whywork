import {useEffect,useRef,useState} from 'react'
import {Button,Tag,Spin,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {useUiStore} from '../store/ui'
import {t} from '../i18n/zh'

const OCR_PENDING=['queued','pending','running']

/** 摘要与相关笔记：位于正文之后，默认折叠（U-23）；OCR 全部完成后停止轮询 */
export default function NoteInsights({noteId}:{noteId:string}){
 const [ocr,setOcr]=useState<{state:string;done:number;total:number;error?:string}[]>([])
 const pendingRef=useRef(true)
 useEffect(()=>{
  let alive=true
  const refresh=()=>void sys<{items:typeof ocr}>('media.ocr_status',{noteId}).then(r=>{
   if(!alive)return
   setOcr(r.items)
   pendingRef.current=r.items.some(i=>OCR_PENDING.includes(i.state))
  }).catch(()=>undefined)
  refresh()
  const timer=setInterval(()=>{if(!pendingRef.current)clearInterval(timer);else refresh()},2000)
  return()=>{alive=false;clearInterval(timer)}
 },[noteId])
 const [data,setData]=useState<{note:{summary:string};keywords:string|null;topic:string|null}>(),[related,setRelated]=useState<{noteId:string;title:string}[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[version,setVersion]=useState(0)
 useSysEvent('notes.changed',p=>{if((p as {noteId?:string}).noteId===noteId)setVersion(v=>v+1)})
 useEffect(()=>{let alive=true;setLoading(true);setData(undefined);setRelated([])
  void sys<typeof data>('notes.get',{noteId}).then(d=>{if(alive)setData(d)}).catch(e=>message.error(String(e)))
  void sys<{items:typeof related}>('notes.related',{noteId}).then(r=>{if(alive)setRelated(r.items)}).catch(e=>message.error(String(e))).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[noteId,version])
 let keywords:string[]=[];try{keywords=JSON.parse(data?.keywords??'[]')}catch{/* older metadata */}
 return <section className="mt-8 border-t border-[var(--ww-border)] pt-3">
  {ocr.map((item,i)=><p key={i}>{t('media.ocrStatus')}：{t(({queued:'media.waiting',pending:'media.waiting',running:'media.ocrRunning',done:'media.done',error:'media.failed'} as const)[item.state]??'media.failed')} {item.done}/{item.total} {item.error}</p>)}
  {data?.note.summary&&<p>{data.note.summary}</p>}
  {Array.isArray(keywords)&&keywords.map(word=><Tag key={word}>{word}</Tag>)}{data?.topic&&<Tag>{data.topic}</Tag>}
  <Button size="small" loading={busy} onClick={async()=>{setBusy(true);try{await sys('llm.summarize',{noteId});setVersion(v=>v+1)}catch(e){message.error(String(e))}finally{setBusy(false)}}}>{t(data?.note.summary?'notes.resummarize':'notes.summarize')}</Button>
  {busy&&<Button size="small" onClick={()=>void sys('llm.summarize_cancel',{noteId}).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}
  <details className="mt-2"><summary>{t('notes.related')} · {t('notes.keywordMatch')}</summary>
   {loading?<span><Spin size="small"/> {t('notes.relatedLoading')}</span>:related.length?related.map(note=><Button key={note.noteId} type="link" onClick={()=>useUiStore.getState().setActiveNote(note.noteId)}>{note.title}</Button>):<p>{t('notes.noRelated')}</p>}
  </details>
 </section>
}
