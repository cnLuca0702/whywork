import {afterEach,expect,it,vi} from 'vitest'
import {createOpenAICompat} from '../src/main/providers/openai-compat'
import {createAnthropic} from '../src/main/providers/anthropic'
import type {StreamEvent} from '../src/main/providers/types'
afterEach(()=>vi.unstubAllGlobals())
it.each(['openai','anthropic'])('streams %s reasoning separately from the answer',async kind=>{
 const frames=kind==='openai'
 ?[{choices:[{delta:{reasoning_content:'供应商返回的推理',content:'答案'}}]},{choices:[{delta:{},finish_reason:'stop'}]}]
 :[{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'供应商返回的推理'}},{type:'content_block_delta',delta:{type:'text_delta',text:'答案'}},{type:'message_stop'}]
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(frames.map(f=>'data: '+JSON.stringify(f)).join('\n')+'\n')))
 const provider=(kind==='openai'?createOpenAICompat:createAnthropic)({id:'test',name:'test',baseUrl:'https://synthetic.invalid',apiKey:()=> 'synthetic'})
 const events:StreamEvent[]=[]
 await provider.stream({model:'test',messages:[],signal:new AbortController().signal},e=>events.push(e))
 expect(events).toEqual([{type:'reasoning',delta:'供应商返回的推理'},{type:'text',delta:'答案'}])
})
