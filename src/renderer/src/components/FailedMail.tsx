import {useEffect,useState} from 'react'
import {Button,Card,Modal,message} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
interface Failed{id:string;error:string;payload:{to:string;subject:string;text:string;attachments?:{path:string}[]}}
export default function FailedMail(){
 const [items,setItems]=useState<Failed[]>([])
 const refresh=()=>sys<{items:Failed[]}>('mail.failed').then(r=>setItems(r.items))
 useEffect(()=>{void refresh().catch(e=>message.error(String(e)));const timer=setInterval(()=>void refresh().catch(()=>undefined),3000);return()=>clearInterval(timer)},[])
 return <Card title={t('mail.failed')}><Button onClick={()=>void refresh().catch(e=>message.error(String(e)))}>{t('skills.refresh')}</Button>{items.map(item=><div className="border-b border-[var(--ww-border)] py-3" key={item.id}><strong>{item.payload.subject}</strong><p>{item.payload.to} · {item.error}</p><Button onClick={()=>Modal.confirm({title:t('mail.retryConfirm'),content:<div><p>{item.payload.to}</p><p>{item.payload.subject}</p><pre className="whitespace-pre-wrap">{item.payload.text}</pre>{item.payload.attachments?.map(a=><p key={a.path}>{a.path}</p>)}</div>,onOk:async()=>{await sys('mail.retry',{id:item.id,confirmed:true});await refresh()}})}>{t('media.retry')}</Button></div>)}</Card>
}
