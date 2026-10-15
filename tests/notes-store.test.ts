import {beforeEach,expect,it,vi} from 'vitest'
const {sys}=vi.hoisted(()=>({sys:vi.fn()}))
vi.mock('../src/renderer/src/api',()=>({sys}))
import {useNotesStore} from '../src/renderer/src/store/notes'
beforeEach(()=>{sys.mockReset();useNotesStore.setState({items:[],total:0,loading:false})})
it('does not overwrite the current filter with a slower older list response',async()=>{
  let resolveOld!:(value:unknown)=>void,resolveNew!:(value:unknown)=>void
  sys.mockImplementationOnce(()=>new Promise(resolve=>resolveOld=resolve)).mockImplementationOnce(()=>new Promise(resolve=>resolveNew=resolve))
  const old=useNotesStore.getState().list({query:'old'}),current=useNotesStore.getState().list({filter:{deleted:true}})
  resolveNew({items:[],total:2});await current
  resolveOld({items:[{noteId:'stale'}],total:9});await old
  expect(useNotesStore.getState().total).toBe(2);expect(useNotesStore.getState().items).toEqual([])
})
it('keeps the loading indicator for a newer pending request',async()=>{
  let resolveOld!:(value:unknown)=>void,resolveNew!:(value:unknown)=>void
  sys.mockImplementationOnce(()=>new Promise(resolve=>resolveOld=resolve)).mockImplementationOnce(()=>new Promise(resolve=>resolveNew=resolve))
  const old=useNotesStore.getState().list({}),current=useNotesStore.getState().list({query:'current'})
  resolveOld({items:[],total:0});await old
  expect(useNotesStore.getState().loading).toBe(true)
  resolveNew({items:[],total:0});await current
  expect(useNotesStore.getState().loading).toBe(false)
})
it('does not decrement a total twice when the changed event already refreshed the list',async()=>{
  sys.mockResolvedValue({})
  useNotesStore.setState({items:[],total:0})
  await useNotesStore.getState().remove('already-absent')
  expect(useNotesStore.getState().total).toBe(0)
})
