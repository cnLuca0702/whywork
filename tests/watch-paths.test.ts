import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {watchConflict,watchError} from '../src/main/services/watch-paths'
let root:string,ws:string,home:string,parent:string,child:string
beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'watch-conflict-'));ws=path.join(root,'workspace');home=path.join(root,'home');parent=path.join(root,'documents');child=path.join(parent,'child');for(const dir of [ws,home,child])fs.mkdirSync(dir,{recursive:true})})
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}))
it('rejects duplicate and covered paths through real symlinks',()=>{
 fs.symlinkSync(parent,path.join(root,'alias'))
 expect(()=>watchConflict(path.join(root,'alias'),ws,home,[{id:'p',dir:parent}])).toThrow('已在同步')
 expect(()=>watchConflict(child,ws,home,[{id:'p',dir:parent}])).toThrow('覆盖')
})
it('returns children for explicit parent merge and rejects unsafe roots',()=>{
 expect(watchConflict(parent,ws,home,[{id:'c',dir:child}]).children.map(c=>c.id)).toEqual(['c'])
 for(const dir of [ws,home,root,'/usr'])expect(()=>watchConflict(dir,ws,home,[])).toThrow()
 expect(watchError(Object.assign(new Error('denied'),{code:'EACCES'}))).toContain('隐私与安全性')
})
