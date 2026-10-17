import {t} from '../i18n/zh'
import {useEffect,useState} from 'react'
import {Alert,Button,Input,Popover,Select,message} from 'antd'
import {AudioOutlined,PlayCircleOutlined,StopOutlined,PauseOutlined} from '@ant-design/icons'
import {RecordingController,type RecordingMode,type RecordingState} from '../recording/controller'
import {sys,useSysEvent} from '../api'
import {useUiStore} from '../store/ui'
import {create} from 'zustand'

function time(ms:number){const s=Math.floor(ms/1000);return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`}

/** 全局唯一的录音控制器与 UI 状态：对话输入区（精简）与录音工作区（完整）共享同一录音会话（U-12） */
const controller=new RecordingController(stream=>new MediaRecorder(stream,MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?{mimeType:'audio/webm;codecs=opus'}:undefined))

interface RecordingUi {
 language:string
 keyPoints:string
 asrConfigured:boolean
 synthetic:boolean
 pending:number
 later:boolean
 transcribed:boolean
 template:string
 minutesBusy:boolean
 minutesText:string
 transcribing:boolean
 recordingNoteId:string|null
 set:(patch:Partial<RecordingUi>)=>void
}
const useRecordingUi=create<RecordingUi>(set=>({
 language:'auto',keyPoints:'',asrConfigured:false,synthetic:false,pending:0,later:false,transcribed:false,template:'general',
 minutesBusy:false,minutesText:'',transcribing:false,recordingNoteId:null,
 set:patch=>set(patch)
}))

function useRecordingState():RecordingState{
 const [state,setState]=useState(controller.state)
 useEffect(()=>controller.subscribe(setState),[])
 return state
}

/** 启动/保存/转写等动作：直接读写共享状态，供精简与完整两套 UI 复用 */
const actions={
 setLanguage(language:string){useRecordingUi.getState().set({language});void sys('settings.set',{settings:{'media.transcriptionLanguage':language}}).catch(e=>message.error(String(e)))},
 start(mode:RecordingMode){
  if(!['idle','saved','error'].includes(controller.state.phase))return
  const ui=useRecordingUi.getState()
  ui.set({later:false,transcribed:false,minutesText:''})
  return controller.start(mode,async()=>{
   if(mode==='synthetic'){
    if(!ui.synthetic)throw new Error('仅隔离验收模式允许合成音源')
    const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),out=audio.createMediaStreamDestination();osc.frequency.value=440;gain.gain.value=0.1;osc.connect(gain).connect(out);await audio.resume();osc.start()
    return{stream:out.stream,release:()=>{osc.stop();void audio.close()}}
   }
   const stream=mode==='system'?await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):await navigator.mediaDevices.getUserMedia({audio:true})
   return{stream}
  })
 },
 async saveSnapshot(snapshot:RecordingState){
  const {language,keyPoints}=useRecordingUi.getState()
  const buf=new Uint8Array(await snapshot.blob!.arrayBuffer());let binary='';for(let i=0;i<buf.length;i+=8192)binary+=String.fromCharCode(...buf.subarray(i,i+8192))
  return sys<{noteId:string;path:string}>('media.save_recording',{id:snapshot.id,mime:snapshot.blob!.type,data:btoa(binary),durationMs:Math.round(snapshot.durationMs),mode:snapshot.mode,keyPoints,language,segmentOf:snapshot.segmentOf,segmentIndex:snapshot.segmentIndex})
 },
 save(){return controller.save(actions.saveSnapshot)},
 async transcribe(){
  const path=controller.state.path
  if(!path||useRecordingUi.getState().transcribing)return
  useRecordingUi.getState().set({transcribing:true})
  try{await sys('media.transcribe',{path,createNote:true,language:useRecordingUi.getState().language});useRecordingUi.getState().set({transcribed:true});void message.success('转写完成')}
  catch(e){void message.error(`录音已保存，转写未完成：${String(e)}`)}
  finally{useRecordingUi.getState().set({transcribing:false})}
 },
 async generate(){
  const noteId=controller.state.noteId
  if(!noteId||useRecordingUi.getState().minutesBusy)return
  useRecordingUi.getState().set({minutesBusy:true,minutesText:''})
  try{await sys('media.generate_minutes',{recordingNoteId:noteId,template:useRecordingUi.getState().template})}
  catch(e){message.error(String(e))}
  finally{useRecordingUi.getState().set({minutesBusy:false})}
 }
}
export function RecordingBootstrap(){
 const state=useRecordingState()
 const set=useRecordingUi(s=>s.set)
 useEffect(()=>{
  const off=controller.subscribe(s=>{if(s.noteId!==useRecordingUi.getState().recordingNoteId)set({recordingNoteId:s.noteId??null})})
  void sys<{settings:Record<string,string|null>}>('settings.get',{keys:['media.transcriptionLanguage']}).then(r=>{if(r.settings['media.transcriptionLanguage'])set({language:r.settings['media.transcriptionLanguage']!})}).catch(e=>message.error(String(e)))
  controller.setSegmentSaver(async snapshot=>{const r=await actions.saveSnapshot(snapshot);message.info(t('media.segmentSaved',{n:snapshot.segmentIndex??1}));return r})
  const before=(e:BeforeUnloadEvent)=>{if(!['idle','saved','error'].includes(controller.state.phase)){e.preventDefault();e.returnValue=''}}
  window.addEventListener('beforeunload',before)
  return()=>{off();window.removeEventListener('beforeunload',before)}
 },[set])
 useEffect(()=>{
  void sys<{isolatedUI:boolean;asrConfigured?:boolean}>('media.recording_capabilities').then(r=>set({synthetic:r.isolatedUI,asrConfigured:!!r.asrConfigured})).catch(()=>undefined)
 },[state.phase,set])
 useEffect(()=>{
  if(state.phase!=='saved')return
  void sys<{total:number}>('media.pending_transcriptions').then(r=>set({pending:Math.max(0,r.total-1)})).catch(e=>message.error(String(e)))
 },[state.phase,state.noteId,set])
 useSysEvent('media.minutes',p=>{const r=p as {recordingNoteId:string;delta?:string};if(r.recordingNoteId===controller.state.noteId&&r.delta)useRecordingUi.getState().set({minutesText:useRecordingUi.getState().minutesText+r.delta})})
 return null
}

const LANGUAGE_OPTIONS=[{value:'auto',label:t('media.auto')},{value:'zh-CN',label:'中文'},{value:'en-US',label:'English'}]

/** 对话输入区工具条上的麦克风：点击展开小浮层选择来源与语言（U-12） */
export function MicLauncher({disabled}:{disabled?:boolean}){
 const language=useRecordingUi(s=>s.language)
 const synthetic=useRecordingUi(s=>s.synthetic)
 const start=(mode:RecordingMode)=>()=>{void actions.start(mode)}
 const content=<div className="w-52 space-y-2" onClick={e=>e.stopPropagation()}>
  <Select aria-label={t('media.language')} className="w-full" size="small" value={language} onChange={actions.setLanguage} options={LANGUAGE_OPTIONS}/>
  <div className="flex flex-wrap gap-1">
   <Button size="small" icon={<AudioOutlined/>} onClick={start('microphone')}>开始录音</Button>
   <Button size="small" icon={<PlayCircleOutlined/>} onClick={start('system')}>系统音频</Button>
   {synthetic&&<Button size="small" onClick={start('synthetic')}>合成音频验证</Button>}
  </div>
  <p className="m-0 text-[11px] text-[var(--ww-text-3)]">音频只保存在本地；保存后可转写。</p>
 </div>
 return <Popover content={content} trigger="click" placement="topLeft" arrow={false}>
  <Button type="text" size="small" aria-label={t('media.recordingNote')} icon={<AudioOutlined/>} disabled={disabled}/>
 </Popover>
}

/** 保存后的结果卡：标题、播放器、转写问句与待转写提示（U-31）；可关闭，避免长期挂在输入区 */
function SavedCard(){
 const state=useRecordingState()
 const {pending,later,transcribed,asrConfigured,transcribing}=useRecordingUi()
 const [preview,setPreview]=useState('')
 const [dismissed,setDismissed]=useState(false)
 useEffect(()=>{if(!state.blob){setPreview('');return}const url=URL.createObjectURL(state.blob);setPreview(url);return()=>URL.revokeObjectURL(url)},[state.blob])
 useEffect(()=>{setDismissed(false)},[state.noteId])
 if(dismissed)return null
 const viewNote=()=>{void useUiStore.getState().setView('notes').then(ok=>{if(ok)useUiStore.getState().setActiveNote(state.noteId!)})}
 return <div className="ww-rec-card">
  <div className="flex items-center gap-2 text-sm font-medium"><span>{t('media.recordingSaved',{time:time(state.durationMs)})}</span>
   <Button size="small" type="link" className="!p-0" onClick={viewNote}>{t('media.viewNote')}</Button>
   <span className="flex-1"/>
   <Button size="small" type="text" aria-label={t('common.close')} onClick={()=>setDismissed(true)}>×</Button></div>
  {preview&&<audio className="mt-2 max-w-full" controls src={preview} aria-label="录音预览"/>}
  {asrConfigured&&!transcribed&&(later
   ?<Button size="small" onClick={()=>{useRecordingUi.getState().set({later:false});void actions.transcribe()}}>{t('media.transcribe')}</Button>
   :<div className="mt-2 flex flex-wrap items-center gap-2">
     <span className="text-sm">{t('media.transcribePrompt',{n:pending})}</span>
     <Button size="small" type="primary" loading={transcribing} onClick={()=>void actions.transcribe()}>{t('media.transcribeNow')}</Button>
     <Button size="small" onClick={()=>useRecordingUi.getState().set({later:true})}>{t('media.later')}</Button>
    </div>)}
  {transcribed&&<MinutesSection/>}
 </div>
}

function MinutesSection(){
 const {template,minutesBusy,minutesText}=useRecordingUi()
 return <div className="mt-2">
  <Select size="small" value={template} onChange={v=>useRecordingUi.getState().set({template:v})} options={(['general','interview','lecture'] as const).map(value=>({value,label:t(`media.${value}`)}))}/>
  <Button size="small" className="ml-1" loading={minutesBusy} onClick={()=>void actions.generate()}>{t('media.minutes')}</Button>
  {minutesBusy&&<Button size="small" onClick={()=>void sys('media.cancel_minutes',{recordingNoteId:controller.state.noteId}).catch(e=>message.error(String(e)))}>{t('common.cancel')}</Button>}
  <div className="whitespace-pre-wrap">{minutesText}</div>
 </div>
}

/** 录音进行中/待保存的紧凑条：输入框上方红色计时条（U-12） */
function ActiveStrip({full}:{full?:boolean}){
 const state=useRecordingState()
 const [elapsed,setElapsed]=useState(0)
 const keyPoints=useRecordingUi(s=>s.keyPoints)
 useEffect(()=>{const timer=setInterval(()=>setElapsed(controller.duration()),200);return()=>clearInterval(timer)},[])
 return <>
  {['requesting','stopping','saving'].includes(state.phase)&&<div className="ww-rec-active" role="status">
   <span>{state.phase==='requesting'?'等待设备授权':state.phase==='stopping'?'正在结束录音':'正在保存录音'}</span>
   <span className="flex-1"/>
   {state.phase!=='saving'&&<Button size="small" type="text" onClick={()=>controller.cancel()}>取消录音</Button>}
  </div>}
  {['recording','paused'].includes(state.phase)&&<div className="ww-rec-active" role="status">
   <span className="ww-rec-dot"/>
   <span className="font-medium">{state.phase==='recording'?'录音中':'已暂停'} · {time(state.phase==='recording'?elapsed:state.durationMs)}</span>
   <span className="flex-1"/>
   {state.phase==='recording'&&<Button size="small" type="text" icon={<PauseOutlined/>} onClick={()=>controller.pause()}>暂停</Button>}
   {state.phase==='paused'&&<Button size="small" type="text" onClick={()=>controller.resume()}>继续</Button>}
   <Button size="small" icon={<StopOutlined/>} onClick={()=>controller.finish()}>{t('media.finishRecording')}</Button>
   <Button size="small" type="text" onClick={()=>controller.cancel()}>取消</Button>
  </div>}
  {full&&['recording','paused'].includes(state.phase)&&<Input.TextArea className="mt-2" aria-label={t('media.keyPoints')} maxLength={20000} placeholder={t('media.keyPoints')} value={keyPoints} onChange={e=>useRecordingUi.getState().set({keyPoints:e.target.value})}/>}
  {state.phase==='ready'&&<div className="ww-rec-active" role="status" style={{background:'var(--ww-primary-soft)',borderColor:'var(--ww-border)'}}>
   <span className="font-medium">待保存 · {time(state.durationMs)}</span>
   <span className="flex-1"/>
   <Button size="small" type="primary" onClick={()=>void actions.save()}>{t('media.saveRecording')}</Button>
   <Button size="small" type="text" onClick={()=>controller.cancel()}>取消</Button>
  </div>}
 </>
}

/** 对话输入区上方挂载的精简录音状态：计时条 + 保存后的结果卡 */
export function RecordingStrip(){
 const state=useRecordingState()
 const idle=['idle','error'].includes(state.phase)
 if(idle)return state.error?<Alert type="error" message={state.error} className="mb-2"/>:null
 return <div className="mb-1">
  <ActiveStrip/>
  {state.phase==='saved'&&<SavedCard/>}
  {state.error&&<Alert type="error" message={state.error}/>}
 </div>
}

/** 录音工作区完整面板：语言/开始按钮直接可见（验收 RT-R17-07 按文案定位） */
export default function RecordingControls(){
 const state=useRecordingState()
 const language=useRecordingUi(s=>s.language)
 const synthetic=useRecordingUi(s=>s.synthetic)
 const idle=['idle','saved','error'].includes(state.phase)
 return <div className="ww-recording" aria-label="录音控制">
  {idle&&<div className="flex flex-wrap items-center gap-2">
   <Select aria-label={t('media.language')} value={language} onChange={actions.setLanguage} options={LANGUAGE_OPTIONS} style={{width:130}}/>
   <Button icon={<AudioOutlined/>} onClick={()=>void actions.start('microphone')}>开始录音</Button>
   <Button icon={<PlayCircleOutlined/>} onClick={()=>void actions.start('system')}>系统音频</Button>
   {synthetic&&<Button onClick={()=>void actions.start('synthetic')}>合成音频验证</Button>}
  </div>}
  {!idle&&<ActiveStrip full/>}
  {state.phase==='saved'&&<SavedCard/>}
  {state.phase==='ready'&&<div className="mt-1 text-xs text-[var(--ww-text-3)]">音频只保存在本地；转写需保存后单独发起。</div>}
  {state.error&&<Alert type="error" message={state.error} className="mt-2"/>}
 </div>
}
