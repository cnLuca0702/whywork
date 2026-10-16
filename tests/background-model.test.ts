import {expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({setting:null as string|null,validate:vi.fn(),stream:vi.fn()}))
vi.mock('../src/main/syscalls/settings',()=>({getSetting:()=>mock.setting}))
vi.mock('../src/main/providers/catalog',()=>({validateSelection:mock.validate}))
vi.mock('../src/main/providers/store',()=>({getProvider:()=>({stream:mock.stream})}))
import {backgroundText,parseBackgroundModel} from '../src/main/providers/background'
it('rejects missing and malformed configuration instead of selecting a role',async()=>{
 for(const value of [null,'{}','invalid','{"providerId":"p","model":""}'])expect(()=>parseBackgroundModel(value)).toThrow()
 mock.setting=null
 await expect(backgroundText('s','u')).rejects.toThrow('后台任务模型')
 expect(mock.stream).not.toHaveBeenCalled()
})
it('uses and revalidates only the explicit provider and model',async()=>{
 mock.setting=JSON.stringify({providerId:'chosen',model:'specific'})
 mock.stream.mockImplementation(async(req,emit)=>{expect(req.model).toBe('specific');emit({type:'text',delta:'reply'});return {finishReason:'stop'}})
 expect(await backgroundText('s','u')).toBe('reply')
 expect(mock.validate).toHaveBeenCalledWith({providerId:'chosen',model:'specific'})
 mock.validate.mockRejectedValueOnce(new Error('removed'))
 await expect(backgroundText('s','u')).rejects.toThrow('removed')
 expect(mock.stream).toHaveBeenCalledTimes(1)
})
