import {expect,it} from 'vitest'
import {SourceRegistry,referenceContext} from '../src/main/agent/sources'
it('numbers only actual tool results and deduplicates notes',()=>{
 const registry=new SourceRegistry()
 expect(registry.capture('notes.search',{items:[{noteId:'a',title:'A',snippet:'match'}]})).toBe('[来源 1] A')
 expect(registry.capture('notes.get',{note:{noteId:'a',title:'A'},body:'more'})).toBe('[来源 1] A')
 expect(registry.capture('web.get',{note:{noteId:'b',title:'B'}})).toBe('')
 expect(registry.sources).toEqual([{n:1,noteId:'a',title:'A',snippet:'match'}])
})
it('budgets explicit references per note and per turn with visible truncation',()=>{
 const registry=new SourceRegistry()
 const text=referenceContext(Array.from({length:5},(_,i)=>({noteId:String(i),title:String(i),body:'x'.repeat(9000)})),registry)
 expect(text.match(/x/g)?.length).toBe(24000)
 expect(text.match(/已截断/g)?.length).toBe(5)
 expect(registry.sources).toHaveLength(5)
 expect(registry.sources[0]?.snippet).toHaveLength(500)
})
