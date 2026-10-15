import {beforeEach,describe,expect,it,vi} from 'vitest'
const {sys}=vi.hoisted(()=>({sys:vi.fn()}))
vi.mock('../src/renderer/src/api',()=>({sys,useSysEvent:vi.fn()}))
import {useChatStore} from '../src/renderer/src/store/chat'
const a={providerId:'a',model:'same'},b={providerId:'b',model:'same'}
const chats=[{chatId:'a',title:'A',noteId:null,modelRole:'fast' as const,selection:a,updatedAt:1},{chatId:'b',title:'B',noteId:null,modelRole:'expert' as const,selection:b,updatedAt:2}]
beforeEach(()=>{sys.mockReset();useChatStore.getState().newChat();useChatStore.setState({chats,draftSelection:null,running:{},catalog:[],catalogLoading:false,catalogError:null})})
describe('explicit chat model state',()=>{
 it('keeps a draft selection without creating an empty chat and passes it on creation',async()=>{
  await useChatStore.getState().setModel(b);expect(sys).not.toHaveBeenCalled()
  sys.mockImplementation(async(action:string)=>action==='chat.create'?{chatId:'b'}:action==='chat.list'?{items:chats}:{messages:[]})
  expect(await useChatStore.getState().openChat(null)).toBe('b');expect(sys).toHaveBeenCalledWith('chat.create',{noteId:undefined,selection:b})
 })
 it('routes an existing chat with its explicit selection, independent of legacy role',async()=>{
  useChatStore.setState({activeChatId:'b'});sys.mockResolvedValue({ok:true});await useChatStore.getState().send('hello')
  expect(sys).toHaveBeenCalledWith('chat.send',{chatId:'b',text:'hello',selection:b})
 })
 it('does not mutate either selection during streaming',async()=>{
  useChatStore.setState({activeChatId:'a',streaming:true});await expect(useChatStore.getState().setModel(b)).rejects.toThrow('回复期间');expect(sys).not.toHaveBeenCalled();expect(useChatStore.getState().chats[0]?.selection).toEqual(a)
 })
 it('saves the original chat selection if the user switches while save is pending',async()=>{
  let finish!:(v:unknown)=>void;sys.mockImplementation(()=>new Promise(r=>{finish=r}));useChatStore.setState({activeChatId:'a'})
  const job=useChatStore.getState().setModel(b);useChatStore.setState({activeChatId:'b'});finish({});await job
  expect(sys).toHaveBeenCalledWith('chat.set_model',{chatId:'a',selection:b});expect(useChatStore.getState().chats.every(c=>c.selection?.providerId==='b')).toBe(true)
 })
 it('ignores older history loads and refuses sending to a different chat',async()=>{
  const resolve=new Map<string,(v:unknown)=>void>();sys.mockImplementation((_a:string,p:{chatId:string})=>new Promise(r=>resolve.set(p.chatId,r)))
  const first=useChatStore.getState().openChat('a'),second=useChatStore.getState().openChat('b')
  resolve.get('b')!({messages:[]});await second;resolve.get('a')!({messages:[{content:'stale'}]});expect(await first).toBeNull()
  expect(useChatStore.getState().activeChatId).toBe('b');expect(useChatStore.getState().messages).toEqual([])
  await expect(useChatStore.getState().send('wrong target','a')).rejects.toThrow('会话已切换')
 })
 it('new chat invalidates an in-flight open and restores rejected optimistic messages',async()=>{
  let finish!:(v:unknown)=>void;sys.mockImplementation(()=>new Promise(r=>{finish=r}));const job=useChatStore.getState().openChat('a');useChatStore.getState().newChat();finish({messages:[]});expect(await job).toBeNull()
  useChatStore.setState({activeChatId:'b'});sys.mockRejectedValue(new Error('disabled provider'));await expect(useChatStore.getState().send('hello')).rejects.toThrow('disabled');expect(useChatStore.getState().messages).toEqual([]);expect(useChatStore.getState().streaming).toBe(false)
 })
 it('discards stale catalog responses and clears choices after a failed refresh',async()=>{
  const resolvers:((v:unknown)=>void)[]=[];sys.mockImplementation(()=>new Promise(r=>resolvers.push(r)))
  const old=useChatStore.getState().loadCatalog(),fresh=useChatStore.getState().loadCatalog(true)
  resolvers[1]!({items:[{id:'fresh'}]});await fresh;resolvers[0]!({items:[{id:'old'}]});await old
  expect(useChatStore.getState().catalog[0]?.id).toBe('fresh');sys.mockRejectedValue(new Error('network'));await useChatStore.getState().loadCatalog(true);expect(useChatStore.getState().catalog).toEqual([]);expect(useChatStore.getState().catalogError).toContain('network')
 })
})
