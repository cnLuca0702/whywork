import {expect,it} from 'vitest'
import {routeSearch} from '../src/main/services/search-routing'
import {modelError} from '../src/main/providers/errors'
it('basic never queries paid engines and smart only supplements fewer than three hits',async()=>{
 const seen:string[]=[]
 const engines=[{name:'brave',run:async()=>{seen.push('brave');return [{url:'b'}]}},{name:'duckduckgo',run:async()=>{seen.push('ddg');return [{url:'a'}]}}]
 expect((await routeSearch('basic',engines,5)).items).toEqual([{url:'a'}]);expect(seen).toEqual(['ddg'])
 seen.length=0;expect((await routeSearch('smart',engines,5)).items).toEqual([{url:'a'},{url:'b'}]);expect(seen).toEqual(['ddg','brave'])
})
it('high quality falls back after empty and failed configured engines',async()=>{
 const seen:string[]=[]
 const engines=[{name:'brave',run:async()=>{seen.push('brave');throw new Error('429')}},{name:'tavily',run:async()=>{seen.push('tavily');return []}},{name:'duckduckgo',run:async()=>{seen.push('ddg');return [{url:'a'}]}}]
 expect((await routeSearch('hq_first',engines,5)).items).toHaveLength(1);expect(seen).toEqual(['brave','tavily','ddg'])
})
it('stops smart queries when three free results exist and deduplicates supplements',async()=>{
 let calls=0
 await routeSearch('smart',[{name:'duckduckgo',run:async()=>['a','b','c'].map(url=>({url}))},{name:'brave',run:async()=>{calls++;return []}}],5)
 expect(calls).toBe(0)
})
it.each([['HTTP 401','认证失败'],['403','认证失败'],['429','服务商繁忙'],['503','服务商繁忙'],['fetch failed','网络不可达'],['maximum context length','上下文过长']])('classifies %s without implying rate limits invalidate keys',(input,expected)=>expect(modelError(new Error(input))).toContain(expected))
