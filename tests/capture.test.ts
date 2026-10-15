import {expect,it,vi} from 'vitest'
vi.mock('electron',()=>({app:{},globalShortcut:{}}))
import {parseCaptureUrl} from '../src/main/services/capture'
it('accepts only capture routes with http(s) targets',()=>{
  expect(parseCaptureUrl('whywork://clip?url=https%3A%2F%2Fexample.invalid%2Fp')).toBe('https://example.invalid/p')
  expect(parseCaptureUrl('whywork://clip?url=file%3A%2F%2F%2Fprivate%2Fdata')).toBeNull()
  expect(parseCaptureUrl('whywork://delete?url=https://example.invalid')).toBeNull()
})
