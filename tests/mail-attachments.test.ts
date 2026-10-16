import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:''}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
import {mailAttachments,mailError} from '../src/main/services/mail-attachments'
beforeAll(()=>{mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'mail-attachments-'));for(const [name,size] of [['small',1024],['large',21*1024*1024],['medium',13*1024*1024]] as const){const file=path.join(mock.ws,name);fs.closeSync(fs.openSync(file,'w'));fs.truncateSync(file,size)}})
afterAll(()=>fs.rmSync(mock.ws,{recursive:true,force:true}))
it('checks workspace containment and individual/combined attachment limits',()=>{
 expect(mailAttachments([{path:'small'}])[0]?.filename).toBe('small')
 expect(()=>mailAttachments([{path:'../outside'}])).toThrow('工作区')
 expect(()=>mailAttachments([{path:'large'}])).toThrow('20MB')
 expect(()=>mailAttachments([{path:'medium'},{path:'medium'}])).toThrow('25MB')
})
it('classifies errors without reflecting credentials or service messages',()=>{
 expect(mailError(new Error('535 bad password=SECRET'))).toContain('应用专用密码')
 expect(mailError(new Error('ECONNREFUSED'))).toContain('无法连接')
 expect(mailError(new Error('TLS certificate failure'))).toContain('TLS')
 expect(mailError(new Error('550 rejected'))).toContain('发件被拒')
})
