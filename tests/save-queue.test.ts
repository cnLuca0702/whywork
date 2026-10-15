import {expect,it} from 'vitest'
import {queueNoteSave,pendingNoteSave} from '../src/renderer/src/editor/save-queue'
it('serializes writes across editor instances and lets reload await all pending writes',async()=>{
  const order:string[]=[];let release:()=>void=()=>{}
  const first=queueNoteSave('synthetic-a',async()=>{await new Promise<void>(r=>{release=r});order.push('first')})
  const second=queueNoteSave('synthetic-a',async()=>{order.push('second')})
  await Promise.resolve();await Promise.resolve();release()
  await pendingNoteSave('synthetic-a');await Promise.all([first,second]);expect(order).toEqual(['first','second'])
})
it('a failed save does not prevent a later retry and other notes remain independent',async()=>{
  await expect(queueNoteSave('synthetic-b',async()=>{throw new Error('disk-full')})).rejects.toThrow('disk-full')
  let saved=false
  await queueNoteSave('synthetic-b',async()=>{saved=true});await pendingNoteSave('synthetic-b');expect(saved).toBe(true)
  await queueNoteSave('synthetic-c',async()=>undefined)
})
