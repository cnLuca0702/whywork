import {useEffect,useState} from 'react'
import {Input,Select} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
export default function MailPreview({value,onChange,disabled=false}:{value:Record<string,string>;onChange:(v:Record<string,string>)=>void;disabled?:boolean}){
 const [accounts,setAccounts]=useState<{id:string;name:string}[]>([])
 useEffect(()=>{void sys<{items:typeof accounts}>('mail.accounts').then(r=>setAccounts(r.items)).catch(()=>undefined)},[])
 return <div className="space-y-2">
  {accounts.length>1?<Select disabled={disabled} aria-label={t('mail.account')} value={value.accountId} options={accounts.map(a=>({value:a.id,label:a.name}))} onChange={accountId=>onChange({...value,accountId})}/>:<div>{t('mail.account')}：{accounts[0]?.name??value.accountId}</div>}
  {(['to','cc','bcc','subject','text'] as const).map(key=><label className="block" key={key}>{t(`mail.${key}`)}{key==='text'?<Input.TextArea aria-label={t(`mail.${key}`)} rows={6} value={value[key]} disabled={disabled} onChange={e=>onChange({...value,[key]:e.target.value})}/>:<Input aria-label={t(`mail.${key}`)} value={value[key]} disabled={disabled} onChange={e=>onChange({...value,[key]:e.target.value})}/>}</label>)}
 </div>
}
