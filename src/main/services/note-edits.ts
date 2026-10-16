export interface TextEdit {oldText:string;newText:string}
export function stripDuplicateHeading(body:string,title:string):string{
 const match=/^#\s+([^\n]+)\r?\n?/.exec(body)
 return match?.[1]?.trim()===title.trim()?body.slice(match[0].length).replace(/^\s*\n/,''):body
}
function occurrences(text:string,needle:string):number[]{
 const result:number[]=[]
 for(let i=text.indexOf(needle);i>=0;i=text.indexOf(needle,i+1))result.push(i)
 return result
}
function normalized(text:string):{text:string;positions:number[]}{
 const positions:number[]=[],parts:string[]=[];let offset=0
 const lines=text.split('\n')
 lines.forEach((line,index)=>{
  const trimmed=line.trim(),leading=line.length-line.trimStart().length
  for(let i=0;i<trimmed.length;i++)positions.push(offset+leading+i)
  parts.push(trimmed)
  if(index<lines.length-1)positions.push(offset+line.length)
  offset+=line.length+1
 })
 return{text:parts.join('\n'),positions}
}
export function applyNoteEdits(body:string,edits:TextEdit[]):string{
 if(!edits.length)throw new Error('至少需要一条修改')
 const spans=edits.map((edit,index)=>{
  if(!edit.oldText.trim())throw new Error(`第${index+1}条：原文不能为空`)
  let matches=occurrences(body,edit.oldText),start=matches[0]??-1,end=start+edit.oldText.length
  if(!matches.length){
   const hay=normalized(body),needle=normalized(edit.oldText).text
   matches=occurrences(hay.text,needle)
   if(matches.length){start=hay.positions[matches[0]!]!;end=hay.positions[matches[0]!+needle.length-1]!+1}
  }
  if(!matches.length)throw new Error(`第${index+1}条：未找到原文`)
  if(matches.length>1)throw new Error(`第${index+1}条：原文出现多次`)
  return{start,end,replacement:edit.newText,index}
 })
 for(let i=0;i<spans.length;i++)for(let j=0;j<i;j++){
  const a=spans[i]!,b=spans[j]!
  if(a.start<b.end&&b.start<a.end)throw new Error(`第${a.index+1}条：与第${b.index+1}条重叠`)
 }
 let result=body
 for(const span of spans.sort((a,b)=>b.start-a.start))result=result.slice(0,span.start)+span.replacement+result.slice(span.end)
 return result
}
export function appendNote(body:string,append:string):string{
 if(!append.trim())throw new Error('追加内容不能为空')
 return body.trimEnd()+(body.trim()?'\n\n':'')+append.trim()+'\n'
}
export function noteLines(body:string,offset=1,limit?:number){
 const lines=body.split('\n'),start=offset<0?Math.max(0,lines.length+offset):offset-1
 return{body:lines.slice(start,limit===undefined?undefined:start+limit).join('\n'),totalLines:lines.length}
}
export function assertEditableSource(source:string,actor?:string){
 if(actor==='agent'&&!['manual','text','journal','chat'].includes(source))throw new Error('导入或转写类笔记的原始正文受保护；可修改标题、状态、集合，或另建笔记')
}
