import {z} from 'zod'
import fs from 'node:fs'
import {getNote} from '../db/repos/notes'
import {readNoteFile,parseFrontmatter} from '../db/notes-file'
import {scanSkills} from '../syscalls/mcp'
export const refsSchema=z.object({noteIds:z.array(z.string().min(1)).max(10).optional(),skills:z.array(z.string().min(1)).max(3).optional()})
export type ChatRefs=z.infer<typeof refsSchema>
export function resolveReferences(refs:ChatRefs={}){
  refsSchema.parse(refs)
  const notes=[...new Set(refs.noteIds??[])].map(id=>{
    const note=getNote(id)
    if(!note||note.deleted_at!==null)throw new Error('引用笔记已删除或不存在，请移除后重试')
    return {noteId:id,title:note.title,body:parseFrontmatter(readNoteFile(note.relative_path)).body}
  })
  const enabled=refs.skills?.length?scanSkills().filter(s=>s.enabled):[]
  const skills=[...new Set(refs.skills??[])].map(name=>{
    const skill=enabled.find(s=>s.name===name)
    if(!skill)throw new Error('引用技能已停用或不存在，请重新选择')
    if(fs.lstatSync(skill.path).isSymbolicLink())throw new Error('技能文件不可为符号链接')
    return `## ${name}\n${fs.readFileSync(skill.path,'utf8').slice(0,8000)}`
  })
  return{notes,skills}
}
