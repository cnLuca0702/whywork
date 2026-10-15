import {afterEach,expect,it,vi} from 'vitest'
import {RecordingController,type RecorderLike,type AudioSource} from '../src/renderer/src/recording/controller'
function fixture(){
 let now=0
 const track={stop:vi.fn(),onended:null},stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream
 vi.stubGlobal('MediaStream',class{constructor(public tracks:unknown[]){}getTracks(){return this.tracks}})
 const rec:RecorderLike={state:'inactive',mimeType:'audio/webm',ondataavailable:null,onstop:null,onerror:null,start(){this.state='recording'},pause(){this.state='paused'},resume(){this.state='recording'},stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic test bytes'])} as BlobEvent);this.onstop?.(new Event('stop'))}}
 const release=vi.fn(),c=new RecordingController(()=>rec,()=>now)
 return{c,rec,stream,track,release,source:()=>Promise.resolve({stream,release}),advance:(ms:number)=>{now+=ms}}
}
afterEach(()=>vi.unstubAllGlobals())
it('pause excludes paused time, resume accumulates only active time, finish releases tracks',async()=>{
 const f=fixture();await f.c.start('microphone',f.source);f.advance(1200);f.c.pause();f.advance(5000);expect(f.c.duration()).toBe(1200)
 f.c.resume();f.advance(800);f.c.finish();expect(f.c.state.phase).toBe('ready');expect(f.c.state.durationMs).toBe(2000);expect(f.c.state.blob?.size).toBeGreaterThan(0);expect(f.track.stop).toHaveBeenCalledOnce()
})
it('cancel during permission wait discards a later stream without starting a recorder',async()=>{
 const f=fixture();let resolve!:(s:AudioSource)=>void;const pending=f.c.start('system',()=>new Promise(r=>resolve=r));f.c.cancel();resolve({stream:f.stream,release:f.release});await pending
 expect(f.c.state.phase).toBe('idle');expect(f.rec.state).toBe('inactive');expect(f.track.stop).toHaveBeenCalledOnce()
})
it('cancel never offers or saves buffered audio',async()=>{
 const f=fixture();await f.c.start('microphone',f.source);f.c.cancel();expect(f.c.state.blob).toBeNull();expect(f.c.state.phase).toBe('idle');const save=vi.fn();await f.c.save(save);expect(save).not.toHaveBeenCalled()
})
it('save failure retains audio for retry and duplicate clicks cannot save twice',async()=>{
 const f=fixture();await f.c.start('microphone',f.source);f.c.finish();const blob=f.c.state.blob
 await f.c.save(async()=>{throw new Error('disk full')});expect(f.c.state.phase).toBe('ready');expect(f.c.state.blob).toBe(blob)
 let resolve!:(x:{noteId:string;path:string})=>void;const save=vi.fn(()=>new Promise<{noteId:string;path:string}>(r=>resolve=r));const pending=f.c.save(save);await f.c.save(save);f.c.cancel();expect(f.c.state.phase).toBe('saving');resolve({noteId:'n',path:'p'});await pending;expect(save).toHaveBeenCalledOnce();expect(f.c.state.phase).toBe('saved')
})
it('device failure stops tracks and reports an error without saving',async()=>{
 const f=fixture();await f.c.start('system',f.source);f.rec.onerror?.(new Event('error') as ErrorEvent);expect(f.c.state.phase).toBe('error');expect(f.track.stop).toHaveBeenCalledOnce();expect(f.c.state.blob).toBeNull()
})
