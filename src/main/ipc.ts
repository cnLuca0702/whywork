import {ipcMain,BrowserWindow} from 'electron'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {SysRequest,SysResult} from '../shared/types'
import {invokeSys} from './syscalls/registry'
import {abortChat} from './agent/loop'
function trusted(url:string):boolean {
  try {
    const u=new URL(url)
    if(process.env.ELECTRON_RENDERER_URL&&u.origin===new URL(process.env.ELECTRON_RENDERER_URL).origin)return true
    return u.protocol==='file:'&&fileURLToPath(u).split('#')[0]===path.join(__dirname,'../renderer/index.html')
  }catch{return false}
}
export function wireIpc(_getWin:()=>BrowserWindow|null):void {
  ipcMain.handle('sys:invoke',(event,req:SysRequest):Promise<SysResult>=>{
    if(!trusted(event.sender.getURL())||event.senderFrame?.routingId!==event.sender.mainFrame.routingId)
      return Promise.resolve({ok:false,error:{code:'FORBIDDEN',message:'不允许的调用来源'}})
    if(!req||typeof req.action!=='string')return Promise.resolve({ok:false,error:{code:'BAD_PAYLOAD',message:'非法请求'}})
    const win=BrowserWindow.fromWebContents(event.sender)
    return invokeSys(req.action,req.payload,{win:()=>win,source:'user',emit:(topic,payload)=>sendEvent(win,topic,payload)})
  })
  ipcMain.on('sys:stream',(event,msg:{op:string;chatId?:string})=>{
    if(!trusted(event.sender.getURL()))return
    if(msg?.op==='abort'&&msg.chatId)abortChat(msg.chatId)
  })
}
export function sendEvent(win:BrowserWindow|null,topic:string,payload:unknown):void {
  if(win&&!win.isDestroyed())win.webContents.send('sys:event',{topic,payload})
}
