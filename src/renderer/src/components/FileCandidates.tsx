import {useEffect,useRef,useState} from 'react'
import {Button,Tag,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {useUiStore} from '../store/ui'
interface Candidate{relativePath:string;name:string;size:number}
export default function FileCandidates({query}:{query:string}){
 const [scope,setScope]=useState<{id:string;path:string}|null>(null),[items,setItems]=useState<Candidate[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
 const request=useRef(0),importing=useRef(false),scopeRef=useRef(scope);scopeRef.current=scope
 useEffect(()=>()=>{const current=scopeRef.current;if(current)void sys('search.revoke',{id:current.id}).catch(()=>undefined)},[])
 useSysEvent('notes.changed',()=>setRevision(r=>r+1))
 useEffect(()=>{
  const n=++request.current;setItems([]);setNotice('');setBusy(false)
  if(!scope||!query)return
  setBusy(true)
  void sys<{items:Candidate[];truncated:boolean}>('search.candidates',{id:scope.id,query}).then(r=>{if(n===request.current){setItems(r.items);setNotice(r.truncated?'已达到扫描范围上限，请缩小目录或关键词':r.items.length?'仅按文件名匹配，正文尚未索引':'此目录没有匹配的未索引候选')}}).catch(e=>{if(n===request.current)setNotice(String(e))}).finally(()=>{if(n===request.current)setBusy(false)})
 },[scope,query,revision])
 const choose=async()=>{try{const r=await sys<{canceled:boolean;id:string;path:string}>('search.choose_folder');if(!r.canceled)setScope(r)}catch(e){void message.error(String(e))}}
 const importFile=async(item:Candidate)=>{
  if(!scope||importing.current)return
  importing.current=true;setBusy(true)
  try{const r=await sys<{noteIds:string[];errors:string[]}>('search.import_candidate',{id:scope.id,relativePath:item.relativePath});if(r.errors.length)throw new Error(r.errors.join('\n'));setRevision(v=>v+1);if(r.noteIds[0])useUiStore.getState().setActiveNote(r.noteIds[0])}catch(e){void message.error(String(e))}finally{importing.current=false;setBusy(false)}
 }
 return <div className="mx-6 mb-2 rounded border border-[var(--ww-border)] p-2 text-xs text-[var(--ww-text-2)]">
  <div className="flex flex-wrap items-center gap-2"><Button size="small" onClick={()=>void choose()} disabled={busy}>选择候选目录</Button><span>仅查文件名，不自动导入</span>{scope&&<Button size="small" disabled={busy} onClick={()=>{void sys('search.revoke',{id:scope.id}).catch(()=>undefined);setScope(null);setItems([])}}>取消目录授权</Button>}</div>
  {scope&&<div className="mt-1 break-all">本次范围：{scope.path} {!query&&'· 输入关键词查找'}</div>}
  {notice&&<div role="status">{notice}</div>}
  {items.map(item=><div key={item.relativePath} className="mt-2 flex items-center gap-2"><Tag>未索引 · 文件名</Tag><span className="min-w-0 flex-1 break-all">{item.relativePath}</span><Button size="small" disabled={busy} onClick={()=>void importFile(item)}>导入</Button></div>)}
 </div>
}
