import {afterEach,expect,it,vi} from 'vitest'
import {createAnthropic,anthropicMessages} from '../src/main/providers/anthropic'
import type {StreamEvent} from '../src/main/providers/types'
afterEach(()=>vi.unstubAllGlobals())
it('maps system, tool use and grouped tool results to Anthropic messages',()=>{
  const result=anthropicMessages([{role:'system',content:'system'},{role:'assistant',content:null,tool_calls:[{id:'t',type:'function',function:{name:'notes__search',arguments:'{"query":"test"}'}}]},
    {role:'tool',content:'result',tool_call_id:'t'},{role:'user',content:'continue'}])
  expect(result).toEqual([{role:'assistant',content:[{type:'tool_use',id:'t',name:'notes__search',input:{query:'test'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'result'},{type:'text',text:'continue'}]}])
})
it('accumulates streamed tool arguments and rejects premature stream termination',async()=>{
  const p=createAnthropic({id:'a',name:'A',baseUrl:'https://synthetic.invalid',apiKey:()=> 'synthetic'})
  const frames=[{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool1',name:'notes__search',input:{}}},
    {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"query":"中文"}'}},
    {type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}]
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(frames.map(f=>'data: '+JSON.stringify(f)).join('\n')+'\n')))
  const events:StreamEvent[]=[]
  expect(await p.stream({model:'synthetic',messages:[],signal:new AbortController().signal},e=>events.push(e))).toEqual({finishReason:'tool_use'})
  expect(events).toContainEqual({type:'tool_call',id:'tool1',name:'notes__search',argsJson:'{"query":"中文"}'})
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"message_start"}\n')))
  await expect(p.stream({model:'synthetic',messages:[],signal:new AbortController().signal},()=>undefined)).rejects.toThrow('中断')
})
