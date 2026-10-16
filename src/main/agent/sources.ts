export interface NoteSource {n:number;noteId:string;title:string;snippet:string}
export class SourceRegistry {
  readonly sources:NoteSource[]=[]
  add(noteId:string,title:string,snippet:string):NoteSource {
    const existing=this.sources.find(s=>s.noteId===noteId)
    if(existing)return existing
    const source={n:this.sources.length+1,noteId,title,snippet:snippet.slice(0,500)}
    this.sources.push(source);return source
  }
  capture(action:string,data:unknown):string {
    if(!['notes.get','notes.list','notes.search'].includes(action)||!data||typeof data!=='object')return ''
    const d=data as {note?:{noteId:string;title:string};body?:string;items?:{noteId:string;title:string;preview?:string;snippet?:string;summary?:string}[]}
    const entries=d.note?[{...d.note,snippet:d.body??''}]:d.items??[]
    return entries.map(e=>{const s=this.add(e.noteId,e.title,e.snippet??('preview' in e?e.preview:undefined)??('summary' in e?e.summary:undefined)??'');return `[来源 ${s.n}] ${s.title}`}).join('\n')
  }
}
export function referenceContext(notes:{noteId:string;title:string;body:string}[],sources:SourceRegistry):string{
  let budget=24000
  return notes.map(note=>{
    const text=note.body.slice(0,Math.min(8000,budget));budget-=text.length
    const s=sources.add(note.noteId,note.title,text)
    return `[来源 ${s.n}] ${note.title}\n${text}${text.length<note.body.length?'\n（引用正文已截断）':''}`
  }).join('\n\n')
}
