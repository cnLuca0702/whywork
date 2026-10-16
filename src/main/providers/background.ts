import {modelError} from './errors'
import {getSetting} from '../syscalls/settings'
import {validateSelection,type ModelSelection} from './catalog'
import {getProvider} from './store'
export function parseBackgroundModel(raw:string|null):ModelSelection {
  if(!raw)throw new Error('请先在设置中选择后台任务模型')
  let value:unknown
  try{value=JSON.parse(raw)}catch{throw new Error('后台任务模型配置无效，请重新选择')}
  if(!value||typeof value!=='object'||!('providerId' in value)||!('model' in value)||typeof value.providerId!=='string'||typeof value.model!=='string'||!value.providerId.trim()||!value.model.trim())throw new Error('后台任务模型配置无效，请重新选择')
  return {providerId:value.providerId,model:value.model}
}
export async function backgroundModel(){
  const selection=parseBackgroundModel(getSetting('ai.backgroundModel'))
  await validateSelection(selection)
  return {...selection,provider:getProvider(selection.providerId)}
}
export async function backgroundText(system:string,user:string,signal:AbortSignal=AbortSignal.timeout(60_000),onText?:(delta:string)=>void):Promise<string>{
  const {provider,model}=await backgroundModel()
  let text=''
  const result=await provider.stream({model,messages:[{role:'system',content:system},{role:'user',content:user}],signal},event=>{
    if(event.type==='text'){text+=event.delta;onText?.(event.delta)}
  }).catch(e=>{throw new Error(modelError(e))})
  if(result.finishReason==='length')throw new Error('模型输出被截断，请缩短输入或调整模型')
  return text
}
