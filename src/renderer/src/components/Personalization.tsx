import {useEffect,useState} from 'react'
import {Button,Input,Select,Modal,message} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
const fields=['profile.nickname','profile.role','profile.instructions','ai.responseLanguage','memory.mode']
export default function Personalization(){
 const [values,setValues]=useState<Record<string,string|null>>({}),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
 const [editing,setEditing]=useState<{kind:'root'|'daily';previous:string;text:string}|null>(null)
 useEffect(()=>{void sys<{settings:typeof values}>('settings.get',{keys:fields}).then(r=>{setValues(r.settings);setLoaded(true)}).catch(e=>message.error(String(e)))},[])
 const open=async(kind:'root'|'daily')=>{try{const r=await sys<{text:string}>('memory.read',{kind});setEditing({kind,previous:r.text,text:r.text})}catch(e){message.error(String(e))}}
 return <div className="space-y-4">
  {(['profile.nickname','profile.role','profile.instructions'] as const).map(key=><label className="block" key={key}>{t(key)}{key==='profile.instructions'?<Input.TextArea rows={5} maxLength={2000} showCount value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>:<Input maxLength={200} value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>}</label>)}
  <label className="block">{t('profile.language')} <Select value={values['ai.responseLanguage']??'auto'} onChange={v=>setValues(s=>({...s,'ai.responseLanguage':v}))} options={['auto','简体中文','English','繁體中文','日本語'].map(value=>({value,label:value==='auto'?t('profile.follow'):value}))}/></label>
  <label className="block">{t('profile.memory')} <Select style={{minWidth:250}} value={values['memory.mode']??'economy'} onChange={v=>setValues(s=>({...s,'memory.mode':v}))} options={(['quality','economy','off'] as const).map(value=>({value,label:t(`profile.${value}`)}))}/></label>
  <Button type="primary" loading={busy} disabled={!loaded} onClick={async()=>{setBusy(true);try{await sys('settings.set',{settings:values});message.success(t('settings.saved'))}catch(e){message.error(String(e))}finally{setBusy(false)}}}>{t('common.save')}</Button>
  <div className="flex gap-2"><Button onClick={()=>void open('root')}>{t('profile.root')}</Button><Button onClick={()=>void open('daily')}>{t('profile.daily')}</Button><Button danger onClick={()=>Modal.confirm({title:t('profile.clearConfirm'),onOk:async()=>{await sys('memory.clear',{confirmed:true});message.success(t('settings.saved'))}})}>{t('profile.clear')}</Button></div>
  <Modal width={800} title={t(editing?.kind==='root'?'profile.root':'profile.daily')} open={!!editing} onCancel={()=>setEditing(null)} onOk={async()=>{if(!editing)return;try{await sys('memory.update',editing);setEditing(null)}catch(e){message.error(String(e))}}}><Input.TextArea aria-label={t('profile.memoryEditor')} rows={18} value={editing?.text} onChange={e=>setEditing(v=>v?{...v,text:e.target.value}:null)}/></Modal>
 </div>
}
