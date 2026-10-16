import type { ChatProvider, ChatMessage, StreamRequest, StreamEvent } from './types'
import { ProviderError } from './types'
import type { OpenAICompatConfig } from './openai-compat'
export function anthropicMessages(messages:ChatMessage[]):{role:string;content:unknown[]}[] {
  const out:{role:string;content:unknown[]}[]=[]
  for(const m of messages) {
    if(m.role==='system')continue
    const role=m.role==='assistant'?'assistant':'user'
    const content:unknown[]=[]
    if(m.role==='tool')content.push({type:'tool_result',tool_use_id:m.tool_call_id,content:m.content??''})
    else {
      if(m.content)content.push({type:'text',text:m.content})
      for(const t of m.tool_calls??[])content.push({type:'tool_use',id:t.id,name:t.function.name,input:JSON.parse(t.function.arguments||'{}')})
    }
    if(!content.length)continue
    const prev=out.at(-1)
    if(prev?.role===role)prev.content.push(...content)
    else out.push({role,content})
  }
  return out
}
export function createAnthropic(cfg:OpenAICompatConfig):ChatProvider {
  const base=cfg.baseUrl.replace(/\/$/,'').replace(/\/v1$/,'')
  const headers=()=>{
    const key=cfg.apiKey();if(!key)throw new ProviderError('NO_PROVIDER','Anthropic 未配置 API Key')
    return {'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'}
  }
  return {
    id:cfg.id,name:cfg.name,
    async listModels(){
      const r=await fetch(base+'/v1/models',{headers:headers(),signal:AbortSignal.timeout(10_000)})
      if(!r.ok)throw new ProviderError('PROVIDER_ERROR',`Anthropic HTTP ${r.status}`)
      const j=await r.json() as {data?:{id:string}[]};return (j.data??[]).map(m=>m.id)
    },
    async stream(req:StreamRequest,emit:(e:StreamEvent)=>void){
      const body={model:req.model,max_tokens:8192,stream:true,
        system:req.messages.filter(m=>m.role==='system').map(m=>m.content??'').join('\n'),
        messages:anthropicMessages(req.messages),
        ...(req.tools?.length?{tools:req.tools.map(t=>({name:t.function.name,description:t.function.description,input_schema:t.function.parameters}))}:{})}
      let r:Response
      try {r=await fetch(base+'/v1/messages',{method:'POST',headers:headers(),body:JSON.stringify(body),signal:req.signal})}
      catch(e){throw new ProviderError(req.signal.aborted?'ABORTED':'NETWORK_ERROR',req.signal.aborted?'已取消':String(e))}
      if(!r.ok||!r.body)throw new ProviderError('PROVIDER_ERROR',`Anthropic HTTP ${r.status}`)
      const tools=new Map<number,{id:string;name:string;json:string;input:unknown}>()
      let completed=false,finishReason:'stop'|'tool_use'|'length'='stop'
      const handle=(line:string)=>{
        if(!line.startsWith('data:'))return
        const j=JSON.parse(line.slice(5).trim())
        if(j.type==='error')throw new ProviderError('PROVIDER_ERROR',j.error?.message??'Anthropic 流错误')
        if(j.type==='content_block_start'&&j.content_block?.type==='tool_use')
          tools.set(j.index,{id:j.content_block.id,name:j.content_block.name,json:'',input:j.content_block.input})
        if(j.type==='content_block_delta') {
          if(j.delta?.type==='thinking_delta')emit({type:'reasoning',delta:j.delta.thinking})
          if(j.delta?.type==='text_delta')emit({type:'text',delta:j.delta.text})
          if(j.delta?.type==='input_json_delta') {const t=tools.get(j.index);if(t)t.json+=j.delta.partial_json}
        }
        if(j.type==='message_delta') {
          if(j.delta?.stop_reason==='tool_use')finishReason='tool_use'
          if(j.delta?.stop_reason==='max_tokens')finishReason='length'
          if(j.usage)emit({type:'usage',input:0,output:j.usage.output_tokens??0})
        }
        if(j.type==='message_stop')completed=true
      }
      const reader=r.body.getReader(),decoder=new TextDecoder();let buffer=''
      try {
        for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true})
          let at:number;while((at=buffer.indexOf('\n'))>=0){handle(buffer.slice(0,at).trim());buffer=buffer.slice(at+1)}}
        buffer+=decoder.decode();if(buffer.trim())handle(buffer.trim())
        if(!completed)throw new ProviderError('NETWORK_ERROR','Anthropic 流在结束标记前中断')
        for(const t of tools.values())emit({type:'tool_call',id:t.id,name:t.name,argsJson:t.json||JSON.stringify(t.input??{})})
        return{finishReason}
      }catch(e){if(req.signal.aborted)throw new ProviderError('ABORTED','已取消');throw e}
      finally{reader.releaseLock()}
    }
  }
}
