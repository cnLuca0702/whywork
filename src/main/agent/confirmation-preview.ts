import type {ConfirmPreview} from '../../shared/confirmation'
export function confirmationPreview(name:string,args:Record<string,unknown>,bulk=false):ConfirmPreview {
 const text=(key:string)=>typeof args[key]==='string'?String(args[key]):''
 if(name==='mail.send')return {kind:'mail',title:'发送邮件',fields:[{label:'账户',value:text('id')},{label:'收件人',value:text('to')},{label:'主题',value:text('subject')},...(Array.isArray(args.attachments)?args.attachments.map(a=>({label:'附件',value:String((a as {path?:string}).path??'')})):[])],body:text('text'),editable:{accountId:text('id'),to:text('to'),cc:Array.isArray(args.cc)?args.cc.join(', '):'',bcc:Array.isArray(args.bcc)?args.bcc.join(', '):'',subject:text('subject'),text:text('text')}}
 if(name.startsWith('mcp'))return {kind:'mcp',title:'调用 MCP 工具',fields:[{label:'工具',value:name}],warnings:['外部工具产生的变更无法通过本地保险箱撤销']}
 if(name==='browser.eval')return {kind:'browser_eval',title:'在网页中执行脚本',fields:[{label:'网页',value:text('url')}],body:text('script').slice(0,2000)}
 if(name==='notes.delete')return {kind:'note_delete',title:'删除笔记',fields:[{label:'笔记',value:text('noteId')}],warnings:['可在保险箱中回滚']}
 if(name==='file.delete')return {kind:'file_delete',title:'删除文件',fields:[{label:'路径',value:text('path')}],warnings:['可在保险箱中回滚']}
 return {kind:bulk?'bulk':'file_write',title:bulk?'继续批量写入':'写入或移动文件',fields:[{label:'路径',value:text('path')||text('from')||text('noteId')},{label:'目标',value:text('to')}].filter(f=>f.value),body:(text('content')||text('body')||text('append')).split('\n').slice(0,10).join('\n').slice(0,2000),warnings:bulk?['本轮已超过5次写操作；此卡确认下一项写入']:undefined}
}
export function applyConfirmationOverride(name:string,args:Record<string,unknown>,override?:Record<string,unknown>):Record<string,unknown>{
 if(!override||!Object.keys(override).length)return args
 if(name!=='mail.send')throw new Error('此操作不允许修改参数')
 const allowed=new Set(['to','cc','bcc','subject','text','accountId'])
 for(const [key,value]of Object.entries(override))if(!allowed.has(key)||typeof value!=='string')throw new Error('确认卡参数不在可编辑白名单中')
 const next={...args,...override}
 if('accountId'in next){next.id=next.accountId;delete next.accountId}
 for(const key of ['cc','bcc'])if(typeof next[key]==='string')next[key]=String(next[key]).split(/[,;，；]/).map(v=>v.trim()).filter(Boolean)
 return next
}
