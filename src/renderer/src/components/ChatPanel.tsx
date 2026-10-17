import VaultPanel from './VaultPanel'
import ConfirmCard from './ConfirmCard'
import MarkdownContent,{openCitation} from './MarkdownContent'
import ChatComposer from './ChatComposer'
import {t} from '../i18n/zh'
import {RecordingStrip} from './RecordingControls'
import brandIcon from '../../../../resources/icon.svg'
import { useEffect, useRef, useState,type ReactNode } from 'react'
import { Button, Input, Modal, Select, Spin, Tag, Tooltip, message } from 'antd'
import {
  ApiOutlined,
  AudioOutlined,
  CalendarOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  MailOutlined,
  PlusOutlined,
  PushpinOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  TableOutlined,
  ToolOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { sys, useSysEvent } from '../api'
import { useChatStore, wireChatEvents, type ChatMsg } from '../store/chat'
import { useUiStore } from '../store/ui'

wireChatEvents()

/** 工具调用的一行可读展示：图标 + 人类可读名称 + 关键参数，原始 JSON 折叠在“详情”（U-15） */
const TOOL_META: Record<string,{icon:ReactNode;label:string;param?:(args:Record<string,unknown>)=>string}> = {
 'notes.create':{icon:<FileAddOutlined/>,label:'新建笔记',param:a=>String(a.title??'')},
 'notes.update':{icon:<EditOutlined/>,label:'修改笔记',param:a=>String(a.title??a.noteId??'')},
 'notes.delete':{icon:<DeleteOutlined/>,label:'删除笔记',param:a=>String(a.noteId??'')},
 'notes.get':{icon:<FileTextOutlined/>,label:'读取笔记',param:a=>String(a.noteId??'')},
 'notes.list':{icon:<UnorderedListOutlined/>,label:'列出笔记',param:a=>String(a.query??a.titleQuery??'')},
 'notes.search':{icon:<SearchOutlined/>,label:'搜索笔记',param:a=>String(a.query??'')},
 'notes.set_status':{icon:<PushpinOutlined/>,label:'更新笔记状态',param:a=>String(a.noteId??'')},
 'notes.attach_image':{icon:<FileTextOutlined/>,label:'附加图片',param:a=>String(a.path??'')},
 'file.read':{icon:<FileTextOutlined/>,label:'读取文件',param:a=>String(a.path??'')},
 'file.read_document':{icon:<FileTextOutlined/>,label:'读取文档',param:a=>String(a.path??'')},
 'file.write':{icon:<EditOutlined/>,label:'写入文件',param:a=>String(a.path??'')},
 'file.list':{icon:<UnorderedListOutlined/>,label:'列出文件',param:a=>String(a.path??'')},
 'browser.fetch':{icon:<GlobalOutlined/>,label:'读取网页',param:a=>String(a.url??'')},
 'browser.eval':{icon:<GlobalOutlined/>,label:'执行网页脚本',param:a=>String(a.url??'')},
 'mail.send':{icon:<MailOutlined/>,label:'发送邮件',param:a=>String(a.subject??'')},
 'get_local_time':{icon:<ClockCircleOutlined/>,label:'获取本机时间'},
 'mcp.search_tools':{icon:<ApiOutlined/>,label:'搜索 MCP 工具',param:a=>String(a.query??'')},
 'mcp.list_tools':{icon:<ApiOutlined/>,label:'列出 MCP 工具',param:a=>String(a.server??'')},
 'mcp.call':{icon:<ApiOutlined/>,label:'调用 MCP 工具',param:a=>String(a.name??a.tool??'')}
}
function describeTool(name:string,argsJson:string){
 let args:Record<string,unknown>={}
 try{args=JSON.parse(argsJson||'{}') as Record<string,unknown>}catch{/* 保留原始 JSON 展示 */}
 const mcpMatch=/^mcp__(.+)__([^_].*)$/.exec(name)
 const meta=mcpMatch
  ?{icon:<ApiOutlined/>,label:`MCP · ${mcpMatch[1]} / ${mcpMatch[2]}`,param:undefined}
  :TOOL_META[name.replaceAll('__','.')]??{icon:<ToolOutlined/>,label:name,param:undefined}
 return {meta,args,param:meta.param?.(args)??''}
}
function ToolCard({ name, phase, output, argsJson }: { name: string; phase: string; output?: string; argsJson?: string }) {
 const {meta,args,param}=describeTool(name,argsJson??'')
 return (
  <div className={`ww-tool-line ${phase==='error'?'is-error':''}`}>
   <span className="ww-tool-icon">{meta.icon}</span>
   <span className="ww-tool-title">{meta.label}{param?` · ${param}`:''}</span>
   {phase==='start'?<Spin size="small"/>:phase==='error'
    ?<span className="flex items-center gap-1 text-red-500"><CloseCircleFilled/>失败</span>
    :phase==='recorded'
     ?<span className="flex items-center gap-1 text-[var(--ww-text-3)]"><ClockCircleFilled/>调用记录</span>
     :<span className="flex items-center gap-1 text-emerald-500"><CheckCircleFilled/>完成</span>}
   <details className="ww-tool-detail">
    <summary>{t('chat.toolDetail')}</summary>
    <pre>{JSON.stringify({tool:name,...args},null,2)}{output?`\n\n${output}`:''}</pre>
   </details>
  </div>
 )
}

function Reasoning({text,label}:{text:string;label:string}){
 return <details className="ww-reasoning">
  <summary><CaretRightOutlined/>{label}</summary>
  <div className="ww-reasoning-body">{text}</div>
 </details>
}

function MsgBubble({ m, last, onRegenerate }: { m: ChatMsg; last?:boolean; onRegenerate?:()=>void }) {
  if (m.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="ww-user-bubble whitespace-pre-wrap rounded-xl px-3 py-2 text-sm">{m.content}{m.refs?.noteIds?.map(id=><Button key={id} size="small" type="text" onClick={()=>void openCitation({n:0,noteId:id,title:id,snippet:''})}>@ {m.refs?.noteTitles?.[id]??id.slice(0,8)}</Button>)}{m.refs?.skills?.map(name=><Tag key={name}>/ {name}</Tag>)}</div>
      </div>
    )
  }
  if (m.role === 'assistant') {
    if (m.toolCalls && m.toolCalls.length > 0 && !m.content && !m.reasoning) {
      return (
        <div className="mb-3">
          {m.toolCalls.map((tc) => (
            <ToolCard key={tc.id} name={tc.function.name} phase="recorded" argsJson={tc.function.arguments} />
          ))}
        </div>
      )
    }
    return <div className="ww-assistant mb-3 text-sm">
      {m.usage&&<div className="text-xs text-[var(--ww-text-3)]">{t('chat.usage',{n:m.usage.calls,input:m.usage.input,output:m.usage.output})}</div>}
      {m.reasoning&&<Reasoning text={m.reasoning} label={t('chat.thought',{n:m.reasoning.length})}/>}
      <MarkdownContent text={m.content??''} sources={m.sources}/>
      {!!m.sources?.length&&<div>{t('chat.sources')}{m.sources.map(s=><Button type="link" key={s.n} onClick={()=>void openCitation(s)}>[{s.n}] {s.title}</Button>)}</div>}
      <div className="ww-reply-actions">
        <Button size="small" onClick={()=>void navigator.clipboard.writeText(m.content??'').then(()=>message.success(t('chat.copied'))).catch(e=>message.error(String(e)))}>{t('chat.copy')}</Button>
        {!!m.sources?.length&&<Button size="small" onClick={()=>void navigator.clipboard.writeText((m.content??'')+'\n\n'+t('chat.sources')+'：'+m.sources!.map(s=>`[${s.n}] ${s.title}`).join('；')).catch(e=>message.error(String(e)))}>{t('chat.copySources')}</Button>}
        {last&&<Button size="small" onClick={onRegenerate}>{t('chat.regenerate')}</Button>}
      </div>
    </div>
  }

  return null
}

export default function ChatPanel() {
  const { draft:input, setDraft:setInput, activeChatId, chats, messages, streaming, streamText, streamReasoning, streamSources, confirmations, regenerate, toolEvents, error, openChat, send, stop, setModel, loadChats, draftSelection, catalog, catalogLoading, catalogError, loadCatalog } =
    useChatStore()
  const currentView=useUiStore(s=>s.view)
  const activeNoteId = useUiStore((s) => s.activeNoteId)
  const setView = useUiStore((s) => s.setView)
  useEffect(()=>{
    const prevent=(event:BeforeUnloadEvent)=>{if(useChatStore.getState().streaming){event.preventDefault();event.returnValue=t('chat.runningLock')}}
    window.addEventListener('beforeunload',prevent)
    return()=>window.removeEventListener('beforeunload',prevent)
  },[])
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [vaultCount,setVaultCount]=useState(0)
  const refreshVault=()=>{if(activeChatId)void sys<{activeCount:number}>('vault.list',{chatId:activeChatId}).then(r=>setVaultCount(r.activeCount)).catch(()=>undefined);else setVaultCount(0)}
  useEffect(refreshVault,[activeChatId,messages.length])
  useSysEvent('vault.changed',refreshVault)
  useSysEvent('notes.changed',refreshVault)
  const [vaultOpen, setVaultOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void loadChats()
    void loadCatalog()
  }, [loadChats,loadCatalog,currentView])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length, streamText, toolEvents.length])

  useSysEvent('notes.changed',payload=>{if((payload as {kind?:string})?.kind==='provider')void loadCatalog(true)})
  const activeChat = chats.find((c) => c.chatId === activeChatId)
  const selection=activeChatId?activeChat?.selection:draftSelection
  const provider=catalog.find(p=>p.id===selection?.providerId)
  const selectedModel=provider?.models.find(m=>m.id===selection?.model)
  const modelReady=!!provider?.ready&&!!selectedModel&&!catalogLoading&&!catalogError
  const selectionKey=selection?JSON.stringify([selection.providerId,selection.model]):undefined
  const options=catalog.map(p=>({label:`${p.name} · ${p.id}${p.ready?'':' · '+p.status}`,options:p.models.map(m=>({
    value:JSON.stringify([p.id,m.id]),label:`${p.name} / ${m.label}${m.label!==m.id?' ('+m.id+')':''}`,disabled:!p.ready
  }))}))

  const doSend = async () => {
    const text = input.trim()
    if (!text || streaming || sendingRef.current) return
    if(!modelReady){void message.info('请先选择当前可用的供应商和模型');return}
    sendingRef.current=true;setSending(true)
    try {
      const target=activeChatId??await openChat(null,activeNoteId)
      if(!target)throw new Error('会话已切换，消息未发送')
      setInput('')
      await send(text,target)
    } catch(e) {setInput(text);void message.error(String(e))}
    finally {sendingRef.current=false;setSending(false)}
  }
  const doRegenerate=async()=>{
    if(!activeChatId||streaming)return
    try {
      const {changes}=await sys<{changes:{rolled_back:number}[]}>('vault.list',{chatId:activeChatId})
      if(changes.some(c=>!c.rolled_back))Modal.confirm({title:t('chat.regenerate'),content:t('chat.regenerateWarning'),okText:t('common.confirm'),cancelText:t('common.cancel'),onOk:()=>regenerate(true)})
      else await regenerate()
    }catch(e){void message.error(String(e))}
  }
  const lastAssistant=[...messages].reverse().find(m=>m.role==='assistant')?.msgId
  const empty = messages.length === 0 && !streaming

  // 模型选择与发送并入输入框底部一行（U-14/U-18）
  const composerRight=(
   <>
    <Select aria-label="选择模型" showSearch optionFilterProp="label" size="small" value={selectionKey}
      placeholder="模型" loading={catalogLoading} disabled={streaming||sending}
      style={{width:170}} popupMatchSelectWidth={220}
      labelRender={()=>selectedModel?selectedModel.label:selection?`${selection.model}（需重选）`:'模型'}
      notFoundContent={catalogLoading?'正在读取目录…':'没有可选模型'}
      onChange={v=>{const [providerId,model]=JSON.parse(v);void setModel({providerId,model}).catch(e=>message.error(String(e)))}}
      options={options}
      dropdownRender={node=>(<div onMouseDown={e=>e.preventDefault()}>{node}<div className="border-t border-[var(--ww-border)] p-1.5"><Button size="small" type="primary" block icon={<SettingOutlined/>} onClick={()=>setView('settings')}>AI 设置</Button></div></div>)}/>
    {streaming ? (
      <Button size="small" icon={<StopOutlined />} onClick={stop}>停止</Button>
    ) : (
      <Button className="ww-composer-send" type="primary" shape="circle" aria-label="发送消息" icon={<SendOutlined />} loading={sending} disabled={!input.trim() || !modelReady} onClick={()=>void doSend()} />
    )}
   </>
  )

  return (
    <div className={`ww-chat ${empty ? 'is-empty' : ''}`}>
      <div className="ww-panel-bar"><span>{activeChat?.title || '新对话'}</span><div className="ww-panel-actions">
        <Tooltip title="知识库"><Button type="text" aria-label="打开知识库" icon={<FolderOpenOutlined/>} onClick={()=>void setView('notes')}/></Tooltip>
        <Tooltip title="新对话"><Button type="text" aria-label="新对话" icon={<PlusOutlined/>} onClick={()=>useChatStore.getState().newChat()}/></Tooltip>
        <Tooltip title={t('vault.hint')}><Button type="text" aria-label={t('vault.title')} icon={<SafetyCertificateOutlined/>} onClick={()=>setVaultOpen(true)}>{vaultCount||''}</Button></Tooltip>
      </div></div>
      <div className="ww-chat-body">
      <div className="ww-messages">
        {empty && <div className="ww-chat-welcome"><img src={brandIcon} width={48} height={48} alt=""/><h1>和你的知识库对话</h1><p>从一个问题、一篇笔记，或一份资料开始。</p></div>}
        {messages.map((m) => (
          <MsgBubble key={m.msgId} m={m} last={!streaming&&m.msgId===lastAssistant} onRegenerate={()=>void doRegenerate()}/>
        ))}
        {toolEvents.map((ev, i) => (
          <ToolCard key={`${ev.name}-${i}`} name={ev.name} phase={ev.phase} output={ev.output} argsJson={ev.args} />
        ))}
        {streaming&&streamReasoning&&<Reasoning text={streamReasoning} label={t('chat.thinking',{n:streamReasoning.length})}/>}
        {streaming && streamText && (
          <div className="mb-3 max-w-[95%] whitespace-pre-wrap text-sm">
            <MarkdownContent text={streamText} sources={streamSources}/>
            <span className="animate-pulse">▍</span>
          </div>
        )}
        {streaming && !streamText && toolEvents.length === 0 && (
          <div className="flex justify-center py-4">
            <Spin />
          </div>
        )}
        {confirmations.map(card=><ConfirmCard key={card.id} card={card}/>)}
        <div ref={bottomRef} />
      </div>

      <div className="ww-composer">
        <RecordingStrip/>
        <ChatComposer value={input} onChange={setInput} onSend={()=>void doSend()} disabled={streaming||sending} empty={empty} right={composerRight}/>
      </div>
      {empty && <div className="ww-quick-actions">
        <button onClick={()=>void useUiStore.getState().setToolsTab('office')}><span className="ww-quick-icon is-green"><TableOutlined/></span><span>表格处理<small>读取或生成 xlsx</small></span></button>
        <button onClick={()=>void setView('notes')}><span className="ww-quick-icon is-blue"><FileTextOutlined/></span><span>笔记编辑<small>撰写与整理知识库</small></span></button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('capture')}><span className="ww-quick-icon is-orange"><AudioOutlined/></span><span>资料采集<small>导入文件、网页与音视频</small></span></button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('calendar')}><span className="ww-quick-icon is-purple"><CalendarOutlined/></span><span>日历<small>导入并检索日程</small></span></button>
      </div>}
      </div>


      {error && <div className="mx-3 my-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <VaultPanel open={vaultOpen} onClose={() => setVaultOpen(false)} chatId={activeChatId} />
    </div>
  )
}
