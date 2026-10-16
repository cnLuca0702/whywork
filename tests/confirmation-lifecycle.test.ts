import {afterEach,expect,it,vi} from 'vitest'
vi.mock('../src/main/db/client',()=>({getDb:()=>({prepare:()=>({get:()=>undefined})})}))
vi.mock('../src/main/syscalls/registry',()=>({validateActionPayload:vi.fn((_action,p)=>{if(p.to&&!p.to.includes('@'))throw new Error('invalid address');return p})}))
import {requireToolConfirmation,respondConfirmation,clearConfirmations} from '../src/main/agent/confirmation'
import type {SysContext} from '../src/main/syscalls/registry'
afterEach(()=>clearConfirmations('c'))
it('revalidates edits before resolving and binds approval to the original chat',async()=>{
 let id=''
 const events:string[]=[]
 const ctx:SysContext={source:'agent',chatId:'c',win:()=>null,emit:(topic,p)=>{events.push(topic);if(topic==='chat.confirm')id=(p as {id:string}).id}}
 const result=requireToolConfirmation('mail.send',JSON.stringify({id:'account',to:'a@example.com',subject:'old',text:'body'}),ctx)
 expect(()=>respondConfirmation(id,'other',true)).toThrow('失效')
 expect(()=>respondConfirmation(id,'c',true,{to:'invalid'})).toThrow('invalid')
 respondConfirmation(id,'c',true,{to:'b@example.com',subject:'edited'})
 expect(JSON.parse(await result).subject).toBe('edited')
 expect(events).toEqual(['chat.confirm','chat.confirm_resolved'])
 expect(()=>respondConfirmation(id,'c',true)).toThrow('失效')
})
it('cancels pending cards on abort and never executes an approval afterward',async()=>{
 let id='';const ac=new AbortController(),states:string[]=[]
 const ctx:SysContext={source:'agent',chatId:'c',signal:ac.signal,win:()=>null,emit:(topic,p)=>{if(topic==='chat.confirm')id=(p as {id:string}).id;else states.push((p as {state:string}).state)}}
 const result=requireToolConfirmation('file.write','{"path":"test","content":"value"}',ctx)
 ac.abort();await expect(result).rejects.toThrow('取消')
 expect(states).toEqual(['cancelled'])
 expect(()=>respondConfirmation(id,'c',true)).toThrow('失效')
})
