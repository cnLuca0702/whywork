import {useState} from 'react'
import {Button,Progress,Alert,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {t} from '../i18n/zh'
interface Status {batchId:string;total:number;done:number;current?:string;finished:boolean;failed:{noteId:string;reason:string}[];cancelled?:boolean}
export default function SummaryBatch({total,filter,query,searchMode}:{total:number;filter:Record<string,unknown>;query:string;searchMode:'fts'|'text'}){
 const [status,setStatus]=useState<Status|null>(null),[starting,setStarting]=useState(false)
 useSysEvent('summarize.progress',p=>setStatus(p as Status))
 const running=!!status&&!status.finished
 return <div className="px-6 py-2">
  <Button disabled={running||!total} loading={starting} onClick={async()=>{setStarting(true);try{const r=await sys<{batchId:string;total:number}>('llm.summarize_batch_start',{filter,query,searchMode});setStatus({...r,done:0,finished:false,failed:[]})}catch(e){message.error(String(e))}finally{setStarting(false)}}}>{t('notes.batchSummary',{n:total})}</Button>
  {running&&<Button onClick={()=>void sys('llm.summarize_batch_cancel',{batchId:status!.batchId}).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}
  {status&&<><Progress percent={Math.round(status.done/Math.max(1,status.total)*100)}/><span>{status.done}/{status.total} {status.current}</span>{status.cancelled&&<span>{t('notes.summaryCancelled')}</span>}{status.failed.length>0&&<Alert type="warning" message={status.failed.map(f=>f.reason).join('；')}/>}</>}
 </div>
}
