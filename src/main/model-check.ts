import assert from 'node:assert/strict'
import http from 'node:http'
import {invokeSys,type SysContext} from './syscalls/registry'
import {getDb,resetDb} from './db/client'
import {clearFlushTimers} from './syscalls/chat'
import {upsertProvider} from './providers/store'
import {chatSelection,type CatalogProvider,type ModelSelection} from './providers/catalog'

/** All transport and credentials in this check are synthetic, on loopback only. */
export async function setupModelFixture(){
  const requests:{provider:string;model:string}[]=[]
  let release:(()=>void)|undefined
  let started:(()=>void)|undefined
  let hold=false
  const server=http.createServer(async(req,res)=>{
    if(req.url?.endsWith('/models')){
      if(req.url.startsWith('/manual')){res.writeHead(404);res.end();return}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'shared-model'},{id:'specific-model'}]}));return
    }
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw)
    requests.push({provider:req.url?.split('/')[1]??'',model:body.model})
    if(hold){started?.();await new Promise<void>(resolve=>{release=resolve})}
    res.setHeader('Content-Type','text/event-stream')
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic reply: '+body.model},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=(server.address() as {port:number}).port
  for(const id of ['alpha','beta','manual'])upsertProvider({id:'openai-compat:'+id,kind:'openai-compat',name:id==='manual'?'Manual endpoint':'Same provider name',baseUrl:`http://127.0.0.1:${port}/${id}/v1`,apiKey:'synthetic-only',models:{fast:['configured-only'],expert:[],defaultFast:'configured-only'}})
  return {requests,hold:()=>{hold=true;return new Promise<void>(resolve=>{started=resolve})},release:()=>{hold=false;release?.()},close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})}
}

export async function runModelChecks(){
  const fixture=await setupModelFixture()
  const completions=new Map<string,(topic:string)=>void>()
  const ctx:SysContext={source:'user',win:()=>null,emit:(topic,payload)=>{if(topic==='chat.done'||topic==='chat.error'){const id=(payload as {chatId:string}).chatId;completions.get(id)?.(topic)}}}
  const sys=async<T>(action:string,payload?:unknown):Promise<T>=>{const r=await invokeSys(action,payload,ctx);if(!r.ok)throw new Error(r.error.message);return r.data as T}
  const wait=(id:string)=>new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Synthetic response timeout')),10000);completions.set(id,topic=>{clearTimeout(t);completions.delete(id);resolve(topic)})})
  const a:ModelSelection={providerId:'openai-compat:alpha',model:'shared-model'}
  const b:ModelSelection={providerId:'openai-compat:beta',model:'specific-model'}
  try{
    const before=getDb().prepare('SELECT id,models,api_key_enc FROM providers ORDER BY id').all()
    const catalog=await sys<{items:CatalogProvider[]}>('provider.models',{refresh:true})
    assert.equal(catalog.items.length,3);assert.equal(catalog.items[0]?.models[0]?.source,'discovered')
    assert.equal(catalog.items[2]?.models[0]?.source,'configured');assert.match(catalog.items[2]!.status,/读取失败/)
    assert.deepEqual(getDb().prepare('SELECT id,models,api_key_enc FROM providers ORDER BY id').all(),before)
    const ca=await sys<{chatId:string}>('chat.create',{selection:a})
    const cb=await sys<{chatId:string}>('chat.create',{selection:b})
    resetDb();assert.deepEqual(chatSelection(ca.chatId),a);assert.deepEqual(chatSelection(cb.chatId),b)
    const run=async(id:string,s:ModelSelection)=>{const done=wait(id);await sys('chat.send',{chatId:id,text:'SYNTHETIC_ROUTE_ONLY',selection:s});assert.equal(await done,'chat.done')}
    await run(ca.chatId,a);await run(cb.chatId,b)
    assert.deepEqual(fixture.requests,[{provider:'alpha',model:'shared-model'},{provider:'beta',model:'specific-model'}])
    const rejected=await invokeSys('chat.send',{chatId:cb.chatId,text:'must not route',selection:a},ctx);assert.equal(rejected.ok,false)
    const started=fixture.hold(),done=wait(ca.chatId)
    await sys('chat.send',{chatId:ca.chatId,text:'SYNTHETIC_HELD',selection:a});await started
    assert.equal((await invokeSys('chat.set_model',{chatId:ca.chatId,selection:b},ctx)).ok,false)
    fixture.release();assert.equal(await done,'chat.done')
    await sys('chat.set_model',{chatId:ca.chatId,selection:b});await run(ca.chatId,b)
    assert.deepEqual(fixture.requests.at(-1),{provider:'beta',model:'specific-model'})
    await sys('provider.save',{id:b.providerId,name:'Same provider name',enabled:false})
    assert.equal((await invokeSys('chat.send',{chatId:ca.chatId,text:'must not route',selection:b},ctx)).ok,false)
    await sys('provider.save',{id:b.providerId,name:'Same provider name',enabled:true})
    await sys('provider.save',{id:b.providerId,name:'Same provider name',models:{fast:[],expert:[]}})
    assert.equal((await invokeSys('chat.set_model',{chatId:ca.chatId,selection:{...b,model:'configured-only'}},ctx)).ok,false)
    const manual={providerId:'openai-compat:manual',model:'configured-only'}
    await sys('chat.set_model',{chatId:ca.chatId,selection:manual});await run(ca.chatId,manual)
    assert.deepEqual(fixture.requests.at(-1),{provider:'manual',model:'configured-only'})
    const legacy=await sys<{chatId:string}>('chat.create',{})
    assert.equal((await invokeSys('chat.send',{chatId:legacy.chatId,text:'no implicit fallback',selection:a},ctx)).ok,false)
    assert.equal((await sys<{messages:unknown[]}>('chat.messages',{chatId:legacy.chatId})).messages.length,0)
    await sys('provider.delete',{id:manual.providerId})
    assert.equal((await invokeSys('chat.send',{chatId:ca.chatId,text:'deleted provider',selection:manual},ctx)).ok,false)
    console.log('[MODEL-CHECK] PASS: real loopback HTTP catalog + chat.send routing, duplicate names, persistence, stream lock, disabled/deleted/removed model rejection, configured fallback, no legacy auto-route, credential/config preservation')
    console.log('[MODEL-CHECK] Synthetic inference requests:',fixture.requests.length,'; real provider inference requests: 0')
  }finally{fixture.release();clearFlushTimers();await fixture.close()}
}
