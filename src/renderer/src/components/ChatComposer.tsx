import {useEffect,useRef,useState} from 'react'
import {Button,Input,Modal,Switch,Tag,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {useChatStore} from '../store/chat'
import {t} from '../i18n/zh'

export default function ChatComposer({value,onChange,onSend,disabled,empty}:{value:string;onChange:(v:string)=>void;onSend:()=>void;disabled:boolean;empty:boolean}){
 const {noteRefs,skillRefs,useKnowledge}=useChatStore()
 const [query,setQuery]=useState<{kind:'note'|'skill';text:string;start:number;end:number}|null>(null)
 const [items,setItems]=useState<{id:string;title:string}[]>([]),[selected,setSelected]=useState(0),[url,setUrl]=useState(''),[urlOpen,setUrlOpen]=useState(false)
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState('')
 const composing=useRef(false),importId=useRef(''),refContext=useRef<string|null>(null)
 const activeChatId=useChatStore(s=>s.activeChatId)
 useEffect(()=>{refContext.current=activeChatId;setQuery(null)},[activeChatId])
 useSysEvent('import.progress',payload=>{const p=payload as {importId:string;done:number;total:number};if(p.importId===importId.current)setProgress(t('chat.importing',{done:p.done,total:p.total}))})
 useEffect(()=>{
  let active=true;setSelected(0)
  if(!query){setItems([]);return}
  const timer=setTimeout(()=>{
   const job=query.kind==='note'?sys<{items:{noteId:string;title:string}[]}>('notes.list',{titleQuery:query.text||undefined,limit:8}).then(r=>r.items.map(n=>({id:n.noteId,title:n.title})))
   :sys<{items:{name:string;enabled:boolean}[]}>('skills.list').then(r=>r.items.filter(s=>s.enabled&&s.name.toLowerCase().includes(query.text.toLowerCase())).slice(0,8).map(s=>({id:s.name,title:s.name})))
   void job.then(list=>{if(active)setItems(list)}).catch(e=>{if(active)void message.error(String(e))})
  },150)
  return()=>{active=false;clearTimeout(timer)}
 },[query?.kind,query?.text])
 const addNotes=async(ids:string[],chatId:string|null)=>{
  if(useChatStore.getState().activeChatId!==chatId)return
  const current=useChatStore.getState().noteRefs
  const unique=[...new Set(ids)].filter(id=>!current.some(n=>n.noteId===id))
  if(current.length+unique.length>10){void message.info(t('chat.refLimit'));return}
  const notes=await Promise.all(unique.map(noteId=>sys<{note:{title:string}}>('notes.get',{noteId,limit:1}).then(r=>({noteId,title:r.note.title}))))
  if(useChatStore.getState().activeChatId!==chatId||useChatStore.getState().streaming)return
  useChatStore.setState({noteRefs:[...useChatStore.getState().noteRefs,...notes].filter((n,i,a)=>a.findIndex(x=>x.noteId===n.noteId)===i).slice(0,10)})
 }
 const choose=(index:number)=>{
  const item=items[index];if(!item||!query)return
  if(query.kind==='note'){
   if(noteRefs.length>=10){void message.info(t('chat.refLimit'));return}
   if(!noteRefs.some(n=>n.noteId===item.id))useChatStore.setState({noteRefs:[...noteRefs,{noteId:item.id,title:item.title}]})
  }else{
   if(skillRefs.length>=3){void message.info(t('chat.refLimit'));return}
   if(!skillRefs.includes(item.id))useChatStore.setState({skillRefs:[...skillRefs,item.id]})
  }
  onChange(value.slice(0,query.start)+value.slice(query.end));setQuery(null)
 }
 const inspect=(text:string,cursor:number)=>{
  if(composing.current){setQuery(null);return}
  const prefix=text.slice(0,cursor),match=/(?:^|\s)@([^@\n]*)$/.exec(prefix),skill=/(?:^|\n)\/([^/\n]*)$/.exec(prefix)
  const token=match??skill
  setQuery(token?{kind:match?'note':'skill',text:token[1]!,start:cursor-token[1]!.length-1,end:cursor}:null)
 }
 return <>
  <div>{noteRefs.map(n=><Tag key={n.noteId} closable={!disabled} onClose={()=>useChatStore.setState({noteRefs:noteRefs.filter(x=>x.noteId!==n.noteId)})}>@ {n.title}</Tag>)}{skillRefs.map(s=><Tag key={s} closable={!disabled} onClose={()=>useChatStore.setState({skillRefs:skillRefs.filter(x=>x!==s)})}>/ {s}</Tag>)}
   {(noteRefs.length>0||skillRefs.length>0)&&<Button size="small" disabled={disabled} onClick={()=>useChatStore.setState({noteRefs:[],skillRefs:[]})}>{t('chat.clearRefs')}</Button>}</div>
  <Input.TextArea aria-label="对话输入" value={value} disabled={disabled||busy} variant="borderless" autoSize={{minRows:empty?4:2,maxRows:8}} placeholder={t('chat.composerHint')}
   onCompositionStart={()=>{composing.current=true;setQuery(null)}} onCompositionEnd={e=>{composing.current=false;inspect(e.currentTarget.value,e.currentTarget.selectionStart)}}
   onChange={e=>{onChange(e.target.value);inspect(e.target.value,e.target.selectionStart)}}
   onKeyDown={e=>{
    if(composing.current||e.nativeEvent.isComposing||e.keyCode===229)return
    if(query&&items.length){if(['ArrowUp','ArrowDown','Enter','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape')setQuery(null);else if(e.key==='Enter')choose(selected);else setSelected((selected+(e.key==='ArrowDown'?1:items.length-1))%items.length);return}}
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onSend()}
   }}/>
  {query&&items.length>0&&<div role="listbox" aria-label={t('chat.refCandidates')}>{items.map((item,i)=><Button key={item.id} role="option" aria-selected={i===selected} type={i===selected?'primary':'text'} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(i)}>{item.title}</Button>)}</div>}
  <div className="flex flex-wrap gap-2">
   <Button size="small" disabled={disabled||busy||noteRefs.length>=10} onClick={()=>{
    const chatId=activeChatId;setBusy(true);importId.current=crypto.randomUUID()
    void sys<{paths:string[];canceled:boolean}>('app.pick_files').then(async result=>{
     if(result.canceled)return
     if(result.paths.length>10-noteRefs.length)throw new Error(t('chat.refLimit'))
     const imported=await sys<{noteIds:string[];errors:string[]}>('app.import',{paths:result.paths,importId:importId.current})
     await addNotes(imported.noteIds,chatId)
     if(imported.errors.length)void message.warning(imported.errors.join('；'))
    }).catch(e=>{void message.error(String(e))}).finally(()=>{setBusy(false);setProgress('')})
   }}>{t('chat.attach')}</Button>
   <Button size="small" disabled={disabled||busy||noteRefs.length>=10} onClick={()=>setUrlOpen(true)}>{t('chat.addUrl')}</Button>
   <span className="text-xs">{progress||t('chat.attachHint')}</span>
   <Switch size="small" disabled={disabled} checked={useKnowledge} onChange={checked=>useChatStore.setState({useKnowledge:checked})}/><span className="text-xs">{t('chat.useKnowledge')}</span>
  </div>
  <Modal open={urlOpen} title={t('chat.addUrl')} confirmLoading={busy} okText={t('common.confirm')} cancelText={t('common.cancel')} onCancel={()=>{if(!busy)setUrlOpen(false)}} onOk={()=>{
   const chatId=activeChatId;setBusy(true);void sys<{blocked:boolean;noteId?:string}>('clip.save_url',{url}).then(async r=>{if(r.blocked)throw new Error(t('chat.urlBlocked'));if(r.noteId)await addNotes([r.noteId],chatId);setUrlOpen(false);setUrl('')}).catch(e=>{void message.error(String(e))}).finally(()=>setBusy(false))
  }}><Input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></Modal>
 </>
}
