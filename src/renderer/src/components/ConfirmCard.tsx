import {useEffect,useState} from 'react'
import {Button,Card,message} from 'antd'
import type {ConfirmCardData} from '../../../shared/confirmation'
import {sys} from '../api'
import {t} from '../i18n/zh'
import MailPreview from './MailPreview'
export default function ConfirmCard({card}:{card:ConfirmCardData}){
 const [value,setValue]=useState(card.preview.editable??{}),[busy,setBusy]=useState(false)
 useEffect(()=>setValue(card.preview.editable??{}),[card.preview])
 const decide=(approved:boolean)=>{setBusy(true);void sys('chat.confirm',{id:card.id,chatId:card.chatId,approved,...(approved&&card.preview.kind==='mail'?{override:value}:{})}).catch(e=>message.error(String(e))).finally(()=>setBusy(false))}
 return <Card className="my-3" size="small" title={card.preview.title}>
  {card.preview.kind==='mail'?<><MailPreview value={value} onChange={setValue} disabled={busy||card.state!=='pending'}/>{card.preview.fields.filter(f=>f.label==='附件').map((f,i)=><p key={i}><b>{f.label}：</b>{f.value}</p>)}</>:<>
   {card.preview.fields.map((f,i)=><p key={i}><b>{f.label}：</b>{f.value}</p>)}
   {card.preview.body&&<pre className="max-h-52 overflow-auto whitespace-pre-wrap">{card.preview.body}</pre>}
  </>}
  {card.preview.warnings?.map(w=><p key={w}>{w}</p>)}
  {card.state==='pending'?<div className="flex gap-2"><Button type="primary" loading={busy} onClick={()=>decide(true)}>{t('confirm.allow')}</Button><Button disabled={busy} onClick={()=>decide(false)}>{t('confirm.deny')}</Button></div>:<span>{t(`confirm.${card.state}`)}</span>}
 </Card>
}
