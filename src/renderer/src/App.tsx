import { lazy, Suspense, useState } from 'react'
import { Button, Modal, Tooltip, message } from 'antd'
import { sys, useSysEvent } from './api'
import { CloseOutlined, MessageOutlined, ExpandOutlined, CompressOutlined } from '@ant-design/icons'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import StatusBar from './components/StatusBar'
import NotesView from './views/NotesView'
import SettingsView from './views/SettingsView'
import { useUiStore } from './store/ui'

const ToolsView=lazy(()=>import('./views/ToolsView'))

export default function App() {
  useSysEvent('app.capture_requested', payload => {
    const p=payload as {url:string}
    Modal.confirm({title:'剪藏网页到知识库？',content:p.url,okText:'剪藏',cancelText:'取消',
      onOk:async()=>{const r=await sys<{blocked:boolean}>('clip.save_url',p);if(r.blocked)void message.info('该网页在黑名单中');else void message.success('已剪藏')} })
  })
  useSysEvent('notes.open_requested', payload => {
    const p=payload as {noteId:string};void useUiStore.getState().setView('notes').then(ok=>{if(ok)useUiStore.getState().setActiveNote(p.noteId)})
  })
  const view = useUiStore((s) => s.view)
  const [focusWorkspace, setFocusWorkspace] = useState(false)
  return (
    <div className="ww-shell">
      <Sidebar />
      <main className={`ww-workspace ${view === 'chat' ? 'is-chat-only' : ''} ${focusWorkspace ? 'is-focused' : ''}`}>
        <section className="ww-surface ww-chat-pane" aria-label="对话工作区"><ChatPanel /></section>
        {view !== 'chat' && <section className="ww-surface ww-resource-pane" aria-label="资料工作区">
          <div className="ww-panel-bar">
            <span>{view === 'settings' ? '设置' : view === 'tools' ? '工作工具' : '知识库'}</span>
            <div className="ww-panel-actions">
              <Button type="text" size="small" icon={<MessageOutlined />} onClick={() => void useUiStore.getState().setView('chat')}>对话</Button>
              <Tooltip title={focusWorkspace ? '并排显示' : '展开工作区'}><Button aria-label={focusWorkspace ? '并排显示' : '展开工作区'} type="text" size="small" icon={focusWorkspace ? <CompressOutlined /> : <ExpandOutlined />} onClick={() => setFocusWorkspace(!focusWorkspace)} /></Tooltip>
              <Tooltip title="关闭资料区"><Button aria-label="关闭资料区" type="text" size="small" icon={<CloseOutlined />} onClick={() => void useUiStore.getState().setView('chat')} /></Tooltip>
            </div>
          </div>
          <div className="min-h-0 flex-1">{view === 'settings' ? <SettingsView /> : view === 'tools' ? <Suspense fallback={<div className="p-6">加载工具…</div>}><ToolsView/></Suspense> : <NotesView />}</div>
          <StatusBar />
        </section>}
      </main>
    </div>
  )
}
