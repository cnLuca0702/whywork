import VaultPanel from './VaultPanel'
import ConfirmCard from './ConfirmCard'
import MarkdownContent,{openCitation} from './MarkdownContent'
import ChatComposer from './ChatComposer'
import {t} from '../i18n/zh'
import RecordingControls from './RecordingControls'
import brandIcon from '../../../../resources/icon.svg'
import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Input, Modal, Select, Spin, Tag, Tooltip, message } from 'antd'
import {
  PlusOutlined,
  SendOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
  RollbackOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  TableOutlined,
  CalendarOutlined,
  AudioOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { sys, useSysEvent } from '../api'
import { useChatStore, wireChatEvents, type ChatMsg } from '../store/chat'
import { useUiStore } from '../store/ui'

wireChatEvents()

function ToolCard({ name, phase, output }: { name: string; phase: string; output?: string }) {
  return (
    <div className="my-1 rounded-md border border-[var(--ww-border)] bg-[var(--ww-hover)] px-2 py-1 text-xs">
      <span className="font-mono text-[var(--ww-primary)]">{name}</span>
      {phase === 'start' ? (
        <Spin size="small" className="ml-2" />
      ) : (
        <Tag color={phase === 'error' ? 'red' : phase === 'recorded' ? 'default' : 'green'} style={{ marginLeft: 8, fontSize: 11 }}>
          {phase === 'error' ? '失败' : phase === 'recorded' ? '调用记录' : '完成'}
        </Tag>
      )}
      {output && (
        <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all text-[var(--ww-text-3)]">{output}</div>
      )}
    </div>
  )
}

function MsgBubble({ m, last, onRegenerate }: { m: ChatMsg; last?:boolean; onRegenerate?:()=>void }) {
  if (m.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-[var(--ww-primary)] px-3 py-2 text-sm text-white">{m.content}{m.refs?.noteIds?.map(id=><Button key={id} size="small" onClick={()=>void openCitation({n:0,noteId:id,title:id,snippet:''})}>@ {m.refs?.noteTitles?.[id]??id.slice(0,8)}</Button>)}{m.refs?.skills?.map(name=><Tag key={name}>/ {name}</Tag>)}</div>
      </div>
    )
  }
  if (m.role === 'assistant') {
    if (m.toolCalls && m.toolCalls.length > 0 && !m.content && !m.reasoning) {
      return (
        <div className="mb-3">
          {m.toolCalls.map((tc) => (
            <ToolCard key={tc.id} name={tc.function.name} phase="recorded" output={tc.function.arguments.slice(0, 300)} />
          ))}
        </div>
      )
    }
    return <div className="ww-assistant mb-3 rounded-xl bg-[var(--ww-hover)] px-3 py-2 text-sm">
      {m.usage&&<div className="text-xs text-[var(--ww-text-3)]">{t('chat.usage',{n:m.usage.calls,input:m.usage.input,output:m.usage.output})}</div>}
      {m.reasoning&&<details><summary>{t('chat.thought',{n:m.reasoning.length})}</summary><div className="whitespace-pre-wrap">{m.reasoning}</div></details>}
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamText, toolEvents.length])

  useSysEvent('notes.changed',payload=>{if((payload as {kind?:string})?.kind==='provider')void loadCatalog(true)})
  const activeChat = chats.find((c) => c.chatId === activeChatId)
  const selection=activeChatId?activeChat?.selection:draftSelection
  const provider=catalog.find(p=>p.id===selection?.providerId)
  const selectedModel=provider?.models.find(m=>m.id===selection?.model)
  const modelReady=!!provider?.ready&&!!selectedModel&&!catalogLoading&&!catalogError
  const selectionKey=selection?JSON.stringify([selection.providerId,selection.model]):undefined
  const options=catalog.map(p=>({label:`${p.name} · ${p.id}${p.ready?'':' · '+p.status}`,options:p.models.map(m=>({
    value:JSON.stringify([p.id,m.id]),label:`${p.name} / ${m.label}${m.label!==m.id?' ('+m.id+')':''} · ${m.source==='discovered'?'目录已返回':'已配置，未验证'}`,disabled:!p.ready
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
        {toolEvents.map((t, i) => (
          <ToolCard key={`${t.name}-${i}`} name={t.name} phase={t.phase} output={t.output} />
        ))}
        {streaming&&streamReasoning&&<details><summary>{t('chat.thinking',{n:streamReasoning.length})}</summary><div className="whitespace-pre-wrap">{streamReasoning}</div></details>}
        {streaming && streamText && (
          <div className="mb-3 flex">
            <div className="max-w-[95%] whitespace-pre-wrap rounded-xl bg-[var(--ww-hover)] px-3 py-2 text-sm dark:bg-[#232323]">
              <MarkdownContent text={streamText} sources={streamSources}/>
              <span className="animate-pulse">▍</span>
            </div>
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

      <RecordingControls/>
      <div className="ww-composer">
        <ChatComposer value={input} onChange={setInput} onSend={()=>void doSend()} disabled={streaming||sending} empty={empty}/>
        <div className="ww-composer-actions">
          <span className="flex-1" /><span className="ww-enter-hint">⇧ Enter 换行</span>
          {streaming ? (
            <Button size="small" icon={<StopOutlined />} onClick={stop}>
              停止
            </Button>
          ) : (
            <Button size="small" type="primary" icon={<SendOutlined />} aria-label="发送消息" loading={sending} disabled={!input.trim() || !modelReady} onClick={()=>void doSend()}>
              发送
            </Button>
          )}
        </div>
      </div>
      <div className="ww-composer-meta">
        <span><FolderOpenOutlined/> {activeNoteId ? '笔记上下文' : '本地知识库'}</span>
        <span className="flex-1"/>
        <Select aria-label="选择模型" showSearch optionFilterProp="label" size="small" value={selectionKey}
          placeholder="模型" loading={catalogLoading} disabled={streaming||sending}
          style={{width:170}} popupMatchSelectWidth={200}
          labelRender={()=>selectedModel?selectedModel.label:selection?`${selection.model}（需重选）`:'模型'}
          notFoundContent={catalogLoading?'正在读取目录…':'没有可选模型'}
          onChange={v=>{const [providerId,model]=JSON.parse(v);void setModel({providerId,model}).catch(e=>message.error(String(e)))}}
          options={options}
          dropdownRender={node=>(<div onMouseDown={e=>e.preventDefault()}>{node}<div className="border-t border-[var(--ww-border)] p-1.5"><Button size="small" type="primary" block icon={<SettingOutlined/>} onClick={()=>setView('settings')}>AI 设置</Button></div></div>)}/>
      </div>
      {empty && <div className="ww-quick-actions">
        <button onClick={()=>void useUiStore.getState().setToolsTab('office')}><span className="ww-quick-icon is-green"><TableOutlined/></span>表格处理</button>
        <button onClick={()=>void setView('notes')}><span className="ww-quick-icon is-blue"><FileTextOutlined/></span>笔记编辑</button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('capture')}><span className="ww-quick-icon is-orange"><AudioOutlined/></span>资料采集</button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('calendar')}><span className="ww-quick-icon is-purple"><CalendarOutlined/></span>日历</button>
      </div>}
      </div>


      {error && <div className="mx-3 my-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <VaultPanel open={vaultOpen} onClose={() => setVaultOpen(false)} chatId={activeChatId} />
    </div>
  )
}
