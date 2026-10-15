import fs from 'node:fs/promises'
import path from 'node:path'
export interface Candidate { relativePath:string; name:string; size:number }
const extensions=new Set(['.md','.markdown','.txt','.pdf','.docx','.enex','.png','.jpg','.jpeg','.gif','.webp','.wav','.mp3','.m4a','.aiff','.flac','.ogg','.webm'])
export class CandidateScope {
  private constructor(readonly root:string,private dev:number,private ino:number){}
  static async create(selected:string):Promise<CandidateScope>{
    const root=await fs.realpath(selected),s=await fs.stat(root)
    if(!s.isDirectory())throw new Error('请选择目录')
    if(root.split(path.sep).some(p=>p.startsWith('.')))throw new Error('不允许搜索隐藏目录或应用元数据')
    return new CandidateScope(root,s.dev,s.ino)
  }
  async resolve(relativePath:string):Promise<string>{
    const root=await fs.lstat(this.root)
    if(!root.isDirectory()||root.isSymbolicLink()||root.dev!==this.dev||root.ino!==this.ino||await fs.realpath(this.root)!==this.root)throw new Error('授权目录已变化，请重新选择')
    const parts=relativePath.split(/[\\/]/)
    if(!relativePath||path.isAbsolute(relativePath)||parts.some(p=>!p||p==='..'||p.startsWith('.')))throw new Error('不允许的候选路径')
    let abs=this.root
    for(const part of parts){abs=path.join(abs,part);const s=await fs.lstat(abs);if(s.isSymbolicLink())throw new Error('不读取符号链接')}
    if(!(await fs.stat(abs)).isFile()||!extensions.has(path.extname(abs).toLowerCase()))throw new Error('不支持的候选文件')
    return abs
  }
  async find(query:string,known:Set<string>,limit=50):Promise<{items:Candidate[];truncated:boolean;visited:number}>{
    // Validate the grant even for empty directories, without reading file contents.
    const s=await fs.lstat(this.root)
    if(s.isSymbolicLink()||s.dev!==this.dev||s.ino!==this.ino||await fs.realpath(this.root)!==this.root)throw new Error('授权目录已变化，请重新选择')
    const terms=query.normalize('NFC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    if(!terms.length)return{items:[],truncated:false,visited:0}
    const canonicalKnown=new Set(await Promise.all([...known].map(p=>fs.realpath(p).catch(()=>p))))
    const items:Candidate[]=[],pending=[{dir:this.root,depth:0}];let visited=0,truncated=false
    const deadline=Date.now()+1500
    while(pending.length){
      const next=pending.pop()!
      if(next.depth>12){truncated=true;continue}
      let directory
      try{const real=await fs.realpath(next.dir);if(real!==next.dir||(real!==this.root&&!real.startsWith(this.root+path.sep)))continue;directory=await fs.opendir(next.dir)}catch{continue}
      for await(const entry of directory){
        if(++visited>10000||Date.now()>deadline||items.length>=limit){truncated=true;break}
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue
        const abs=path.join(next.dir,entry.name)
        if(entry.isDirectory()){pending.push({dir:abs,depth:next.depth+1});continue}
        if(!entry.isFile()||!extensions.has(path.extname(entry.name).toLowerCase())||canonicalKnown.has(abs))continue
        if(!terms.every(t=>entry.name.normalize('NFC').toLocaleLowerCase().includes(t)))continue
        try{const relativePath=path.relative(this.root,abs);await this.resolve(relativePath);const stat=await fs.stat(abs);items.push({relativePath,name:entry.name,size:stat.size})}catch{/* skip changed/unreadable entry */}
      }
      if(truncated&&(visited>10000||Date.now()>deadline||items.length>=limit))break
    }
    return{items,truncated,visited}
  }
}
export function literalMatch(title:string,body:string,query:string):{score:number;snippet:string}|null {
  const terms=[...new Set(query.normalize('NFC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))]
  const t=title.normalize('NFC').toLocaleLowerCase(),b=body.normalize('NFC').toLocaleLowerCase()
  if(!terms.length||!terms.every(term=>t.includes(term)||b.includes(term)))return null
  const at=Math.max(0,b.indexOf(terms.find(term=>b.includes(term))??''))
  return{score:terms.reduce((n,term)=>n+(t.includes(term)?3:0)+(b.includes(term)?1:0),0),snippet:body.normalize('NFC').slice(Math.max(0,at-40),at+180)}
}
