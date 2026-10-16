import {useEffect,useState} from 'react'
import {Button,Select,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {t} from '../i18n/zh'
import {useUiStore} from '../store/ui'
interface Recording{note_id:string;path:string;transcript_note_id:string|null;minutes_note_id:string|null}
export default function RecordingNoteActions({noteId}:{noteId:string}){
 const [record,setRecord]=useState<Recording|null>(null),[busy,setBusy]=useState(false),[template,setTemplate]=useState('general'),[text,setText]=useState('')
 const refresh=()=>sys<{recording:Recording|null}>('media.recording_info',{noteId}).then(r=>setRecord(r.recording))
 useEffect(()=>{void refresh().catch(()=>undefined)},[noteId]);useSysEvent('notes.changed',()=>{void refresh().catch(()=>undefined)})
 useSysEvent('media.minutes',p=>{const e=p as {recordingNoteId:string;delta?:string};if(e.recordingNoteId===record?.note_id&&e.delta)setText(v=>v+e.delta)})
 if(!record)return null
 return <div className="px-6 py-2"><div className="flex flex-wrap gap-2">{[record.note_id,record.transcript_note_id,record.minutes_note_id].map((id,i)=>id&&<Button key={id} onClick={()=>useUiStore.getState().setActiveNote(id)}>{t((['media.recordingNote','media.transcriptNote','media.minutesNote'] as const)[i]!)}</Button>)}
  <Select value={template} onChange={setTemplate} options={(['general','interview','lecture'] as const).map(value=>({value,label:t(`media.${value}`)}))}/>
  <Button loading={busy} onClick={async()=>{setBusy(true);setText('');try{if(!record.transcript_note_id)await sys('media.transcribe',{path:record.path,createNote:true});else await sys('media.generate_minutes',{recordingNoteId:record.note_id,template});await refresh()}catch(e){message.error(String(e))}finally{setBusy(false)}}}>{t(record.transcript_note_id?'media.minutes':'media.transcribe')}</Button>
  {busy&&record.transcript_note_id&&<Button onClick={()=>void sys('media.cancel_minutes',{recordingNoteId:record.note_id}).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}
 </div>{text&&<details open><summary>{t('media.minutes')}</summary><p className="whitespace-pre-wrap">{text}</p></details>}</div>
}
