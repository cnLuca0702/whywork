import crypto from 'node:crypto'
import {getDb} from '../db/client'
import {validateActionPayload,type SysContext} from '../syscalls/registry'
import {confirmationPreview,applyConfirmationOverride} from './confirmation-preview'
import type {ConfirmCardData} from '../../shared/confirmation'
const writes=new Map<string,{name:string;target:string}[]>()
type Decision={state:'allowed'|'denied'|'cancelled';args?:Record<string,unknown>}
const pending=new Map<string,{chatId:string;name:string;args:Record<string,unknown>;resolve:(decision:Decision)=>void}>()
function preview(name:string,args:Record<string,unknown>,bulk:boolean){
 const result=confirmationPreview(name,args,bulk)
 if(typeof args.noteId==='string'){
  const note=getDb().prepare('SELECT title FROM notes WHERE note_id=?').get(args.noteId) as {title:string}|undefined
  if(note)result.fields=result.fields.map(field=>field.value===args.noteId?{...field,value:note.title}:field)
 }
 return result
}
function save(card:ConfirmCardData){
 const db=getDb()
 if(!db.prepare('SELECT 1 FROM chats WHERE chat_id=?').get(card.chatId))return
 db.prepare('INSERT INTO chat_confirmations(id,chat_id,preview,state,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,preview=excluded.preview').run(card.id,card.chatId,JSON.stringify(card.preview),card.state,Date.now())
}
export function clearConfirmations(chatId:string):void {
 writes.delete(chatId)
 for(const p of pending.values())if(p.chatId===chatId)p.resolve({state:'cancelled'})
}
export function respondConfirmation(id:string,chatId:string,approved:boolean,override?:Record<string,unknown>):void{
 const p=pending.get(id)
 if(!p||p.chatId!==chatId)throw new Error('确认请求已失效')
 const args=approved?applyConfirmationOverride(p.name,p.args,override):p.args
 if(approved&&!p.name.startsWith('mcp__'))validateActionPayload(p.name,args)
 p.resolve({state:approved?'allowed':'denied',args})
}
export async function requireToolConfirmation(name:string,argsJson:string,ctx:SysContext):Promise<string>{
 if(ctx.source!=='agent')return argsJson
 let bulk=false
 if(ctx.chatId&&['notes.create','notes.update','file.write','notes.delete','file.delete','file.move','notes.set_status','collections.add_note','collections.remove_note','notes.attach_image'].includes(name)){
  const history=writes.get(ctx.chatId)??[],params=JSON.parse(argsJson||'{}') as Record<string,unknown>
  let target=String(params.path??params.from??params.noteId??params.title??'')
  if(params.noteId){const note=getDb().prepare('SELECT title FROM notes WHERE note_id=?').get(params.noteId) as {title:string}|undefined;target=note?.title??target}
  history.push({name,target});writes.set(ctx.chatId,history);bulk=history.length>5
 }
 if(!bulk&&!['notes.delete','file.delete','file.move','file.write','browser.eval','mail.send','mcp.call'].includes(name)&&!name.startsWith('mcp__'))return argsJson
 if(!ctx.chatId)throw new Error('缺少会话上下文')
 if([...pending.values()].some(p=>p.chatId===ctx.chatId))throw new Error('请先处理当前确认卡')
 const args=JSON.parse(argsJson||'{}') as Record<string,unknown>
 const card:ConfirmCardData={id:crypto.randomUUID(),chatId:ctx.chatId,preview:preview(name,args,bulk),state:'pending'}
 if(bulk){const history=writes.get(ctx.chatId)!;card.preview.fields.unshift({label:'本轮写操作请求数',value:String(history.length)},{label:'前5项',value:history.slice(0,5).map((entry,i)=>`${i+1}. ${entry.target}`).join('；')})}
 save(card)
 const decision=await new Promise<Decision>(resolve=>{
  let timer:ReturnType<typeof setTimeout>
  const onAbort=()=>finish({state:'cancelled'})
  const finish=(value:Decision)=>{
   clearTimeout(timer);ctx.signal?.removeEventListener('abort',onAbort);pending.delete(card.id)
   card.state=value.state
   if(value.args&&name==='mail.send')card.preview=preview(name,value.args,bulk)
   save(card);ctx.emit('chat.confirm_resolved',card);resolve(value)
  }
  pending.set(card.id,{chatId:card.chatId,name,args,resolve:finish})
  timer=setTimeout(()=>finish({state:'cancelled'}),120000)
  ctx.signal?.addEventListener('abort',onAbort,{once:true})
  if(ctx.signal?.aborted){finish({state:'cancelled'});return}
  ctx.emit('chat.confirm',{...card,name,args:argsJson})
 })
 if(decision.state!=='allowed')throw new Error('用户未批准工具操作或操作已取消')
 return JSON.stringify(decision.args??args)
}
