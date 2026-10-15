import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({open:vi.fn(),close:vi.fn(),callback:undefined as ((req:{method:string;url:string},res:unknown)=>void)|undefined,write:vi.fn(),fetch:vi.fn(),deferListen:false,listening:undefined as (()=>void)|undefined}))
vi.mock('electron',()=>({shell:{openExternal:mocks.open},app:{getPath:()=>'/synthetic'},safeStorage:{}}))
vi.mock('node:fs',()=>({default:{existsSync:()=>true,readFileSync:()=>JSON.stringify({id:'urn:uuid:12345678-1234-1234-1234-123456789012'})}}))
vi.mock('node:http',()=>({default:{createServer:(cb:typeof mocks.callback)=>{mocks.callback=cb;return{close:mocks.close,on:vi.fn(),address:()=>({port:51000}),listen:(_p:number,_host:string,fn:()=>void)=>{mocks.listening=fn;if(!mocks.deferListen)fn()}}}}}))
vi.mock('../src/main/db/client',()=>({getDb:()=>({prepare:()=>({get:()=>undefined,run:mocks.write})})}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>'/synthetic-workspace'}))
import {startChatGPTLogin,cancelChatGPTLogin,chatGPTStatus} from '../src/main/providers/chatgpt'
function respond(params:URLSearchParams){const res={setHeader:vi.fn(),writeHead:vi.fn(),end:vi.fn()};res.writeHead.mockReturnValue(res);mocks.callback!({method:'GET',url:'/auth/callback?'+params.toString()},res);return res}
beforeEach(()=>{vi.clearAllMocks();mocks.deferListen=false;vi.stubGlobal('fetch',mocks.fetch);mocks.open.mockResolvedValue(undefined)})
afterEach(()=>{cancelChatGPTLogin();vi.useRealTimers();vi.unstubAllGlobals()})
describe('login attempt lifecycle with synthetic transport only',()=>{
 it('cancel closes callback and does not save credentials or call token endpoint',async()=>{
  const login=startChatGPTLogin(),failure=expect(login).rejects.toThrow('已取消');expect(chatGPTStatus().pending).toBe(true);cancelChatGPTLogin();await failure;expect(mocks.close).toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();expect(chatGPTStatus().pending).toBe(false)
 })
 it('ignores stale state and rejects duplicate active login',async()=>{
  const login=startChatGPTLogin(),failure=expect(login).rejects.toThrow('已取消');const res=respond(new URLSearchParams({state:'stale',code:'synthetic'}));expect(res.writeHead).toHaveBeenCalledWith(403);await expect(startChatGPTLogin()).rejects.toThrow('等待中');expect(mocks.fetch).not.toHaveBeenCalled();cancelChatGPTLogin();await failure
 })
 it('declined consent ends attempt without exchanging code',async()=>{
  const login=startChatGPTLogin(),failure=expect(login).rejects.toThrow('已取消 ChatGPT 授权');const url=new URL(mocks.open.mock.calls[0]![0] as string);respond(new URLSearchParams({state:url.searchParams.get('state')!,error:'access_denied'}));await failure;expect(mocks.close).toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled()
 })
 it('does not open the browser if cancelled before listener readiness',async()=>{
  mocks.deferListen=true;const login=startChatGPTLogin(),failure=expect(login).rejects.toThrow('已取消');cancelChatGPTLogin();mocks.listening!();await failure;expect(mocks.open).not.toHaveBeenCalled()
 })
 it('expires abandoned attempts and allows a fresh retry',async()=>{
  vi.useFakeTimers();const login=startChatGPTLogin(),failure=expect(login).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(600001);await failure;expect(chatGPTStatus().pending).toBe(false);const retry=startChatGPTLogin(),cancelled=expect(retry).rejects.toThrow('已取消');expect(mocks.open).toHaveBeenCalledTimes(2);cancelChatGPTLogin();await cancelled
 })
})
