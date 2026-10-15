import crypto from 'node:crypto'
import {z} from 'zod'
import {register,type SysContext} from './registry'
import {getDb} from '../db/client'
import {createNote} from '../db/repos/notes'
import {encryptSecret,decryptSecret} from '../security/secrets'
interface MailAccount {id:string;name:string;host:string;port:number;user:string;password_enc:string;smtp_host:string|null;smtp_port:number}
function tables():void{getDb().exec(`CREATE TABLE IF NOT EXISTS mail_accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,user TEXT NOT NULL,password_enc TEXT NOT NULL,smtp_host TEXT,smtp_port INTEGER NOT NULL DEFAULT 465);
 CREATE TABLE IF NOT EXISTS mail_imports(account_id TEXT NOT NULL,mailbox TEXT NOT NULL,validity TEXT NOT NULL,uid INTEGER NOT NULL,note_id TEXT NOT NULL,PRIMARY KEY(account_id,mailbox,validity,uid));`)}
function account(id:string):MailAccount{tables();const row=getDb().prepare('SELECT * FROM mail_accounts WHERE id=?').get(id) as MailAccount|undefined;if(!row)throw new Error('邮件账户不存在');return row}
export async function importMailSource(source:Buffer,ctx:Pick<SysContext,'emit'>):Promise<{noteId:string}> {
  const {simpleParser}=await import('mailparser'),mail=await simpleParser(source)
  const body=`# ${mail.subject??'无标题邮件'}\n\n发件人：${mail.from?.text??''}\n收件人：${Array.isArray(mail.to)?mail.to.map(a=>a.text).join(', '):mail.to?.text??''}\n时间：${mail.date?.toISOString()??''}\n\n${mail.text??''}`
  const note=createNote({title:mail.subject??'无标题邮件',body,source:'mail_message',type:'mail'})
  ctx.emit('notes.changed',{kind:'mail',noteIds:[note.note_id]});return{noteId:note.note_id}
}
export function registerMailDomain():void {
  register('mail',{
    accounts:{handler:async()=>{tables();return{items:getDb().prepare('SELECT id,name,host,port,user,smtp_host,smtp_port FROM mail_accounts ORDER BY name').all()}}},
    save_account:{schema:z.object({id:z.string().optional(),name:z.string(),host:z.string(),port:z.number().int().default(993),user:z.string(),password:z.string().optional(),smtpHost:z.string().optional(),smtpPort:z.number().int().default(465)}),handler:async(p:{id?:string;name:string;host:string;port:number;user:string;password?:string;smtpHost?:string;smtpPort:number})=>{
      tables();const id=p.id??crypto.randomUUID(),old=getDb().prepare('SELECT password_enc FROM mail_accounts WHERE id=?').get(id) as {password_enc:string}|undefined
      const encrypted=p.password?encryptSecret(p.password):old?.password_enc;if(!encrypted)throw new Error('需要邮件密码或应用专用密码')
      getDb().prepare('INSERT INTO mail_accounts(id,name,host,port,user,password_enc,smtp_host,smtp_port) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,user=excluded.user,password_enc=excluded.password_enc,smtp_host=excluded.smtp_host,smtp_port=excluded.smtp_port').run(id,p.name,p.host,p.port,p.user,encrypted,p.smtpHost??null,p.smtpPort)
      return{id}
    }},
    remove_account:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{tables();getDb().prepare('DELETE FROM mail_accounts WHERE id=?').run(p.id);getDb().prepare('DELETE FROM mail_imports WHERE account_id=?').run(p.id);return{ok:true}}},
    sync:{schema:z.object({id:z.string(),mailbox:z.string().default('INBOX'),limit:z.number().int().min(1).max(200).default(50)}),handler:async(p:{id:string;mailbox:string;limit:number},ctx)=>{
      const row=account(p.id),workspace=(await import('./app')).getWorkspacePath()
      const {ImapFlow}=await import('imapflow'),client=new ImapFlow({host:row.host,port:row.port,secure:true,auth:{user:row.user,pass:decryptSecret(row.password_enc)},logger:false,socketTimeout:30000,connectionTimeout:15000})
      let imported=0;await client.connect()
      try {
        const lock=await client.getMailboxLock(p.mailbox)
        try {
          const box=client.mailbox;if(!box)return{imported:0}
          const validity=String(box.uidValidity),count=box.exists
          if(!count)return{imported:0}
          for await(const message of client.fetch(`${Math.max(1,count-p.limit+1)}:*`,{uid:true,source:true})) {
            if((await import('./app')).getWorkspacePath()!==workspace)throw new Error('工作区已切换，邮件导入已停止')
            if(getDb().prepare('SELECT 1 FROM mail_imports WHERE account_id=? AND mailbox=? AND validity=? AND uid=?').get(p.id,p.mailbox,validity,message.uid))continue
            if(!message.source)continue
            const note=await importMailSource(message.source,ctx)
            getDb().prepare('INSERT INTO mail_imports(account_id,mailbox,validity,uid,note_id) VALUES(?,?,?,?,?)').run(p.id,p.mailbox,validity,message.uid,note.noteId);imported++
          }
        }finally{lock.release()}
      }finally{await client.logout().catch(()=>undefined)}
      return{imported}
    }},
    send:{schema:z.object({id:z.string(),to:z.string().email(),subject:z.string().max(300),text:z.string().max(100000),confirmed:z.boolean().default(false)}),handler:async(p:{id:string;to:string;subject:string;text:string;confirmed:boolean})=>{
      if(!p.confirmed)throw new Error('发送邮件需要用户确认收件人、主题和正文')
      const row=account(p.id);if(!row.smtp_host)throw new Error('未配置 SMTP')
      const nodemailer=await import('nodemailer'),transport=nodemailer.default.createTransport({host:row.smtp_host,port:row.smtp_port,secure:row.smtp_port===465,requireTLS:true,auth:{user:row.user,pass:decryptSecret(row.password_enc)},connectionTimeout:15000,socketTimeout:30000})
      try{const r=await transport.sendMail({from:row.user,to:p.to,subject:p.subject,text:p.text});return{messageId:r.messageId,accepted:r.accepted}}finally{transport.close()}
    }}
  })
}
