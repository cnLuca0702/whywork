import FailedMail from '../components/FailedMail'
import SlideOutline,{type Outline} from '../components/SlideOutline'
import MailPreview from '../components/MailPreview'
import {t} from '../i18n/zh'
import {lazy,Suspense,useEffect,useState} from 'react'
import {Alert,Button,Card,Form,Input,Modal,Select,Spin,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {useUiStore} from '../store/ui'
import type {WorkbookSnapshot} from '../../../shared/office'
import CaptureTools from './CaptureTools'
import CalendarPanel from '../components/CalendarPanel'
const OfficeSheet=lazy(()=>import('./OfficeSheet'))
interface Note {noteId:string;title:string}
interface Account {id:string;name:string;host:string;port:number;user:string;smtp_host:string|null;smtp_port:number}

/** 邮件账户表单：上方标签 + 字段下说明，按“账户 / 收信(IMAP) / 发信(SMTP)”分组（U-28） */
function MailAccountForm({accounts,accountId,setAccountId,busy,run,loadAccounts}:{accounts:Account[];accountId:string|undefined;setAccountId:(id:string|undefined)=>void;busy:boolean;run:(fn:()=>Promise<void>)=>Promise<void>;loadAccounts:()=>Promise<void>}){
 const [mailName,setMailName]=useState(''),[host,setHost]=useState(''),[user,setUser]=useState(''),[password,setPassword]=useState(''),[smtp,setSmtp]=useState('')
 const pick=(id:string|undefined)=>{
  setAccountId(id)
  const a=accounts.find(v=>v.id===id)
  if(a){setMailName(a.name);setHost(a.host);setUser(a.user);setSmtp(a.smtp_host??'')}else{setMailName('');setHost('');setUser('');setSmtp('')}
  setPassword('')
 }
 return <Card title="邮件账户"><Form layout="vertical" className="max-w-md">
  <Form.Item label="已有账户"><Select allowClear placeholder="选择已保存的账户" value={accountId} options={accounts.map(a=>({value:a.id,label:a.name}))} onChange={pick}/></Form.Item>
  <Form.Item label="账户名称" required><Input placeholder="如：工作邮箱" value={mailName} onChange={e=>setMailName(e.target.value)}/></Form.Item>
  <Form.Item label="邮箱地址" required><Input placeholder="name@example.com" value={user} onChange={e=>setUser(e.target.value)}/></Form.Item>
  <Form.Item label="收信主机（IMAP · SSL 993）" required><Input placeholder="imap.example.com" value={host} onChange={e=>setHost(e.target.value)}/></Form.Item>
  <Form.Item label="发信主机（SMTP · SSL 465）" required extra="留空时与收信主机同域，由服务器自动协商。"><Input placeholder="smtp.example.com" value={smtp} onChange={e=>setSmtp(e.target.value)}/></Form.Item>
  <Form.Item label="应用专用密码" extra={accountId?'编辑时留空表示保留已保存的密码。':'仅保存在本机。'}><Input.Password autoComplete="off" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)}/></Form.Item>
  <div className="flex flex-wrap gap-2">
   <Button type="primary" loading={busy} onClick={()=>void run(async()=>{
    const r=await sys<{id:string}>('mail.save_account',{id:accountId,name:mailName,host,user,password:password||undefined,smtpHost:smtp||undefined});setAccountId(r.id);setPassword('');await loadAccounts()
   })}>保存账户</Button>
   <Button disabled={!accountId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<{imported:number}>('mail.sync',{id:accountId});void message.success(`已导入 ${r.imported} 封邮件`)})}>同步最近邮件</Button>
   <Button disabled={!accountId} danger onClick={()=>{let removeNotes=false;Modal.confirm({title:t('mail.removeAccount'),content:<label><input type="checkbox" onChange={e=>{removeNotes=e.target.checked}}/> {t('mail.removeNotes')}</label>,onOk:()=>run(async()=>{await sys('mail.remove_account',{id:accountId,removeNotes});setAccountId(undefined);await loadAccounts()})})}}>移除</Button>
  </div>
 </Form></Card>
}

export default function ToolsView() {
 const [outline,setOutline]=useState<Outline|null>(null)
 const [clock,setClock]=useState(Date.now())
 const [qr,setQr]=useState<{qr:string;expires:number;scope:string}|null>(null),[devices,setDevices]=useState<{device_id:string;name:string;platform:string}[]>([])
 // 倒计时只在配对码存在时走表，避免整页每秒重渲
 useEffect(()=>{if(!qr)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[qr])
 useSysEvent('pair.bound',p=>{setQr(null);message.success(t('pair.bound',{name:(p as {name:string}).name}));void loadDevices()})
 const toolsTab=useUiStore(s=>s.toolsTab)
 const [attachmentText,setAttachmentText]=useState('')
 const [mailPreview,setMailPreview]=useState<Record<string,string>|null>(null)
 const [busy,setBusy]=useState(false),[notes,setNotes]=useState<Note[]>([]),[noteId,setNoteId]=useState<string>()
 const [opened,setOpened]=useState<{sessionId:string;snapshot:WorkbookSnapshot;warning:string}|null>(null)
 const [output,setOutput]=useState('')
 const [accounts,setAccounts]=useState<Account[]>([]),[accountId,setAccountId]=useState<string>()
 const [to,setTo]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState('')
 const [url,setUrl]=useState(''),[pageText,setPageText]=useState('')
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){void message.error(String(e))}finally{setBusy(false)}}
 const loadAccounts=()=>sys<{items:Account[]}>('mail.accounts').then(r=>setAccounts(r.items))
 const loadDevices=()=>sys<{items:typeof devices}>('pair.devices').then(r=>setDevices(r.items))
 useEffect(()=>{
  void sys<{items:Note[]}>('notes.list',{limit:200}).then(r=>setNotes(r.items)).catch(()=>undefined)
  void loadAccounts().catch(()=>undefined);void loadDevices().catch(()=>undefined)
  return()=>{void sys('pair.stop').catch(()=>undefined)}
 },[])
 if(opened)return <Suspense fallback={<Spin/>}><OfficeSheet {...opened} onClose={()=>setOpened(null)}/></Suspense>
 const notePicker=<Select className="w-full" placeholder="选择知识库笔记" value={noteId} onChange={setNoteId} options={notes.map(n=>({value:n.noteId,label:n.title}))}/>
 // 面板头已有唯一标题（App.tsx ww-panel-bar），此处直接渲染当前工具的内容，不再有内部标签页（U-07/U-10）
 const panels:Record<string,React.ReactNode>={
  capture:<CaptureTools/>,
  office:<div className="space-y-4">
    <Card title="表格"><p className="mb-3">打开 XLSX 创建工作区副本，使用中文表格编辑器。原始文件保留。</p><Button type="primary" loading={busy} onClick={()=>void run(async()=>{
      const r=await sys<{canceled:boolean;sessionId:string;snapshot:WorkbookSnapshot;warning:string}>('office.open_xlsx');if(!r.canceled)setOpened(r)
    })}>打开表格</Button></Card>
    <Card title="笔记转 Word / PPT"><div className="space-y-3">{notePicker}<div className="flex gap-2">
      <Button disabled={!noteId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<{path:string;warning:string}>('office.note_docx',{noteId});setOutput(r.path);void message.info(r.warning)})}>导出 Word</Button>
      <Button disabled={!noteId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<Outline>('office.ai_slides',{noteId});setOutline(r)})}>AI 生成 PPT</Button>
    </div>{outline&&<SlideOutline initial={outline} onCreated={setOutput} onClose={()=>setOutline(null)}/>}
    {output&&<div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{output}</span><Button onClick={()=>void run(async()=>{await sys('export.copy_file',{path:output})})}>另存为</Button></div>}
    <Alert type="info" showIcon message="Word 保留基本格式、列表、表格、链接与工作区图片；复杂版式和数学公式排版暂不还原。AI 生成内容请核对后使用。"/></div></Card>
  </div>,
  calendar:<CalendarPanel/>,
  mail:<div className="space-y-4">
    <MailAccountForm accounts={accounts} accountId={accountId} setAccountId={setAccountId} busy={busy} run={run} loadAccounts={loadAccounts}/>
    <Card title="发送邮件"><Form layout="vertical" className="max-w-md"><div className="space-y-2">
      <Form.Item label={t('mail.to')} required><Input value={to} onChange={e=>setTo(e.target.value)} placeholder="name@example.com，多个用逗号分隔"/></Form.Item>
      <Form.Item label={t('mail.subject')} required><Input value={subject} onChange={e=>setSubject(e.target.value)}/></Form.Item>
      <Form.Item label={t('mail.text')}><Input.TextArea rows={6} value={body} onChange={e=>setBody(e.target.value)}/></Form.Item>
      <Form.Item label={t('mail.attachments')}><Input.TextArea rows={2} value={attachmentText} onChange={e=>setAttachmentText(e.target.value)}/></Form.Item>
      <Button type="primary" disabled={!accountId||!to||!subject} loading={busy} onClick={()=>setMailPreview({accountId:accountId!,to,subject,text:body,cc:'',bcc:''})}>{t('mail.preview')}</Button>
      {mailPreview&&<Card title={t('mail.preview')}><MailPreview value={mailPreview} onChange={setMailPreview} disabled={busy}/><pre>{attachmentText}</pre><div className="flex gap-2 mt-3">
        <Button type="primary" loading={busy} onClick={()=>void run(async()=>{await sys('mail.send',{attachments:attachmentText.split('\n').map(s=>s.trim()).filter(Boolean).map(path=>({path})),id:mailPreview.accountId,to:mailPreview.to,subject:mailPreview.subject,text:mailPreview.text,cc:mailPreview.cc?.split(/[,;，；]/).map(s=>s.trim()).filter(Boolean),bcc:mailPreview.bcc?.split(/[,;，；]/).map(s=>s.trim()).filter(Boolean),confirmed:true});setMailPreview(null);setBody('')})}>{t('mail.send')}</Button>
        <Button disabled={busy} onClick={()=>setMailPreview(null)}>{t('common.cancel')}</Button>
      </div></Card>}
    </div></Form></Card><FailedMail/></div>,
  browser:<Card title="网页浏览"><Alert message="首次使用下载 Chromium，网页使用独立会话，不带个人浏览器登录状态。" type="info"/>
    <div className="my-3 flex max-w-md gap-2"><Input placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/><Button type="primary" loading={busy} onClick={()=>void run(async()=>{const r=await sys<{title:string;text:string}>('browser.fetch',{url});setPageText(r.title+'\n\n'+r.text)})}>读取网页</Button></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap">{pageText}</pre>
  </Card>,
  pair:<Card title="设备绑定"><Alert type="info" message="本机配对服务骨架，五分钟有效、单次使用。手机端与局域网连接将在 Android 项目接入，当前无跨端同步。"/>
    <div className="my-3 flex gap-2"><Button type="primary" loading={busy} onClick={()=>void run(async()=>setQr(await sys('pair.start')))}>生成配对码</Button><Button onClick={()=>void run(async()=>{await sys('pair.stop');setQr(null)})}>关闭服务</Button></div>
    {qr&&<div><div className="relative inline-block"><img width={220} height={220} src={qr.qr} alt={t('pair.qr')}/>{clock>=qr.expires&&<div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--ww-bg)] opacity-95"><p>{t('pair.expired')}</p><Button onClick={()=>void run(async()=>setQr(await sys('pair.start')))}>{t('skills.refresh')}</Button></div>}</div><p>{t('pair.countdown',{n:Math.max(0,Math.ceil((qr.expires-clock)/1000))})}</p><p>{qr.scope}</p></div>}
    <Button onClick={()=>void loadDevices()}>刷新设备</Button>{devices.map(d=><div key={d.device_id} className="my-2 flex gap-2"><span className="flex-1">{d.name} · {d.platform}</span><Button danger size="small" onClick={()=>Modal.confirm({title:t('pair.removeConfirm',{name:d.name}),onOk:()=>run(async()=>{await sys('pair.remove',{id:d.device_id});await loadDevices()})})}>解绑</Button></div>)}
  </Card>
 }
 return <div className="ww-tool-page h-full overflow-auto p-5">{panels[toolsTab]??panels.capture}</div>
}
