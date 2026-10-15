import crypto from 'node:crypto'
import {dbPath, getDb} from '../db/client'
import {getProvider, listProviderRows, type ProviderRow, type ModelsConfig} from './store'
import {chatGPTStatus} from './chatgpt'

export interface ModelSelection {providerId:string;model:string}
export interface CatalogModel {id:string;label:string;source:'discovered'|'configured'}
export interface CatalogProvider {id:string;name:string;enabled:boolean;ready:boolean;models:CatalogModel[];status:string;checkedAt?:number}
type Entry={models:CatalogModel[];checkedAt:number;failed:boolean}
const cache=new Map<string,Entry>()
const pending=new Map<string,Promise<Entry>>()
const TTL=5*60_000
function key(r:ProviderRow){
  let auth:unknown=null
  if(r.kind==='chatgpt'){try{const e=JSON.parse(r.extra??'{}');auth={version:e.oauthVersion,registration:e.registration,hasTokens:!!e.tokensEnc}}catch{}}
  // Token rotation is not a configuration change; login/logout/account changes are.
  return dbPath()+':'+crypto.createHash('sha256').update(JSON.stringify({...r,extra:auth})).digest('hex')
}
export function configuredModels(row:ProviderRow):string[]{
  let c:Partial<ModelsConfig>={}
  try{c=JSON.parse(row.models??'{}')??{}}catch{/* Invalid legacy data is not a catalog. */}
  return [...new Set([c.defaultFast,c.defaultExpert,...(Array.isArray(c.fast)?c.fast:[]),...(Array.isArray(c.expert)?c.expert:[])].filter((v):v is string=>typeof v==='string'&&!!v.trim()).map(v=>v.trim()))]
}
function ready(r:ProviderRow){if(!r.enabled)return false;if(r.kind!=='chatgpt')return !!r.api_key_enc;try{const s=chatGPTStatus();return !!s.loggedIn&&!!s.planEnabled}catch{return false}}
async function discover(r:ProviderRow):Promise<Entry>{
  const k=key(r),running=pending.get(k);if(running)return running
  const job=(async()=>{
    try{
      const p=getProvider(r.id)
      const rows=p.modelCatalog?await p.modelCatalog():(await p.listModels()).map(id=>({id,label:id}))
      const models=[...new Map(rows.filter(m=>typeof m.id==='string'&&!!m.id.trim()).map(m=>[m.id,{id:m.id,label:m.label||m.id,source:'discovered' as const}])).values()]
      return {models,checkedAt:Date.now(),failed:false}
    }catch{return {models:[],checkedAt:Date.now(),failed:true}}
  })();pending.set(k,job)
  try{const result=await job;cache.set(k,result);return result}finally{pending.delete(k)}
}
export async function modelCatalog(refresh=false):Promise<CatalogProvider[]>{
  const workspace=dbPath()
  const rows=listProviderRows()
  const result=await Promise.all(rows.map(async r=>{
    const canUse=ready(r)
    let entry=cache.get(key(r))
    if(canUse&&(refresh||!entry||Date.now()-entry.checkedAt>TTL))entry=await discover(r)
    let models:CatalogModel[]=(entry?.models??[]).map(m=>({...m}))
    // Custom IDs remain selectable when discovery is unsupported. ChatGPT's successful
    // account catalog is authoritative: do not resurrect unavailable OAuth models.
    if(r.kind!=='chatgpt'||!entry||entry.failed){
      for(const id of configuredModels(r))if(!models.some(m=>m.id===id))models.push({id,label:id,source:'configured'})
    }
    return {id:r.id,name:r.kind==='chatgpt'?'Codex · ChatGPT':r.name,enabled:!!r.enabled,ready:canUse,models,
      status:!r.enabled?'已停用':!canUse?'需要配置密钥或重新授权':entry?.failed?'目录读取失败；已配置模型尚未验证':!models.length?'未返回可用模型':'目录可用；模型未进行推理验证',checkedAt:entry?.checkedAt}
  }))
  if(dbPath()!==workspace)throw new Error('工作区已切换，请刷新模型')
  // Discard a response if settings changed while the network request was pending.
  if(rows.map(key).join('|')!==listProviderRows().map(key).join('|'))throw new Error('模型配置已变化，请刷新模型')
  return result
}
export async function validateSelection(selection:ModelSelection):Promise<void>{
  const p=(await modelCatalog()).find(p=>p.id===selection.providerId)
  if(!p?.ready)throw new Error('所选供应商不存在、已停用或需要重新授权，请重新选择模型')
  if(!p.models.some(m=>m.id===selection.model))throw new Error('所选模型已不在当前目录或配置中，请重新选择')
}
export function chatSelection(chatId:string):ModelSelection|null{
  const r=getDb().prepare('SELECT provider_id,model FROM chat_models WHERE chat_id=?').get(chatId) as {provider_id:string;model:string}|undefined
  return r?{providerId:r.provider_id,model:r.model}:null
}
export function saveChatSelection(chatId:string,s:ModelSelection):void{
  getDb().prepare('INSERT INTO chat_models(chat_id,provider_id,model) VALUES (?,?,?) ON CONFLICT(chat_id) DO UPDATE SET provider_id=excluded.provider_id,model=excluded.model').run(chatId,s.providerId,s.model)
}
