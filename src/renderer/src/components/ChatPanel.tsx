import RecordingControls from './RecordingControls'
import brandIcon from '../../../../resources/icon.svg'
import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Input, Modal, Popconfirm, Select, Spin, Tag, Tooltip, message } from 'antd'
import {
  PlusOutlined,
  SendOutlined,
  StopOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  RollbackOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  TableOutlined,
  CalendarOutlined,
  AudioOutlined
} from '@ant-design/icons'
import { sys, useSysEvent } from '../api'
import { useChatStore, wireChatEvents, type ChatMsg } from '../store/chat'
import { useUiStore } from '../store/ui'

wireChatEvents()

function ToolCard({ name, phase, output }: { name: string; phase: string; output?: string }) {
  return (
    <div className="my-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-[#333] dark:bg-[#1d1d1d]">
      <span className="font-mono text-[var(--ww-primary)]">{name}</span>
      {phase === 'start' ? (
        <Spin size="small" className="ml-2" />
      ) : (
        <Tag color={phase === 'error' ? 'red' : phase === 'recorded' ? 'default' : 'green'} style={{ marginLeft: 8, fontSize: 11 }}>
          {phase === 'error' ? '失败' : phase === 'recorded' ? '调用记录' : '完成'}
        </Tag>
      )}
      {output && (
        <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all text-gray-500">{output}</div>
      )}
    </div>
  )
}

function MsgBubble({ m }: { m: ChatMsg }) {
  if (m.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-[var(--ww-primary)] px-3 py-2 text-sm text-white">{m.content}</div>
      </div>
    )
  }
  if (m.role === 'assistant') {
    if (m.toolCalls && m.toolCalls.length > 0 && !m.content) {
      return (
        <div className="mb-3">
          {m.toolCalls.map((tc) => (
            <ToolCard key={tc.id} name={tc.function.name} phase="recorded" output={tc.function.arguments.slice(0, 300)} />
          ))}
        </div>
      )
    }
    return (
      <div className="mb-3 flex">
        <div className="prose prose-sm dark:prose-invert max-w-[95%] whitespace-pre-wrap rounded-xl bg-[var(--ww-hover)] px-3 py-2 text-sm dark:bg-[#232323]">
          {m.content}
        </div>
      </div>
    )
  }
  return null
}

interface VaultChangeRow {
  change_id: string
  ts: number
  kind: string
  op: string
  path: string
  rolled_back: number
}

function VaultDrawer({ open, onClose, chatId }: { open: boolean; onClose: () => void; chatId: string | null }) {
  const [rows, setRows] = useState<VaultChangeRow[]>([])
  const load = () => {
    sys<{ changes: VaultChangeRow[] }>('vault.list', chatId ? { chatId } : undefined)
      .then((r) => setRows(r.changes))
      .catch(() => setRows([]))
  }
  useEffect(load, [chatId, open])

  return (
    <Drawer title="本次会话变更（rVault）" open={open} onClose={onClose} width={380}>
      {rows.length === 0 ? (
        <div className="text-sm text-[var(--ww-text-3)]">暂无变更。Agent 创建或修改笔记/文件后会在此列出，可一键回滚。</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.change_id} className="flex items-center gap-2 rounded-md border border-gray-200 p-2 text-xs dark:border-[#333]">
              <Tag color={r.kind === 'note' ? 'blue' : 'cyan'}>{r.kind}</Tag>
              <Tag>{r.op}</Tag>
              <span className="min-w-0 flex-1 truncate" title={r.path}>
                {r.path}
              </span>
              {r.rolled_back ? (
                <Tag color="default">已回滚</Tag>
              ) : (
                <Button
                  size="small"
                  danger
                  icon={<RollbackOutlined />}
                  onClick={() => {
                    void sys('vault.rollback', { changeId: r.change_id })
                      .then(load)
                      .catch((e) => void message.error(String(e)))
                  }}
                >
                  回滚
                </Button>
              )}
            </div>
          ))}
          <Button
            block
            type="primary"
            danger
            ghost
            disabled={chatId === null}
            onClick={() => {
              if (!chatId) return
              void sys('vault.rollback', { chatId, all: true })
                .then((r) => {
                  void message.success(`已回滚 ${(r as { rolledBack: number }).rolledBack} 项`)
                  load()
                })
                .catch((e) => void message.error(String(e)))
            }}
          >
            回滚全部
          </Button>
        </div>
      )}
    </Drawer>
  )
}

export default function ChatPanel() {
  const { draft:input, setDraft:setInput, activeChatId, chats, messages, streaming, streamText, toolEvents, error, openChat, send, stop, setModel, loadChats, draftSelection, catalog, catalogLoading, catalogError, loadCatalog } =
    useChatStore()
  const currentView=useUiStore(s=>s.view)
  const activeNoteId = useUiStore((s) => s.activeNoteId)
  const setView = useUiStore((s) => s.setView)
  useSysEvent('chat.confirm', (payload) => {
    const p = payload as {id:string;chatId:string;name:string;args:string}
    Modal.confirm({ title: '允许助手执行此操作？', content: <div><b>{p.name}</b><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{p.args}</pre></div>,
      okText: '允许', cancelText: '拒绝',
      onOk: () => sys('chat.confirm', {...p,approved:true}),
      onCancel: () => sys('chat.confirm', {...p,approved:false}) })
  })
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
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
  const empty = messages.length === 0 && !streaming


  return (
    <div className={`ww-chat ${empty ? 'is-empty' : ''}`}>
      <div className="ww-panel-bar"><span>{activeChat?.title || '新对话'}</span><div className="ww-panel-actions">
        <Tooltip title="知识库"><Button type="text" aria-label="打开知识库" icon={<FolderOpenOutlined/>} onClick={()=>void setView('notes')}/></Tooltip>
        <Tooltip title="新对话"><Button type="text" aria-label="新对话" icon={<PlusOutlined/>} onClick={()=>useChatStore.getState().newChat()}/></Tooltip>
        <Tooltip title="变更记录与回滚"><Button type="text" aria-label="变更记录与回滚" icon={<SafetyCertificateOutlined/>} onClick={()=>setVaultOpen(true)}/></Tooltip>
      </div></div>
      <div className="ww-chat-body">
      <div className="ww-messages">
        {empty && <div className="ww-chat-welcome"><img src={brandIcon} width={48} height={48} alt=""/><h1>和你的知识库对话</h1><p>从一个问题、一篇笔记，或一份资料开始。</p></div>}
        {messages.map((m) => (
          <MsgBubble key={m.msgId} m={m} />
        ))}
        {toolEvents.map((t, i) => (
          <ToolCard key={`${t.name}-${i}`} name={t.name} phase={t.phase} output={t.output} />
        ))}
        {streaming && streamText && (
          <div className="mb-3 flex">
            <div className="max-w-[95%] whitespace-pre-wrap rounded-xl bg-[var(--ww-hover)] px-3 py-2 text-sm dark:bg-[#232323]">
              {streamText}
              <span className="animate-pulse">▍</span>
            </div>
          </div>
        )}
        {streaming && !streamText && toolEvents.length === 0 && (
          <div className="flex justify-center py-4">
            <Spin />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <RecordingControls/>
      <div className="ww-composer">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              void doSend()
            }
          }}
          aria-label="对话输入"
          variant="borderless"
          placeholder={activeNoteId ? '就当前笔记提问，或交给我一个任务…' : '直接提问，或描述你想完成的工作…'}
          autoSize={{ minRows: empty ? 4 : 2, maxRows: 8 }}
          disabled={streaming || sending}
        />
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
      <div className="ww-composer-meta"><span><FolderOpenOutlined/> {activeNoteId ? '当前笔记上下文' : '本地知识库'}</span><span className="flex-1"/>
        <Select aria-label="选择供应商和模型" showSearch optionFilterProp="label" size="small" value={selectionKey}
          placeholder="选择模型" loading={catalogLoading} disabled={streaming||sending} style={{flex:'1 1 240px',minWidth:0,maxWidth:'100%'}}
          popupMatchSelectWidth={false} styles={{popup:{root:{maxWidth:'min(600px, 90vw)'}}}}
          labelRender={()=>selectedModel?`${provider?.name} / ${selectedModel.label}`:selection?`${selection.providerId} / ${selection.model}（需重新选择）`:'选择模型'}
          notFoundContent={catalogLoading?'正在读取目录…':'没有可选模型，请先配置或刷新'}
          onChange={v=>{const [providerId,model]=JSON.parse(v);void setModel({providerId,model}).catch(e=>message.error(String(e)))}} options={options}/>
        <Button size="small" type="text" aria-label="刷新模型目录" title="仅刷新目录，不调用模型推理" icon={<ReloadOutlined/>} loading={catalogLoading} disabled={streaming||sending} onClick={()=>void loadCatalog(true)}/>
        <Button type="link" size="small" onClick={()=>void setView('settings')}>模型设置</Button>

      </div>
      <div className="ww-model-status" role="status">{catalogError||(!selection?'请先选择模型；旧会话需要重新选择一次。':!modelReady&&!catalogLoading?'所选模型不可用，请刷新目录或检查设置。':catalogLoading?'正在读取模型目录…':selectedModel?.source==='configured'?'该模型由你配置，尚未确认调用权限。': '目录已返回该模型；调用权限以实际请求为准。')}</div>
      {empty && <div className="ww-quick-actions">
        <button onClick={()=>void useUiStore.getState().setToolsTab('office')}><span className="ww-quick-icon is-green"><TableOutlined/></span>表格处理</button>
        <button onClick={()=>void setView('notes')}><span className="ww-quick-icon is-blue"><FileTextOutlined/></span>笔记编辑</button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('capture')}><span className="ww-quick-icon is-orange"><AudioOutlined/></span>资料采集</button>
        <button onClick={()=>void useUiStore.getState().setToolsTab('calendar')}><span className="ww-quick-icon is-purple"><CalendarOutlined/></span>日历</button>
      </div>}
      </div>

      {activeChatId && (
        <Popconfirm title="删除该会话？" onConfirm={() => void sys('chat.delete', { chatId: activeChatId }).then(() => openChat(null))}>
          <span />
        </Popconfirm>
      )}

      {error && <div className="mx-3 my-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <VaultDrawer open={vaultOpen} onClose={() => setVaultOpen(false)} chatId={activeChatId} />
    </div>
  )
}
