import {afterEach,describe,expect,it} from 'vitest'
import {registerViewGuard,useUiStore} from '../src/renderer/src/store/ui'
let cleanup: (()=>void)|undefined
afterEach(()=>{cleanup?.();cleanup=undefined;useUiStore.setState({view:'notes',activeNoteId:null,toolsTab:'capture'})})
describe('workspace navigation preserves guarded edits',()=>{
 it('keeps the current view and note when leaving is cancelled',async()=>{
  useUiStore.setState({view:'tools',activeNoteId:'synthetic'})
  cleanup=registerViewGuard(async()=>false)
  expect(await useUiStore.getState().setView('chat')).toBe(false)
  expect(useUiStore.getState().view).toBe('tools')
  expect(useUiStore.getState().activeNoteId).toBe('synthetic')
 })
 it('rejects a second navigation while the save decision is pending',async()=>{
  let resolve!:(ok:boolean)=>void
  cleanup=registerViewGuard(()=>new Promise<boolean>(r=>{resolve=r}))
  const first=useUiStore.getState().setView('chat')
  expect(await useUiStore.getState().setView('settings')).toBe(false)
  resolve(true);expect(await first).toBe(true)
  expect(useUiStore.getState().view).toBe('chat')
 })
 it('does not change the requested tool tab when leaving is cancelled',async()=>{
  cleanup=registerViewGuard(async()=>false)
  await useUiStore.getState().setToolsTab('office')
  expect(useUiStore.getState().view).toBe('notes')
  expect(useUiStore.getState().toolsTab).toBe('capture')
 })
 it('opens the exact tool destination after a successful transition',async()=>{
  cleanup=registerViewGuard(async()=>true)
  await useUiStore.getState().setToolsTab('calendar')
  expect(useUiStore.getState().view).toBe('tools')
  expect(useUiStore.getState().toolsTab).toBe('calendar')
 })
})
