import {expect,it} from 'vitest'
import {validateSkill,inspectSkillFolder} from '../src/main/services/skill-import'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
it('requires frontmatter name and description and rejects path traversal names',()=>{
 expect(validateSkill('---\nname: example\ndescription: test skill\n---\nBody')).toEqual({name:'example',description:'test skill'})
 for(const raw of ['body only','---\nname: ../outside\ndescription: test\n---','---\nname: missing-desc\n---'])expect(()=>validateSkill(raw)).toThrow()
})
it('rejects symlink content before copying a skill directory',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-import-'));try{fs.writeFileSync(path.join(root,'SKILL.md'),'---\nname: local\ndescription: test\n---');fs.symlinkSync('/tmp',path.join(root,'linked'));expect(()=>inspectSkillFolder(root)).toThrow('符号链接')}finally{fs.rmSync(root,{recursive:true,force:true})}
})
