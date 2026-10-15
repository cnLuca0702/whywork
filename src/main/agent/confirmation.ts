import crypto from 'node:crypto'
import type { SysContext } from '../syscalls/registry'
const writes=new Map<string,number>()
export function clearConfirmations(chatId:string):void {
  writes.delete(chatId)
  for(const p of pending.values())if(p.chatId===chatId)p.resolve(false)
}
const pending = new Map<string, {chatId:string;resolve:(approved:boolean)=>void}>()
export function respondConfirmation(id:string, chatId:string, approved:boolean): void {
  const p = pending.get(id)
  if (!p || p.chatId !== chatId) throw new Error('确认请求已失效')
  p.resolve(approved)
}
export async function requireToolConfirmation(name:string, args:string, ctx:SysContext):Promise<void> {
  if (ctx.source !== 'agent') return
  // Remote MCP tools have no trustworthy write classification. Always ask first.
  let bulk=false
  if(ctx.chatId && ['notes.create','notes.update','file.write','notes.delete','file.delete','file.move'].includes(name)){
    const count=(writes.get(ctx.chatId)??0)+1;writes.set(ctx.chatId,count);bulk=count>5
  }
  if (!bulk && !['notes.delete','file.delete','file.move','file.write','browser.eval','mail.send'].includes(name) && !name.startsWith('mcp__')) return
  if (!ctx.chatId) throw new Error('缺少会话上下文')
  const id = crypto.randomUUID()
  const approved = await new Promise<boolean>(resolve => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => finish(false)
    const finish = (value:boolean) => {
      clearTimeout(timer); ctx.signal?.removeEventListener('abort',onAbort)
      pending.delete(id); resolve(value)
    }
    pending.set(id,{ chatId:ctx.chatId!, resolve:finish })
    timer = setTimeout(() => finish(false), 120_000)
    ctx.signal?.addEventListener('abort',onAbort,{once:true})
    if (ctx.signal?.aborted) { finish(false); return }
    ctx.emit('chat.confirm', {id,chatId:ctx.chatId,name,args})
  })
  if (!approved) throw new Error('用户未批准工具操作或操作已取消')
}
