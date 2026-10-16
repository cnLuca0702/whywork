import {t} from '../i18n/zh'
import {useEffect,useState} from 'react'
import {Alert,Button,Input,Select,message} from 'antd'
import {RecordingController,type RecordingMode,type RecordingState} from '../recording/controller'
import {sys,useSysEvent} from '../api'
import {useUiStore} from '../store/ui'
function time(ms:number){const s=Math.floor(ms/1000);return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`}
export default function RecordingControls(){
 const [language,setLanguage]=useState('auto'),[keyPoints,setKeyPoints]=useState(''),[asrConfigured,setAsrConfigured]=useState(false),[pending,setPending]=useState(0),[later,setLater]=useState(false),[transcribed,setTranscribed]=useState(false),[template,setTemplate]=useState('general'),[minutesBusy,setMinutesBusy]=useState(false),[minutesText,setMinutesText]=useState('')
 const [controller]=useState(()=>new RecordingController(stream=>new MediaRecorder(stream,MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?{mimeType:'audio/webm;codecs=opus'}:undefined)))
 const [state,setState]=useState(controller.state),[elapsed,setElapsed]=useState(0),[synthetic,setSynthetic]=useState(false),[preview,setPreview]=useState(''),[transcribing,setTranscribing]=useState(false)
 useEffect(()=>{const off=controller.subscribe(setState);const timer=setInterval(()=>setElapsed(controller.duration()),200);void sys<{isolatedUI:boolean}>('media.recording_capabilities').then(r=>{setSynthetic(r.isolatedUI);setAsrConfigured(!!(r as {asrConfigured?:boolean}).asrConfigured)});return()=>{off();clearInterval(timer);controller.dispose()}},[controller])
 useEffect(()=>{if(!state.blob){setPreview('');return}const url=URL.createObjectURL(state.blob);setPreview(url);return()=>URL.revokeObjectURL(url)},[state.blob])
 useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if(!['idle','saved','error'].includes(controller.state.phase)){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[controller])
 useEffect(()=>{void sys<{settings:Record<string,string|null>}>('settings.get',{keys:['media.transcriptionLanguage']}).then(r=>setLanguage(r.settings['media.transcriptionLanguage']??'auto')).catch(e=>message.error(String(e)))},[])
 useEffect(()=>{if(state.phase==='saved')void sys<{total:number}>('media.pending_transcriptions').then(r=>setPending(Math.max(0,r.total-1))).catch(e=>message.error(String(e)))},[state.phase])
 useSysEvent('media.minutes',p=>{const r=p as {recordingNoteId:string;delta?:string};if(r.recordingNoteId===state.noteId&&r.delta)setMinutesText(text=>text+r.delta)})
 const generate=async()=>{if(!state.noteId||minutesBusy)return;setMinutesBusy(true);setMinutesText('');try{await sys('media.generate_minutes',{recordingNoteId:state.noteId,template})}catch(e){message.error(String(e))}finally{setMinutesBusy(false)}}
 const start=(mode:RecordingMode)=>{setLater(false);setTranscribed(false);setMinutesText('');return controller.start(mode,async()=>{
  if(mode==='synthetic'){
   if(!synthetic)throw new Error('仅隔离验收模式允许合成音源')
   const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),out=audio.createMediaStreamDestination();osc.frequency.value=440;gain.gain.value=0.1;osc.connect(gain).connect(out);await audio.resume();osc.start()
   return{stream:out.stream,release:()=>{osc.stop();void audio.close()}}
  }
  const stream=mode==='system'?await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):await navigator.mediaDevices.getUserMedia({audio:true})
  return{stream}
 })}
 const saveSnapshot=async(snapshot:RecordingState)=>{
  const buf=new Uint8Array(await snapshot.blob!.arrayBuffer());let binary='';for(let i=0;i<buf.length;i+=8192)binary+=String.fromCharCode(...buf.subarray(i,i+8192))
  return sys<{noteId:string;path:string}>('media.save_recording',{id:snapshot.id,mime:snapshot.blob!.type,data:btoa(binary),durationMs:Math.round(snapshot.durationMs),mode:snapshot.mode,keyPoints,language,segmentOf:snapshot.segmentOf,segmentIndex:snapshot.segmentIndex})
 }
 const save=()=>controller.save(saveSnapshot)
 useEffect(()=>{controller.setSegmentSaver(async snapshot=>{const r=await saveSnapshot(snapshot);message.info(t('media.segmentSaved',{n:snapshot.segmentIndex??1}));return r})},[controller,keyPoints,language])
 const transcribe=async()=>{if(!state.path||transcribing)return;setTranscribing(true);try{await sys('media.transcribe',{path:state.path,createNote:true,language});setTranscribed(true);void message.success('转写完成')}catch(e){void message.error(`录音已保存，转写未完成：${String(e)}`)}finally{setTranscribing(false)}}
 const idle=['idle','saved','error'].includes(state.phase)
 return <div className="ww-recording" aria-label="录音控制">
  {idle&&<Select aria-label={t('media.language')} value={language} onChange={value=>{setLanguage(value);void sys('settings.set',{settings:{'media.transcriptionLanguage':value}}).catch(e=>message.error(String(e)))}} options={[{value:'auto',label:t('media.auto')},{value:'zh-CN',label:'中文'},{value:'en-US',label:'English'}]}/>}
  {['recording','paused','ready'].includes(state.phase)&&<Input.TextArea maxLength={20000} placeholder={t('media.keyPoints')} value={keyPoints} onChange={e=>setKeyPoints(e.target.value)}/>}
  {idle&&<div className="flex flex-wrap gap-1"><Button size="small" type="text" onClick={()=>void start('microphone')}>开始录音</Button><Button size="small" type="text" onClick={()=>void start('system')}>系统音频</Button>{synthetic&&<Button size="small" type="text" onClick={()=>void start('synthetic')}>合成音频验证</Button>}</div>}
  {!['idle','error'].includes(state.phase)&&<div className="mt-1 flex flex-wrap items-center gap-2" role="status"><span>{({requesting:'等待设备授权',recording:'录音中',paused:'已暂停',stopping:'正在结束',ready:'待保存',saving:'正在保存',saved:'已保存'} as Record<string,string>)[state.phase]} · {time(state.phase==='recording'?elapsed:state.durationMs)}</span>
   {state.phase==='recording'&&<Button size="small" type="text" onClick={()=>controller.pause()}>暂停录音</Button>}{state.phase==='paused'&&<Button size="small" type="text" onClick={()=>controller.resume()}>继续录音</Button>}
   {['recording','paused'].includes(state.phase)&&<Button size="small" type="text" onClick={()=>controller.finish()}>结束录音</Button>}
   {state.phase==='ready'&&<Button size="small" type="primary" onClick={()=>void save()}>保存录音</Button>}
   {!['saved','saving'].includes(state.phase)&&<Button size="small" type="text" onClick={()=>controller.cancel()}>取消录音</Button>}
   {state.phase==='saved'&&<><Button size="small" type="text" onClick={()=>{void useUiStore.getState().setView('notes').then(ok=>{if(ok)useUiStore.getState().setActiveNote(state.noteId!)})}}>查看录音笔记</Button>{asrConfigured&&!later&&!transcribed&&<><span>{t('media.transcribePrompt',{n:pending})}</span><Button size="small" loading={transcribing} onClick={()=>void transcribe()}>{t('media.transcribe')}</Button><Button onClick={()=>setLater(true)}>{t('media.later')}</Button></>}{later&&!transcribed&&<Button onClick={()=>{setLater(false);void transcribe()}}>{t('media.transcribe')}</Button>}</>}
  </div>}
  {state.phase==='saved'&&transcribed&&<div className="my-2"><Select value={template} onChange={setTemplate} options={(['general','interview','lecture'] as const).map(value=>({value,label:t(`media.${value}`)}))}/><Button loading={minutesBusy} onClick={()=>void generate()}>{t('media.minutes')}</Button>{minutesBusy&&<Button onClick={()=>void sys('media.cancel_minutes',{recordingNoteId:state.noteId}).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}<div className="whitespace-pre-wrap">{minutesText}</div></div>}
  {preview&&<audio className="mt-1 max-w-full" controls src={preview} aria-label="录音预览"/>}
  {state.error&&<Alert type="error" message={state.error}/>}
  {state.phase==='ready'&&<div className="text-xs text-[var(--ww-text-3)]">音频只保存在本地；转写需保存后单独发起。</div>}
 </div>
}
