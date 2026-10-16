export type SearchMode='basic'|'smart'|'hq_first'
export async function routeSearch<T extends {url:string}>(mode:SearchMode,engines:{name:string;run:()=>Promise<T[]>}[],count:number){
 const ordered=mode==='hq_first'?[...engines.filter(e=>e.name!=='duckduckgo'),...engines.filter(e=>e.name==='duckduckgo')]:mode==='basic'?engines.filter(e=>e.name==='duckduckgo'):[...engines.filter(e=>e.name==='duckduckgo'),...engines.filter(e=>e.name!=='duckduckgo')]
 const items:T[]=[],errors:string[]=[],used:string[]=[]
 for(const engine of ordered){
  try{const found=await engine.run();used.push(engine.name);for(const item of found)if(!items.some(i=>i.url===item.url))items.push(item)
   if(mode!=='smart'&&items.length||mode==='smart'&&items.length>=3)break
  }catch(e){errors.push(`${engine.name}: ${e instanceof Error?e.message:String(e)}`)}
 }
 if(!items.length&&errors.length===ordered.length)throw new Error('搜索失败：'+errors.join('；'))
 return {engine:used.join('+'),items:items.slice(0,count),errors}
}
