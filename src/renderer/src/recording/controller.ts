export type RecordingMode='microphone'|'system'|'synthetic'
export type RecordingPhase='idle'|'requesting'|'recording'|'paused'|'stopping'|'ready'|'saving'|'saved'|'error'
export interface RecordingState{phase:RecordingPhase;mode:RecordingMode;durationMs:number;blob:Blob|null;error:string;id:string;noteId?:string;path?:string;segmentOf?:string;segmentIndex?:number}
export interface AudioSource{stream:MediaStream;release?:()=>void}
export interface RecorderLike {
 state:'inactive'|'recording'|'paused';mimeType:string
 ondataavailable:((e:BlobEvent)=>void)|null;onstop:((e:Event)=>void)|null;onerror:((e:ErrorEvent)=>void)|null
 start:(timeslice?:number)=>void;pause:()=>void;resume:()=>void;stop:()=>void
}
export class RecordingController{
 state:RecordingState={phase:'idle',mode:'microphone',durationMs:0,blob:null,error:'',id:''}
 private segmentSaver:((state:RecordingState)=>Promise<{noteId:string;path:string}>)|null=null;private segmentLimit=48*1024*1024;private splitting=false;private bytes=0
 setSegmentSaver(saver:(state:RecordingState)=>Promise<{noteId:string;path:string}>,limit=48*1024*1024){this.segmentSaver=saver;this.segmentLimit=limit}
 private recorder:RecorderLike|null=null;private source:AudioSource|null=null;private chunks:Blob[]=[];private epoch=0;private elapsed=0;private began=0;private listeners=new Set<(s:RecordingState)=>void>()
 constructor(private create:(stream:MediaStream)=>RecorderLike,private now=()=>performance.now()){}
 subscribe(fn:(s:RecordingState)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private set(patch:Partial<RecordingState>){this.state={...this.state,...patch};for(const fn of this.listeners)fn(this.state)}
 duration(){return this.elapsed+(this.state.phase==='recording'?this.now()-this.began:0)}
 private freeze(){if(this.state.phase==='recording')this.elapsed+=this.now()-this.began}
 private release(){const source=this.source;this.source=null;if(source){for(const t of source.stream.getTracks()){t.onended=null;t.stop()}source.release?.()}}
 async start(mode:RecordingMode,acquire:()=>Promise<AudioSource>,segment?:{segmentOf:string;segmentIndex:number}){
  if(!['idle','saved','error'].includes(this.state.phase))return
  const epoch=++this.epoch;this.elapsed=0;this.chunks=[];this.bytes=0;this.splitting=false
  this.set({phase:'requesting',mode,durationMs:0,blob:null,error:'',id:crypto.randomUUID(),noteId:undefined,path:undefined,segmentOf:segment?.segmentOf??crypto.randomUUID(),segmentIndex:segment?.segmentIndex??1})
  try{
   const source=await acquire()
   if(epoch!==this.epoch){source.stream.getTracks().forEach(t=>t.stop());source.release?.();return}
   this.source=source
   if(!source.stream.getAudioTracks().length)throw new Error('没有音轨，录音未开始')
   const rec=this.create(new MediaStream(source.stream.getAudioTracks()));this.recorder=rec
   rec.ondataavailable=e=>{if(epoch!==this.epoch||!e.data.size)return;this.chunks.push(e.data);this.bytes+=e.data.size;if(this.segmentSaver&&this.bytes>=this.segmentLimit&&this.state.phase==='recording'){this.splitting=true;this.finish()}}
   rec.onerror=()=>{if(epoch===this.epoch)this.fail('录音设备或编码器异常，未保存文件')}
   rec.onstop=()=>{
    if(epoch!==this.epoch)return
    this.freeze();const blob=new Blob(this.chunks,{type:rec.mimeType||'audio/webm'})
    const valid=blob.size>0&&this.elapsed>=1000
    this.set({phase:valid?'ready':'error',durationMs:this.elapsed,blob:valid?blob:null,error:valid?'':this.elapsed<1000?'录音过短，请至少录制1秒':'未取得音频数据，请重新录制'})
    this.recorder=null;this.chunks=[]
    if(this.splitting&&valid&&this.segmentSaver){
      const held=this.source;this.source=null
      const segment={segmentOf:this.state.segmentOf!,segmentIndex:this.state.segmentIndex!+1}
      void this.save(this.segmentSaver).then(async()=>{
        if(epoch===this.epoch&&this.state.phase==='saved'&&held)await this.start(mode,async()=>held,segment)
        else if(held){held.stream.getTracks().forEach(t=>t.stop());held.release?.()}
      })
    }else this.release()
   }
   for(const t of source.stream.getTracks())t.onended=()=>{if(epoch===this.epoch)this.finish()}
   rec.start(1000);this.began=this.now();this.set({phase:'recording'})
  }catch(e){
    if(epoch!==this.epoch)return
    const name=e instanceof DOMException?e.name:''
    const msg=e instanceof Error?e.message:String(e)
    const hint=name==='NotAllowedError'||name==='SecurityError'
      ?'麦克风权限不足：请在 系统设置 → 隐私与安全性 → 麦克风 中允许 WhyWork 后重试；本应用不会隐式申请其他权限。'
      :name==='NotFoundError'?'未找到可用麦克风设备，请检查系统输入设备设置。'
      :`录音未开始：${msg}。请检查设备和既有授权。`
    this.fail(hint)
  }
 }
 pause(){if(this.state.phase!=='recording')return;try{this.recorder!.pause();this.freeze();this.set({phase:'paused',durationMs:this.elapsed})}catch{this.fail('暂停失败，录音已停止且未保存')}}
 resume(){if(this.state.phase!=='paused')return;try{this.recorder!.resume();this.began=this.now();this.set({phase:'recording'})}catch{this.fail('继续录音失败，未保存')}}
 finish(){if(!['recording','paused'].includes(this.state.phase))return;this.freeze();this.set({phase:'stopping',durationMs:this.elapsed});try{this.recorder!.stop()}catch{this.fail('结束录音失败，未保存')}}
 cancel(){if(this.state.phase==='saving')return;this.epoch++;const rec=this.recorder;this.recorder=null;if(rec&&rec.state!=='inactive'){try{rec.stop()}catch{/* already stopped */}}this.release();this.chunks=[];this.elapsed=0;this.set({phase:'idle',durationMs:0,blob:null,error:'',noteId:undefined,path:undefined})}
 private fail(error:string){this.epoch++;const rec=this.recorder;this.recorder=null;if(rec&&rec.state!=='inactive'){try{rec.stop()}catch{/* device failure */}}this.release();this.chunks=[];this.set({phase:'error',error,blob:null,durationMs:this.elapsed})}
 async save(saver:(state:RecordingState)=>Promise<{noteId:string;path:string}>){
  if(this.state.phase!=='ready'||!this.state.blob)return
  const snapshot=this.state;this.set({phase:'saving',error:''})
  try{const result=await saver(snapshot);this.set({phase:'saved',...result})}catch(e){this.set({phase:'ready',error:`保存失败，可重试或取消：${String(e)}`})}
 }
 dispose(){this.listeners.clear();if(this.state.phase==='saving'){this.epoch++;this.release()}else this.cancel()}
}
