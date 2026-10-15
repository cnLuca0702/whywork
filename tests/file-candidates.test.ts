import {it,expect,afterEach} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {CandidateScope,literalMatch} from '../src/main/services/file-candidates'
const roots:string[]=[]
async function temp(){const p=await fs.mkdtemp(path.join(os.tmpdir(),'whywork-search-unit-'));roots.push(p);return p}
afterEach(async()=>{for(const p of roots.splice(0))await fs.rm(p,{recursive:true,force:true})})
it('matches every literal term across title and body without treating regex or operators specially',()=>{
 expect(literalMatch('青禾 项目','预算 80万元','青禾 预算')?.score).toBeGreaterThan(0)
 expect(literalMatch('a','[x] value','[x]')).not.toBeNull()
 expect(literalMatch('a','value','.*')).toBeNull()
 expect(literalMatch('a','value','value absent')).toBeNull()
})
it('enumerates filenames only in selected root; excludes hidden files, symlinks and imported paths',async()=>{
 const root=await temp(),outside=await temp();await fs.mkdir(path.join(root,'nested'));await fs.mkdir(path.join(root,'.whywork'))
 await fs.writeFile(path.join(root,'MATCH.md'),'NOT_A_BODY_SEARCH');await fs.writeFile(path.join(root,'nested/MATCH.txt'),'body');await fs.writeFile(path.join(root,'.whywork/MATCH.txt'),'private')
 await fs.writeFile(path.join(outside,'MATCH.txt'),'outside');await fs.symlink(outside,path.join(root,'outside'))
 const scope=await CandidateScope.create(root),known=new Set([path.join(root,'MATCH.md')])
 expect((await scope.find('match',known)).items.map(x=>x.relativePath)).toEqual(['nested/MATCH.txt'])
 expect((await scope.find('NOT_A_BODY_SEARCH',new Set())).items).toEqual([])
 await expect(scope.resolve('../MATCH.txt')).rejects.toThrow();await expect(scope.resolve('outside/MATCH.txt')).rejects.toThrow()
})
it('revokes stale filesystem identity instead of following a replaced root',async()=>{
 const root=await temp(),scope=await CandidateScope.create(root);await fs.rename(root,root+'-old');roots.push(root+'-old');await fs.mkdir(root)
 await expect(scope.find('anything',new Set())).rejects.toThrow('授权目录已变化')
})
it('bounds candidate results and reports truncation',async()=>{
 const root=await temp();for(let i=0;i<5;i++)await fs.writeFile(path.join(root,`test-${i}.txt`),'x')
 const r=await(await CandidateScope.create(root)).find('test',new Set(),2);expect(r.items).toHaveLength(2);expect(r.truncated).toBe(true)
})
