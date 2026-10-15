/** ChatGPT SIWC catalog differs from the API-key /models data[].id response. */
export function parseChatGPTCatalog(data:unknown):{id:string;label:string}[]{
  if(!data||typeof data!=='object'||!Array.isArray((data as {models?:unknown}).models))return []
  const out=new Map<string,{id:string;label:string}>()
  for(const m of (data as {models:unknown[]}).models){
    if(!m||typeof m!=='object')continue
    const item=m as {slug?:unknown;display_name?:unknown;visibility?:unknown}
    if(item.visibility!=='list'||typeof item.slug!=='string'||!item.slug.trim()||out.has(item.slug))continue
    out.set(item.slug,{id:item.slug,label:typeof item.display_name==='string'&&item.display_name.trim()?item.display_name:item.slug})
  }
  return [...out.values()]
}
