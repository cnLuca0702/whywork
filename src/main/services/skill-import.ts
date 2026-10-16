import fs from 'node:fs'
import path from 'node:path'
export function validateSkill(raw:string){
 const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);if(!match)throw new Error('SKILL.md需要frontmatter中的name和description')
 const fields:Record<string,string>={}
 for(const line of match[1]!.split(/\r?\n/)){const pos=line.indexOf(':');if(pos>0)fields[line.slice(0,pos).trim()]=line.slice(pos+1).trim().replace(/^['"]|['"]$/g,'')}
 const name=fields.name,description=fields.description
 if(!name||!description||!(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/).test(name)||['|','>'].includes(description))throw new Error('技能name须为安全目录名，description须为非空单行描述')
 return {name,description}
}
export function inspectSkillFolder(dir:string){
 let count=0,size=0
 const walk=(at:string)=>{const stat=fs.lstatSync(at);if(stat.isSymbolicLink())throw new Error('技能目录不允许符号链接');if(stat.isDirectory()){for(const child of fs.readdirSync(at))walk(path.join(at,child))}else if(stat.isFile()){count++;size+=stat.size;if(count>1000||size>20*1024*1024)throw new Error('技能超过1000个文件或20MB')}else throw new Error('技能含不支持的文件类型')}
 walk(dir);return validateSkill(fs.readFileSync(path.join(dir,'SKILL.md'),'utf8'))
}
