import {getSetting} from '../syscalls/settings'
import {shortcutDefaults,validateShortcuts} from './shortcut-validation'
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
let shortcutHandlers:{focusChat:()=>void;newNote:()=>void}|undefined
let current={...shortcutDefaults}
export function configureShortcuts(pair:typeof shortcutDefaults){
 const next=validateShortcuts(pair),old=current
 if(!shortcutHandlers){current=next;return()=>{current=old}}
 const handlers=shortcutHandlers
 for(const value of Object.values(old))globalShortcut.unregister(value)
 const restore=()=>{for(const value of Object.values(next))globalShortcut.unregister(value);for(const key of ['focusChat','newNote'] as const)globalShortcut.register(old[key],handlers[key]);current=old}
 try{for(const key of ['focusChat','newNote'] as const)if(!globalShortcut.register(next[key],handlers[key]))throw new Error('快捷键已被其他应用占用');current=next;return restore}catch(e){restore();throw e}
}
export function registerCaptureShortcuts(ctx:SysContext,show:()=>void):void {
 if(app.isPackaged)app.setAsDefaultProtocolClient('whywork')
 shortcutHandlers={focusChat:()=>{show();ctx.emit('chat.focus',{})},newNote:()=>{show();void invokeSys('notes.create',{title:'未命名笔记',body:''},ctx).then(r=>{if(r.ok)ctx.emit('notes.open_requested',r.data)})}}
 try{configureShortcuts({focusChat:getSetting('shortcuts.focusChat')??shortcutDefaults.focusChat,newNote:getSetting('shortcuts.newNote')??shortcutDefaults.newNote})}catch(e){console.error('快捷键注册失败',e)}
 app.once('will-quit',()=>globalShortcut.unregisterAll())
}
