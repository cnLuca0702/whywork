import {useEffect,useState} from 'react'
import {Button,Dropdown,Input,Modal,message} from 'antd'
import {useChatStore,type ChatSummary} from '../store/chat'
import {useUiStore} from '../store/ui'
import {sys} from '../api'
import {t} from '../i18n/zh'
export default function ChatHistory(){
 const {chats,activeChatId,running,loadChats,openChat}=useChatStore()
 const [query,setQuery]=useState(''),[limit,setLimit]=useState(20),[rows,setRows]=useState<ChatSummary[]>([]),[total,setTotal]=useState(0)
 const [editing,setEditing]=useState<string|null>(null),[title,setTitle]=useState('')
 useEffect(()=>{let active=true;const timer=setTimeout(()=>void (async()=>{const items:ChatSummary[]=[];let total=0;for(let offset=0;offset<limit;offset+=500){const page=await sys<{items:ChatSummary[];total:number}>('chat.list',{query,limit:Math.min(500,limit-offset),offset});items.push(...page.items);total=page.total;if(items.length>=total)break}return {items,total}})().then(r=>{if(active){setRows(r.items);setTotal(r.total)}}).catch(e=>message.error(String(e))),150);return()=>{active=false;clearTimeout(timer)}},[query,limit,chats])
 return <>
  <div className="ww-nav-label">{t('chat.history')}</div>
  <Input aria-label={t('chat.search')} placeholder={t('chat.search')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(20)}}/>
  {!rows.length&&<p className="ww-nav-empty">{t('chat.emptyHistory')}</p>}
  {rows.map(c=><div key={c.chatId} className="flex items-center">
    {editing===c.chatId?<Input autoFocus value={title} aria-label={t('chat.rename')} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setEditing(null)}} onPressEnter={e=>{if(e.nativeEvent.isComposing)return;void sys('chat.rename',{chatId:c.chatId,title:title.trim()}).then(()=>{setEditing(null);return loadChats()}).catch(e=>message.error(String(e)))}}/>:
    <button className={`ww-nav-item min-w-0 flex-1 ${activeChatId===c.chatId?'is-active':''}`} title={c.title} onClick={()=>void useUiStore.getState().setView('chat').then(ok=>ok?openChat(c.chatId):null).catch(e=>message.error(String(e)))}><span className="truncate">{c.title}</span></button>}
    <Dropdown trigger={['click']} menu={{items:[{key:'rename',label:t('chat.rename'),onClick:()=>{setEditing(c.chatId);setTitle(c.title)}},{key:'delete',label:t('chat.delete'),danger:true,disabled:!!running[c.chatId],onClick:()=>Modal.confirm({title:t('chat.deleteConfirm'),okText:t('chat.delete'),cancelText:t('common.cancel'),onOk:async()=>{await sys('chat.delete',{chatId:c.chatId});if(useChatStore.getState().activeChatId===c.chatId)useChatStore.getState().newChat();await loadChats()}})}]}}><Button type="text" size="small" aria-label={`${t('chat.history')} ${c.title}`}>…</Button></Dropdown>
  </div>)}
  {rows.length<total&&<Button size="small" onClick={()=>setLimit(limit+50)}>{t('chat.more')}</Button>}
 </>
}
