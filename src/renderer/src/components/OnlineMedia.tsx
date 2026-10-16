import {useEffect,useState} from 'react'
import {Alert,Button,Card,Input,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {t} from '../i18n/zh'
import {useUiStore} from '../store/ui'
interface Job{id:string;url:string;state:string;error:string|null;note_id:string|null}
export default function OnlineMedia(){
 const [urls,setUrls]=useState(''),[jobs,setJobs]=useState<Job[]>([]),[busy,setBusy]=useState(false)
 const refresh=()=>sys<{items:Job[]}>('media.jobs').then(r=>setJobs(r.items))
 useEffect(()=>{void refresh().catch(e=>message.error(String(e)))},[]);useSysEvent('media.job',()=>{void refresh().catch(e=>message.error(String(e)))})
 return <Card className="mt-4" title={t('media.online')}><Input.TextArea rows={3} value={urls} onChange={e=>setUrls(e.target.value)} placeholder={t('media.urls')}/><Button loading={busy} onClick={async()=>{setBusy(true);try{await sys('media.add_urls',{urls:urls.split(/\n/).map(s=>s.trim()).filter(Boolean)});setUrls('');await refresh()}catch(e){message.error(String(e))}finally{setBusy(false)}}}>{t('media.addJobs')}</Button>
  {jobs.map(job=><div className="my-2 border-b border-[var(--ww-border)] py-2" key={job.id}><p className="break-all">{job.url}</p><span>{t(({'waiting':'media.waiting','parsing':'media.parsing','downloading':'media.downloading','transcribing':'media.transcribing','minutes':'media.generating','done':'media.done','failed':'media.failed','cancelled':'media.cancelled'} as const)[job.state]??'media.failed')}</span>
   {['failed','cancelled'].includes(job.state)?<Button onClick={()=>void sys('media.retry_job',{jobId:job.id}).then(refresh).catch(e=>message.error(String(e)))}>{t('media.retry')}</Button>:job.state!=='done'&&<Button onClick={()=>void sys('media.cancel_job',{jobId:job.id}).then(refresh).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}
   {job.note_id&&<Button type="link" onClick={()=>void useUiStore.getState().setView('notes').then(ok=>{if(ok)useUiStore.getState().setActiveNote(job.note_id)})}>{t('media.openMain')}</Button>}{job.error&&<Alert type="error" message={job.error}/>}</div>)}
 </Card>
}
