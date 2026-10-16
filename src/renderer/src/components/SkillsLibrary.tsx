import {useEffect,useState} from 'react'
import {Button,Drawer,Input,Modal,Switch,Tag,message} from 'antd'
import {sys} from '../api'
import MarkdownContent from './MarkdownContent'
import {t} from '../i18n/zh'
interface Skill{name:string;source:string;description:string;enabled:boolean}
export default function SkillsLibrary(){
 const [items,setItems]=useState<Skill[]>([]),[query,setQuery]=useState(''),[detail,setDetail]=useState<{name:string;markdown:string}|null>(null)
 const refresh=()=>sys<{items:Skill[]}>('skills.list').then(r=>setItems(r.items))
 useEffect(()=>{void refresh().catch(e=>message.error(String(e)))},[])
 return <div className="space-y-3"><Input.Search value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('skills.search')}/><Button onClick={async()=>{try{const folder=await sys<{path?:string;canceled:boolean}>('app.pick_folder');if(folder.path&&!folder.canceled){await sys('skills.add',{dir:folder.path});await refresh()}}catch(e){message.error(String(e))}}}>{t('skills.add')}</Button><Button onClick={()=>void refresh().catch(e=>message.error(String(e)))}>{t('skills.refresh')}</Button>
  {items.filter(s=>(s.name+' '+s.description).toLowerCase().includes(query.toLowerCase())).map(skill=><div key={skill.name} className="flex items-center gap-2 border-b border-[var(--ww-border)] p-2"><Switch checked={skill.enabled} onChange={enabled=>void sys('skills.toggle',{name:skill.name,enabled}).then(refresh).catch(e=>message.error(String(e)))}/><Button type="link" onClick={()=>void sys<{name:string;markdown:string}>('skills.read',{name:skill.name}).then(setDetail).catch(e=>message.error(String(e)))}>{skill.name}</Button><Tag>{t(skill.source==='workspace'?'skills.workspace':'skills.global')}</Tag><span className="flex-1">{skill.description}</span><Button danger onClick={()=>Modal.confirm({title:t('skills.remove'),content:t('skills.removeHint'),onOk:async()=>{await sys('skills.remove',{name:skill.name,confirmed:true});await refresh()}})}>{t('skills.remove')}</Button></div>)}
  <Drawer open={!!detail} title={detail?.name} width={700} onClose={()=>setDetail(null)}>{detail&&<MarkdownContent text={detail.markdown}/>}</Drawer>
 </div>
}
