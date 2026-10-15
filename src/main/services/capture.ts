import { app, globalShortcut } from 'electron'
import { invokeSys, type SysContext } from '../syscalls/registry'
const queued:string[]=[]
export function parseCaptureUrl(raw:string):string|null {
  try {
    const u=new URL(raw)
    if(!['whywork:','myremio:'].includes(u.protocol)||!['clip','import'].includes(u.hostname))return null
    const target=u.searchParams.get('url');if(!target)return null
    const t=new URL(target);if(!['http:','https:'].includes(t.protocol))return null
    return t.href
  }catch{return null}
}
export function queueCaptureUrl(raw:string):void{const u=parseCaptureUrl(raw);if(u)queued.push(u)}
export function flushCaptureUrls(ctx:SysContext):void {
  for(const url of queued.splice(0))ctx.emit('app.capture_requested',{url})
}
export function registerCaptureShortcuts(ctx:SysContext,show:()=>void):void {
  if(app.isPackaged)app.setAsDefaultProtocolClient('whywork')
  globalShortcut.register('CommandOrControl+Alt+Space',()=>{show();ctx.emit('chat.focus',{})})
  globalShortcut.register('CommandOrControl+Alt+N',()=>{
    show();void invokeSys('notes.create',{title:'未命名笔记',body:''},ctx).then(r=>{
      if(r.ok)ctx.emit('notes.open_requested',r.data)
    })
  })
  app.once('will-quit',()=>globalShortcut.unregisterAll())
}
