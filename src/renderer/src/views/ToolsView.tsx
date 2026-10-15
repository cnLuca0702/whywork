import {lazy,Suspense,useEffect,useState} from 'react'
import {Alert,Button,Card,Input,Modal,Select,Spin,Table,Tabs,message} from 'antd'
import {sys} from '../api'
import {useUiStore} from '../store/ui'
import type {WorkbookSnapshot} from '../../../shared/office'
import CaptureTools from './CaptureTools'
const OfficeSheet=lazy(()=>import('./OfficeSheet'))
interface Note {noteId:string;title:string}
interface Account {id:string;name:string;host:string;port:number;user:string;smtp_host:string|null;smtp_port:number}
export default function ToolsView() {
  const toolsTab=useUiStore(s=>s.toolsTab)
  const [busy,setBusy]=useState(false),[notes,setNotes]=useState<Note[]>([]),[noteId,setNoteId]=useState<string>()
  const [opened,setOpened]=useState<{sessionId:string;snapshot:WorkbookSnapshot;warning:string}|null>(null)
  const [output,setOutput]=useState(''),[calendar,setCalendar]=useState<Record<string,unknown>[]>([]),[calendarQuery,setCalendarQuery]=useState('')
  const [accounts,setAccounts]=useState<Account[]>([]),[accountId,setAccountId]=useState<string>()
  const [mailName,setMailName]=useState(''),[host,setHost]=useState(''),[user,setUser]=useState(''),[password,setPassword]=useState(''),[smtp,setSmtp]=useState('')
  const [to,setTo]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState('')
  const [qr,setQr]=useState<{qr:string;expires:number;scope:string}|null>(null),[devices,setDevices]=useState<{device_id:string;name:string;platform:string}[]>([])
  const [url,setUrl]=useState(''),[pageText,setPageText]=useState('')
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){void message.error(String(e))}finally{setBusy(false)}}
  const loadAccounts=()=>sys<{items:Account[]}>('mail.accounts').then(r=>setAccounts(r.items))
  const loadDevices=()=>sys<{items:typeof devices}>('pair.devices').then(r=>setDevices(r.items))
  const searchCalendar=()=>sys<{items:Record<string,unknown>[]}>('calendar.search',{query:calendarQuery}).then(r=>setCalendar(r.items))
  useEffect(()=>{
    void sys<{items:Note[]}>('notes.list',{limit:200}).then(r=>setNotes(r.items)).catch(()=>undefined)
    void loadAccounts().catch(()=>undefined);void loadDevices().catch(()=>undefined);void searchCalendar().catch(()=>undefined)
    return()=>{void sys('pair.stop').catch(()=>undefined)}
  },[])
  if(opened)return <Suspense fallback={<Spin/>}><OfficeSheet {...opened} onClose={()=>setOpened(null)}/></Suspense>
  const notePicker=<Select className="w-full" placeholder="选择知识库笔记" value={noteId} onChange={setNoteId} options={notes.map(n=>({value:n.noteId,label:n.title}))}/>
  return <div className="h-full overflow-auto p-5"><h2 className="mb-4 text-xl">工作工具</h2><Tabs activeKey={toolsTab} onChange={tab=>void useUiStore.getState().setToolsTab(tab)} items={[
    {key:'capture',label:'采集',children:<CaptureTools/>},
    {key:'office',label:'Office',children:<div className="space-y-4">
      <Card title="表格"><p className="mb-3">打开 XLSX 创建工作区副本，使用中文表格编辑器。原始文件保留。</p><Button loading={busy} onClick={()=>void run(async()=>{
        const r=await sys<{canceled:boolean;sessionId:string;snapshot:WorkbookSnapshot;warning:string}>('office.open_xlsx');if(!r.canceled)setOpened(r)
      })}>打开表格</Button></Card>
      <Card title="笔记转 Word / PPT"><div className="space-y-3">{notePicker}<div className="flex gap-2">
        <Button disabled={!noteId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<{path:string;warning:string}>('office.note_docx',{noteId});setOutput(r.path);void message.info(r.warning)})}>导出 Word</Button>
        <Button disabled={!noteId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<{path:string}>('office.ai_slides',{noteId});setOutput(r.path)})}>AI 生成 PPT</Button>
      </div>{output&&<div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{output}</span><Button onClick={()=>void run(async()=>{await sys('export.copy_file',{path:output})})}>另存为</Button></div>}
      <Alert type="info" showIcon message="Word 保留基本格式、列表、表格、链接与工作区图片；复杂版式和数学公式排版暂不还原。AI 生成内容请核对后使用。"/></div></Card>
    </div>},
    {key:'calendar',label:'日历',children:<Card title="ICS 日历"><div className="mb-4 flex gap-2"><Button loading={busy} onClick={()=>void run(async()=>{await sys('calendar.import');await searchCalendar()})}>导入日历</Button><Input.Search placeholder="搜索事件" value={calendarQuery} onChange={e=>setCalendarQuery(e.target.value)} onSearch={()=>void searchCalendar()}/></div>
      <Table size="small" rowKey="id" dataSource={calendar} columns={[{title:'事件',dataIndex:'title'},{title:'开始',dataIndex:'start',render:value=>new Date(Number(value)).toLocaleString()},{title:'地点',dataIndex:'location'}]}/>
    </Card>},
    {key:'mail',label:'邮件',children:<div className="space-y-4"><Card title="邮件账户"><div className="space-y-2">
      <Select className="w-full" allowClear placeholder="已有账户" value={accountId} options={accounts.map(a=>({value:a.id,label:a.name}))} onChange={id=>{setAccountId(id);const a=accounts.find(v=>v.id===id);if(a){setMailName(a.name);setHost(a.host);setUser(a.user);setSmtp(a.smtp_host??'')}else{setMailName('');setHost('');setUser('');setSmtp('')}setPassword('')}}/>
      <Input placeholder="账户名称" value={mailName} onChange={e=>setMailName(e.target.value)}/><Input placeholder="IMAP 主机（SSL 993）" value={host} onChange={e=>setHost(e.target.value)}/>
      <Input placeholder="邮箱地址" value={user} onChange={e=>setUser(e.target.value)}/><Input.Password placeholder="应用专用密码（编辑时留空保留）" value={password} onChange={e=>setPassword(e.target.value)}/><Input placeholder="SMTP 主机（SSL 465）" value={smtp} onChange={e=>setSmtp(e.target.value)}/>
      <div className="flex gap-2"><Button loading={busy} onClick={()=>void run(async()=>{const r=await sys<{id:string}>('mail.save_account',{id:accountId,name:mailName,host,user,password:password||undefined,smtpHost:smtp||undefined});setAccountId(r.id);setPassword('');await loadAccounts()})}>保存</Button>
      <Button disabled={!accountId} loading={busy} onClick={()=>void run(async()=>{const r=await sys<{imported:number}>('mail.sync',{id:accountId});void message.success(`已导入 ${r.imported} 封邮件`)})}>同步最近邮件</Button>
      <Button disabled={!accountId} danger onClick={()=>Modal.confirm({title:'移除邮件账户？',content:'已导入笔记会保留。',onOk:()=>run(async()=>{await sys('mail.remove_account',{id:accountId});setAccountId(undefined);await loadAccounts()})})}>移除</Button></div>
    </div></Card><Card title="发送邮件"><div className="space-y-2"><Input placeholder="收件人完整邮箱" value={to} onChange={e=>setTo(e.target.value)}/><Input placeholder="主题" value={subject} onChange={e=>setSubject(e.target.value)}/><Input.TextArea rows={6} placeholder="正文" value={body} onChange={e=>setBody(e.target.value)}/>
      <Button disabled={!accountId||!to||!subject} loading={busy} onClick={()=>Modal.confirm({title:'确认发送邮件',content:<div><p>{to}</p><b>{subject}</b><pre className="max-h-56 overflow-auto whitespace-pre-wrap">{body}</pre></div>,okText:'发送',cancelText:'取消',onOk:()=>run(async()=>{await sys('mail.send',{id:accountId,to,subject,text:body,confirmed:true});void message.success('邮件已发送');setBody('')})})}>检查并发送</Button>
    </div></Card></div>},
    {key:'browser',label:'动态网页',children:<Card title="隔离浏览器"><Alert message="首次使用下载 Chromium，网页使用独立会话，不带个人浏览器登录状态。" type="info"/>
      <div className="my-3 flex gap-2"><Input placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/><Button loading={busy} onClick={()=>void run(async()=>{const r=await sys<{title:string;text:string}>('browser.fetch',{url});setPageText(r.title+'\n\n'+r.text)})}>读取网页</Button></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap">{pageText}</pre>
    </Card>},
    {key:'pair',label:'设备绑定',children:<Card title="手机绑定预留"><Alert type="info" message="本机配对服务骨架，五分钟有效、单次使用。手机端与局域网连接将在 Android 项目接入，当前无跨端同步。"/>
      <div className="my-3 flex gap-2"><Button loading={busy} onClick={()=>void run(async()=>setQr(await sys('pair.start')))}>生成配对码</Button><Button onClick={()=>void run(async()=>{await sys('pair.stop');setQr(null)})}>关闭服务</Button></div>
      {qr&&<div><img width={220} height={220} src={qr.qr}/><p>{qr.scope}</p><p>到期时间：{new Date(qr.expires).toLocaleTimeString()}</p></div>}
      <Button onClick={()=>void loadDevices()}>刷新设备</Button>{devices.map(d=><div key={d.device_id} className="my-2 flex gap-2"><span className="flex-1">{d.name} · {d.platform}</span><Button danger size="small" onClick={()=>void run(async()=>{await sys('pair.remove',{id:d.device_id});await loadDevices()})}>解绑</Button></div>)}
    </Card>}
  ]}/></div>
}
