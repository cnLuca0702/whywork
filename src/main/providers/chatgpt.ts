import {parseChatGPTCatalog} from './catalog-format'
import { encryptSecret, decryptSecret } from '../security/secrets'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { shell, app } from 'electron'
import type { ChatProvider, StreamEvent, StreamRequest } from './types'
import { ProviderError } from './types'
import type { ProviderRow } from './store'
import { getDb } from '../db/client'
import { getWorkspacePath } from '../syscalls/app'
import {AUTH_ISSUER,TOKEN_ENDPOINT,RESOURCE,createAttempt,authorizationUrl,callbackGrant,exchangeBody,verifyIdentity,planAllowed,safeErrorCode,type LoginAttempt} from './chatgpt-oauth'

// Official SIWC local-app dynamic registration. No borrowed client ID or private backend API.
interface Tokens {access_token:string;refresh_token:string;id_token:string;client_id:string;subject:string;email?:string;scopes:string[];expires_at:number}
interface Extra {oauthVersion?:number;tokensEnc?:string|null;registration?:{clientId:string;subject:string}}
interface TokenResponse {access_token?:string;refresh_token?:string;id_token?:string;token_type?:string;expires_in?:number;scope?:string}
const API_BASE=RESOURCE
let cancelPending:(()=>void)|undefined,authEpoch=0
const refreshing=new Map<string,Promise<Tokens>>()
function row():ProviderRow|undefined{return getDb().prepare("SELECT * FROM providers WHERE id='chatgpt'").get() as ProviderRow|undefined}
function extra(r=row()):Extra{try{return JSON.parse(r?.extra||'{}') as Extra}catch{return{}}}
function readTokens(r=row()):Tokens|undefined{const e=extra(r);if(e.oauthVersion!==2||!e.tokensEnc)return;return JSON.parse(decryptSecret(e.tokensEnc)) as Tokens}
function saveTokens(t:Tokens){
 const encoded=encryptSecret(JSON.stringify(t))
 getDb().prepare("UPDATE providers SET extra=? WHERE id='chatgpt'").run(JSON.stringify({oauthVersion:2,tokensEnc:encoded,registration:{clientId:t.client_id,subject:t.subject}}))
}
function hostId():string{
 const file=path.join(app.getPath('userData'),'whywork-chatgpt-host.json')
 if(fs.existsSync(file)){const value=JSON.parse(fs.readFileSync(file,'utf8')) as {id?:string};if(value.id?.match(/^urn:uuid:[0-9a-f-]{36}$/i))return value.id;throw new Error('本机登录标识损坏，未启动授权')}
 const id='urn:uuid:'+crypto.randomUUID();fs.writeFileSync(file,JSON.stringify({id}),{flag:'wx',mode:0o600});return id
}
class OAuthError extends ProviderError {constructor(readonly oauthCode:string,status:number){super('PROVIDER_ERROR',`ChatGPT 授权 HTTP ${status}（${oauthCode}）。请关闭旧页面，从设置重新发起。`)}}
async function tokenRequest(body:URLSearchParams,signal?:AbortSignal):Promise<TokenResponse>{
 let res:Response
 try{res=await fetch(TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)})}catch{throw new ProviderError('NETWORK_ERROR','ChatGPT 令牌请求未完成，请检查网络后重试')}
 const data:unknown=await res.json().catch(()=>null)
 if(!res.ok)throw new OAuthError(safeErrorCode(data),res.status)
 if(!data||typeof data!=='object')throw new Error('官方令牌响应无效')
 return data as TokenResponse
}
async function identity(idToken:string,clientId:string,nonce?:string,subject?:string){
 const res=await fetch(AUTH_ISSUER+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!res.ok)throw new Error('无法取得官方签名公钥，未接受登录')
 return verifyIdentity(idToken,await res.json() as Parameters<typeof verifyIdentity>[1],clientId,nonce,subject)
}
function tokensFrom(t:TokenResponse,clientId:string,c:{sub:string;email?:string},old?:Tokens):Tokens{
 if(typeof t.access_token!=='string'||!t.access_token||t.token_type?.toLowerCase()!=='bearer'||typeof t.expires_in!=='number'||!Number.isFinite(t.expires_in)||t.expires_in<=0)throw new Error('官方令牌响应缺少有效访问权限或期限')
 if(!old&&(!t.id_token||typeof t.scope!=='string'))throw new Error('官方授权响应不完整，未保存凭据')
 return{access_token:t.access_token,refresh_token:t.refresh_token??old?.refresh_token??'',id_token:t.id_token??old?.id_token??'',client_id:clientId,subject:c.sub,email:c.email,scopes:typeof t.scope==='string'?t.scope.split(/\s+/):old?.scopes??[],expires_at:Date.now()+t.expires_in*1000-30000}
}
export function cancelChatGPTLogin(){cancelPending?.()}
export async function startChatGPTLogin(newAccount=false):Promise<{ok:boolean;accountId:string;planEnabled:boolean;modelReady:boolean}>{
 if(cancelPending)throw new Error('已有登录等待中，请先取消旧登录')
 const ws=getWorkspacePath(),epoch=++authEpoch,registration=newAccount?undefined:extra().registration,host=hostId()
 return new Promise((resolve,reject)=>{
  let attempt:LoginAttempt|undefined,consumed=false,finished=false
  const abort=new AbortController()
  const server=http.createServer((req,res)=>{
   const url=new URL(req.url??'/','http://127.0.0.1')
   if(req.method!=='GET'||url.pathname!=='/auth/callback'){res.writeHead(404).end();return}
   res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer')
   if(!attempt||consumed||url.searchParams.get('state')!==attempt.state){res.writeHead(403).end('Invalid or expired login attempt');return}
   consumed=true
   void(async()=>{
    try{
     const grant=callbackGrant(attempt!,url.searchParams),t=await tokenRequest(exchangeBody(attempt!,grant),abort.signal)
     if(!t.id_token)throw new Error('官方响应缺少身份令牌')
     const claims=await identity(t.id_token,grant.clientId,attempt!.nonce,registration?.subject)
     const tokens=tokensFrom(t,grant.clientId,claims)
     if(finished||epoch!==authEpoch||ws!==getWorkspacePath())throw new Error('登录已取消或工作区已变化，未保存凭据')
     const enabled=planAllowed(tokens.scopes)
     let models:string[]=[]
     if(enabled){try{models=await fetchModels(tokens)}catch{/* Login remains valid; catalog can be retried explicitly. */}}
     if(finished||epoch!==authEpoch||ws!==getWorkspacePath()){res.end('Login attempt ended');finish(new Error('登录已取消或工作区已变化'));return}
     getDb().transaction(()=>{saveTokens(tokens);getDb().prepare("UPDATE providers SET enabled=?, models=COALESCE(models,?) WHERE id='chatgpt'").run(enabled?1:0,models[0]?JSON.stringify({fast:[models[0]],expert:[models[0]]}):null)})()
     const modelReady=!!models[0]
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'"}).end('<h3>WhyWork</h3><p>身份验证完成，请回到应用查看套餐权限与模型状态。</p>')
     finish();resolve({ok:true,accountId:tokens.subject,planEnabled:enabled,modelReady})
    }catch(e){res.writeHead(400).end('Login not completed. Return to WhyWork and start again.');finish(e instanceof Error?e:new Error('登录未完成'))}
   })()
  })
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);abort.abort();server.close();cancelPending=undefined;if(error)reject(error)}
  const timer=setTimeout(()=>finish(new ProviderError('ABORTED','ChatGPT 登录超时，请关闭旧页面并重新发起')),600000);timer.unref()
  cancelPending=()=>finish(new ProviderError('ABORTED','ChatGPT 登录已取消；旧页面不再有效'))
  server.on('error',()=>finish(new Error('本机登录回调无法启动，请重试')))
  server.listen(0,'127.0.0.1',()=>{
   if(finished)return
   const address=server.address();if(!address||typeof address==='string'){finish(new Error('本机回调端口不可用'));return}
   attempt=createAttempt(address.port,host,registration?.clientId,registration?.subject)
   void shell.openExternal(authorizationUrl(attempt)).catch(()=>finish(new Error('无法打开官方登录页面，请重试')))
  })
 })
}
export function chatGPTStatus(){
 const e=extra(),t=readTokens(),r=row(),cfg=r?.models?JSON.parse(r.models) as {fast?:string[]}:undefined
 return{loggedIn:!!t,accountId:t?.subject,model:cfg?.fast?.[0],planEnabled:t?planAllowed(t.scopes):false,needsRefresh:!!t&&Date.now()>=t.expires_at,legacyLogin:e.oauthVersion!==2&&!!e.tokensEnc,pending:!!cancelPending}
}
export async function chatGPTLogout():Promise<{revoked:boolean}>{
 cancelChatGPTLogin();const epoch=++authEpoch,ws=getWorkspacePath(),t=readTokens(),e=extra();let revoked=!t?.refresh_token
 if(t?.refresh_token){try{
  const discovery=await fetch(AUTH_ISSUER+'/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw new Error();return r.json()}) as {revocation_endpoint?:string}
  const endpoint=new URL(discovery.revocation_endpoint??'');if(endpoint.origin!==AUTH_ISSUER)throw new Error()
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token,token_type_hint:'refresh_token',client_id:t.client_id}),redirect:'error',signal:AbortSignal.timeout(10000)});revoked=r.status===200
 }catch{revoked=false}}
 if(epoch===authEpoch&&ws===getWorkspacePath())getDb().prepare("UPDATE providers SET extra=?,enabled=0 WHERE id='chatgpt'").run(JSON.stringify({oauthVersion:2,registration:e.registration,tokensEnc:null}))
 return{revoked}
}
async function ensureTokens(r:ProviderRow):Promise<Tokens>{
 const ws=getWorkspacePath(),epoch=authEpoch,t=readTokens(row()??r)
 if(!t)throw new ProviderError('NO_PROVIDER','请到设置 → 模型供应商 → Continue with ChatGPT 重新登录')
 if(Date.now()<t.expires_at)return t
 if(!t.refresh_token)throw new Error('ChatGPT 登录已过期，请重新登录')
 const key=JSON.stringify([ws,t.client_id,t.subject]),pending=refreshing.get(key);if(pending)return pending
 const operation=(async()=>{
  try{
   const res=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:t.client_id,refresh_token:t.refresh_token,resource:RESOURCE}))
   const c=res.id_token?await identity(res.id_token,t.client_id,undefined,t.subject):{sub:t.subject,email:t.email}
   const fresh=tokensFrom(res,t.client_id,c,t)
   if(!res.refresh_token)throw new Error('刷新响应缺少轮换令牌，请重新登录')
   if(epoch!==authEpoch||ws!==getWorkspacePath())throw new Error('登录状态已变化，请重试')
   saveTokens(fresh);return fresh
  }catch(e){if(e instanceof OAuthError&&e.oauthCode==='invalid_grant'&&epoch===authEpoch&&ws===getWorkspacePath()){getDb().prepare("UPDATE providers SET extra=?,enabled=0 WHERE id='chatgpt'").run(JSON.stringify({oauthVersion:2,registration:extra().registration,tokensEnc:null}));throw new Error('ChatGPT 会话已过期或撤销，请重新登录')}throw e}
 })();refreshing.set(key,operation)
 try{return await operation}finally{refreshing.delete(key)}
}
async function fetchModelCatalog(t:Tokens):Promise<{id:string;label:string}[]>{
 if(!planAllowed(t.scopes))throw new Error('已登录，但尚未授权 ChatGPT 套餐使用；请重新授权或配置其他供应商')
 const res=await fetch(API_BASE+'/models',{headers:{Authorization:`Bearer ${t.access_token}`},redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!res.ok)throw new ProviderError('PROVIDER_ERROR',`ChatGPT 模型列表 HTTP ${res.status}`)
 const models=parseChatGPTCatalog(await res.json())
 if(!models.length)throw new Error('当前账号没有可用模型，请检查套餐权限')
 return models
}
async function fetchModels(t:Tokens):Promise<string[]>{return (await fetchModelCatalog(t)).map(m=>m.id)}
export async function refreshChatGPTModels(){const ws=getWorkspacePath(),epoch=authEpoch,r=row();if(!r)throw new Error('请先登录');const models=await fetchModels(await ensureTokens(r));if(epoch!==authEpoch||ws!==getWorkspacePath())throw new Error('登录状态已变化，请重试');return{models}}


export function getChatGPTProvider(row: ProviderRow): ChatProvider {
  return {
    id: 'chatgpt',
    name: 'Codex · ChatGPT',
    async modelCatalog(){return fetchModelCatalog(await ensureTokens(row))},
    async listModels() {
      return fetchModels(await ensureTokens(row))
    },
    async stream(req: StreamRequest, emit: (e: StreamEvent) => void) {
      const tokens = await ensureTokens(row)
      if(!planAllowed(tokens.scopes))throw new ProviderError('NO_PROVIDER','尚未授权 ChatGPT 套餐使用，请回设置重新授权')
      const model = req.model
      if(!model)throw new ProviderError('NO_PROVIDER','请在设置中刷新 ChatGPT 模型列表')

      // responses API：messages → input[]
      const input = req.messages.filter(m=>m.role!=='system').flatMap(m=>{
        if(m.role==='tool')return[{type:'function_call_output',call_id:m.tool_call_id,output:m.content??''}]
        const items:Record<string,unknown>[]=[]
        if(m.content)items.push({role:m.role,content:m.content})
        for(const t of m.tool_calls??[])items.push({type:'function_call',call_id:t.id,name:t.function.name,arguments:t.function.arguments})
        return items
      })

      const res = await fetch(`${API_BASE}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input, store:false, stream: true, tools:req.tools?.map(t=>({type:'function',name:t.function.name,description:t.function.description,parameters:t.function.parameters})), instructions: req.messages.find((m) => m.role === 'system')?.content ?? undefined }),
        signal: req.signal, redirect:'error'
      }).catch((e) => {
        throw new ProviderError('NETWORK_ERROR', `ChatGPT 网络错误: ${e.message}`)
      })

      if (!res.ok || !res.body) {
        const data:unknown = await res.json().catch(() => null)
        throw new ProviderError('PROVIDER_ERROR', `ChatGPT HTTP ${res.status}（${safeErrorCode(data)}）`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let completed=false
      const calls=new Map<string,{id:string;name:string;args:string}>()
      let finish: 'stop' | 'tool_use' | 'length' = 'stop'
      // responses SSE：event: response.output_text.delta → data {"delta":"..."}
      const handle = (event: string, data: string): void => {
        let j: {delta?:string;type?:string;item?:{type?:string;id?:string;call_id?:string;name?:string;arguments?:string};item_id?:string;response?:{status?:string};error?:{message?:string}}
        try {j=JSON.parse(data)} catch{return}
        const type=j.type??event
        if(type==='response.output_text.delta'&&j.delta)emit({type:'text',delta:j.delta})
        if(type==='response.output_item.added'&&j.item?.type==='function_call'&&j.item.id)
          calls.set(j.item.id,{id:j.item.call_id??j.item.id,name:j.item.name??'',args:j.item.arguments??''})
        if(type==='response.function_call_arguments.delta'&&j.item_id){const c=calls.get(j.item_id);if(c)c.args+=j.delta??''}
        if(type==='response.output_item.done'&&j.item?.type==='function_call'&&j.item.id){const c=calls.get(j.item.id);if(c&&j.item.arguments)c.args=j.item.arguments}
        if(type==='response.failed'||type==='error')throw new ProviderError('PROVIDER_ERROR',j.error?.message??'ChatGPT 请求失败')
        if(type==='response.incomplete'){completed=true;finish='length'}
        if(type==='response.completed'){completed=true;finish=calls.size?'tool_use':'stop'}
      }
      let curEvent = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '')
            buf = buf.slice(idx + 1)
            if (line.startsWith('event: ')) curEvent = line.slice(7).trim()
            else if (line.startsWith('data: ')) handle(curEvent, line.slice(6))
          }
        }
      } catch (e) {
        if (req.signal.aborted) throw new ProviderError('ABORTED', '已取消')
        throw new ProviderError('NETWORK_ERROR', `ChatGPT 流中断: ${e instanceof Error ? e.message : String(e)}`)
      }
      buf += decoder.decode()
      if(buf.trim().startsWith('data:'))handle(curEvent,buf.trim().slice(5).trim())
      if(!completed)throw new ProviderError('NETWORK_ERROR','ChatGPT 流在结束标记前中断')
      for(const c of calls.values())emit({type:'tool_call',id:c.id,name:c.name,argsJson:c.args||'{}'})
      return { finishReason: finish }
    }
  }
}
