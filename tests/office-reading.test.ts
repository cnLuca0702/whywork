import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:''}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
import {xlsxRead,xlsxSummary} from '../src/main/services/office-reading'
beforeAll(()=>{mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'office-read-'));fs.copyFileSync('tests/fixtures/remio-r/importable/office/rt-sheets.xlsx',path.join(mock.ws,'sample.xlsx'))})
afterAll(()=>fs.rmSync(mock.ws,{recursive:true,force:true}))
it('reports sheets and continues from returned row offsets under a shared budget',async()=>{
 const summary=await xlsxSummary('sample.xlsx');expect(summary.sheets.length).toBeGreaterThan(1)
 const first=await xlsxRead('sample.xlsx',undefined,1,1);expect(first.usedCharacters).toBeLessThanOrEqual(20000);expect(first.sheets[0]?.rows[0]?.row).toBe(1)
 const next=first.sheets[0]!.nextOffset;if(next){const second=await xlsxRead('sample.xlsx',[first.sheets[0]!.name],next,1);expect(second.sheets[0]?.rows[0]?.row).toBe(next)}
 await expect(xlsxSummary('../outside.xlsx')).rejects.toThrow('工作区')
},20000)
