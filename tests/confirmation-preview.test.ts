import {expect,it} from 'vitest'
import {confirmationPreview,applyConfirmationOverride} from '../src/main/agent/confirmation-preview'
it('provides readable previews without displaying raw MCP secrets',()=>{
 expect(confirmationPreview('notes.delete',{noteId:'n'}).warnings).toContain('可在保险箱中回滚')
 expect(JSON.stringify(confirmationPreview('mcp__remote__write',{token:'secret',password:'s'}))).not.toContain('secret')
 expect(confirmationPreview('file.write',{path:'resources/a',content:'line\n'.repeat(100)}).body?.split('\n')).toHaveLength(10)
})
it('permits only the declared mail fields and maps account/addresses',()=>{
 expect(applyConfirmationOverride('mail.send',{id:'old',to:'original',confirmed:true},{accountId:'new',to:'updated',cc:'a@example.com, b@example.com'})).toEqual({id:'new',to:'updated',confirmed:true,cc:['a@example.com','b@example.com']})
 expect(()=>applyConfirmationOverride('mail.send',{},{confirmed:'true'})).toThrow('白名单')
 expect(()=>applyConfirmationOverride('file.write',{},{path:'other'})).toThrow('不允许')
 expect(()=>applyConfirmationOverride('mail.send',{},{text:{to:'bad'}})).toThrow('白名单')
})
