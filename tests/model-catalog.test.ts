import {beforeEach,describe,expect,it,vi} from 'vitest'
import {parseChatGPTCatalog} from '../src/main/providers/catalog-format'
const mock=vi.hoisted(()=>({rows:[] as any[],list:vi.fn(),catalog:vi.fn(),workspace:'/synthetic',status:{loggedIn:true,planEnabled:true}}))
vi.mock('../src/main/db/client',()=>({dbPath:()=>mock.workspace,getDb:()=>{throw new Error('No writes allowed in catalog tests')}}))
vi.mock('../src/main/providers/store',()=>({listProviderRows:()=>mock.rows,getProvider:(id:string)=>({listModels:()=>mock.list(id),...(id==='oauth'?{modelCatalog:mock.catalog}:{})})}))
vi.mock('../src/main/providers/chatgpt',()=>({chatGPTStatus:()=>mock.status}))
import {modelCatalog,validateSelection,configuredModels} from '../src/main/providers/catalog'
const row=(id:string,other={})=>({id,kind:'openai-compat',name:'Same display name',base_url:'http://127.0.0.1',api_key_enc:Buffer.from('synthetic'),models:JSON.stringify({fast:['configured'],expert:[]}),enabled:1,extra:null,...other})
beforeEach(()=>{vi.clearAllMocks();mock.workspace='/synthetic/'+Math.random();mock.rows=[];mock.list.mockResolvedValue(['shared']);mock.catalog.mockResolvedValue([{id:'account-slug',label:'Account model'}])})
describe('model catalog is evidence-based and never mutates provider configuration',()=>{
 it('preserves account order, labels and slugs, hides invisible models and rejects API-key shape',()=>{
  expect(parseChatGPTCatalog({models:[{slug:'b',display_name:'Visible B',visibility:'list'},{slug:'hidden',visibility:'hidden'},{slug:'a',visibility:'list'},{slug:'b',visibility:'list'}]})).toEqual([{id:'b',label:'Visible B'},{id:'a',label:'a'}])
  expect(parseChatGPTCatalog({data:[{id:'wrong-shape'}]})).toEqual([])
 })
 it('keeps duplicate names and model IDs distinct by provider, with configured fallback provenance',async()=>{
  mock.rows=[row('a'),row('b')];const r=await modelCatalog()
  expect(r.map(p=>p.id)).toEqual(['a','b']);expect(r[0]?.models).toEqual([{id:'shared',label:'shared',source:'discovered'},{id:'configured',label:'configured',source:'configured'}])
  await expect(validateSelection({providerId:'b',model:'shared'})).resolves.toBeUndefined()
  await expect(validateSelection({providerId:'b',model:'invented'})).rejects.toThrow('不在')
 })
 it('never discovers disabled or credential-less providers',async()=>{
  mock.rows=[row('off',{enabled:0}),row('no-key',{api_key_enc:null})];const r=await modelCatalog();expect(mock.list).not.toHaveBeenCalled();expect(r.every(p=>!p.ready)).toBe(true)
  await expect(validateSelection({providerId:'off',model:'configured'})).rejects.toThrow('停用')
 })
 it('retains configured IDs on a failed discovery without fabricating availability',async()=>{
  mock.rows=[row('a')];mock.list.mockRejectedValue(new Error('secret must not be exposed'))
  const [p]=await modelCatalog();expect(p?.status).toContain('读取失败');expect(JSON.stringify(p)).not.toContain('secret');expect(p?.models[0]?.source).toBe('configured')
 })
 it('uses successful OAuth catalog as authoritative and preserves labels',async()=>{
  mock.rows=[row('oauth',{kind:'chatgpt'})];const [p]=await modelCatalog();expect(p?.models).toEqual([{id:'account-slug',label:'Account model',source:'discovered'}])
  await expect(validateSelection({providerId:'oauth',model:'configured'})).rejects.toThrow('不在')
 })
 it('refresh removes disappeared discovered models and configuration changes invalidate cached choices',async()=>{
  mock.rows=[row('a')];await modelCatalog();mock.list.mockResolvedValue(['new']);await modelCatalog(true)
  await expect(validateSelection({providerId:'a',model:'shared'})).rejects.toThrow('不在')
  mock.rows=[row('a',{enabled:0})];await expect(validateSelection({providerId:'a',model:'new'})).rejects.toThrow('停用')
 })
 it('rejects stale results after a workspace or configuration switch',async()=>{
  let finish!:(ids:string[])=>void;mock.rows=[row('a')];mock.list.mockImplementation(()=>new Promise(r=>{finish=r}));const promise=modelCatalog();mock.workspace='/changed';finish(['shared']);await expect(promise).rejects.toThrow('工作区')
 })
 it('reads legacy role fields without modifying them and tolerates malformed data',()=>{
  expect(configuredModels(row('a',{models:JSON.stringify({defaultExpert:'x',fast:['a','a'],expert:['b']})}))).toEqual(['x','a','b'])
  expect(configuredModels(row('a',{models:'broken'}))).toEqual([])
 })
})
