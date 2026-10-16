import {useState} from 'react'
import {Button,Input,Select,message} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
export interface Outline{title:string;slides:{title:string;bullets:string[]}[]}
export default function SlideOutline({initial,onCreated,onClose}:{initial:Outline;onCreated:(path:string)=>void;onClose:()=>void}){
 const [outline,setOutline]=useState(initial),[theme,setTheme]=useState('blue'),[busy,setBusy]=useState(false)
 const move=(index:number,delta:number)=>setOutline(o=>{const slides=[...o.slides],other=index+delta;if(other<0||other>=slides.length)return o;[slides[index],slides[other]]=[slides[other]!,slides[index]!];return {...o,slides}})
 return <div className="space-y-3"><h3>{t('office.outline')}</h3><Input value={outline.title} onChange={e=>setOutline(o=>({...o,title:e.target.value}))}/><Select value={theme} onChange={setTheme} options={(['blue','forest','ink'] as const).map(value=>({value,label:t(`office.${value}`)}))}/>
  {outline.slides.map((slide,index)=><div className="border border-[var(--ww-border)] p-3" key={index}><Input maxLength={150} aria-label={t('office.slideTitle')} value={slide.title} onChange={e=>setOutline(o=>({...o,slides:o.slides.map((s,i)=>i===index?{...s,title:e.target.value}:s)}))}/><Input.TextArea rows={3} aria-label={t('office.bullets')} value={slide.bullets.join('\n')} onChange={e=>setOutline(o=>({...o,slides:o.slides.map((s,i)=>i===index?{...s,bullets:e.target.value.split('\n')}:s)}))}/><Button disabled={!index} onClick={()=>move(index,-1)}>↑</Button><Button disabled={index===outline.slides.length-1} onClick={()=>move(index,1)}>↓</Button><Button danger disabled={outline.slides.length===1} onClick={()=>setOutline(o=>({...o,slides:o.slides.filter((_,i)=>i!==index)}))}>{t('office.removeSlide')}</Button></div>)}
  <Button disabled={outline.slides.length>=40} onClick={()=>setOutline(o=>({...o,slides:[...o.slides,{title:'',bullets:[]}]}))}>{t('office.addSlide')}</Button><Button type="primary" loading={busy} onClick={async()=>{setBusy(true);try{const r=await sys<{path:string}>('office.slides',{...outline,theme});onCreated(r.path);onClose()}catch(e){message.error(String(e))}finally{setBusy(false)}}}>{t('office.createDeck')}</Button><Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
 </div>
}
