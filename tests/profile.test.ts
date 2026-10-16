import {expect,it,vi} from 'vitest'
vi.mock('../src/main/syscalls/settings',()=>({getSetting:()=>null}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>'/tmp/whywork-test'}))
import {profilePrompt} from '../src/main/agent/prompts'
it('injects explicit profile and language without inventing absent fields',()=>{
 const values:Record<string,string>={'profile.nickname':'小林','profile.instructions':'先说明结论','ai.responseLanguage':'English'}
 const text=profilePrompt(k=>values[k]??null)
 expect(text).toContain('小林');expect(text).toContain('先说明结论');expect(text).toContain('English');expect(text).not.toContain('身份/角色')
 expect(profilePrompt(()=>null)).toBe('')
})
