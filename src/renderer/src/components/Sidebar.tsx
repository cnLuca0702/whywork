import brandIcon from '../../../../resources/icon.svg'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal, Tooltip, message } from 'antd'
import {
  FileTextOutlined,
  StarOutlined,
  PushpinOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  MessageOutlined,
  AppstoreOutlined,
  AudioOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useChatStore } from '../store/chat'
import { t } from '../i18n/zh'
import { sys, useSysEvent } from '../api'
import { useUiStore, type NoteFilter } from '../store/ui'

const FILTERS: { key: NoteFilter; icon: ReactNode; label: string }[] = [
  { key: 'all', icon: <FileTextOutlined />, label: t('nav.all') },
  { key: 'favorite', icon: <StarOutlined />, label: t('nav.favorite') },
  { key: 'pinned', icon: <PushpinOutlined />, label: t('nav.pinned') },
  { key: 'later', icon: <ClockCircleOutlined />, label: t('nav.later') },
  { key: 'unprocessed', icon: <ThunderboltOutlined />, label: t('nav.unprocessed') },
  { key: 'trash', icon: <DeleteOutlined />, label: '回收站' }
]

interface Collection {
  id: string
  title: string
}

function CollectionsSection() {
  const { collectionId, setCollection, setView } = useUiStore()
  const [items, setItems] = useState<Collection[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')

  const refresh = () => {
    sys<{ items: Collection[] }>('notes.collections_list')
      .then((r) => setItems(r.items))
      .catch(() => undefined)
  }
  useEffect(refresh, [])
  useSysEvent('notes.changed', refresh)

  const add = async () => {
    const v = title.trim()
    if (!v) return
    try {
      await sys('notes.collections_create', { title: v })
      setAddOpen(false)
      setTitle('')
      refresh()
    } catch (e) {
      void message.error(String(e))
    }
  }

  return (
    <>
      <div className="mt-3 mb-1 flex items-center gap-1 px-3 text-xs font-medium text-[var(--ww-text-3)]">
        <FolderOpenOutlined />
        <span className="flex-1">{t('nav.collections')}</span>
        <PlusOutlined
          role="button" aria-label="新建集合" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setAddOpen(true)}} className="cursor-pointer hover:text-[var(--ww-primary)]"
          onClick={() => setAddOpen(true)}
        />
      </div>
      {items.map((c) => (
        <button
          key={c.id}
          onClick={async () => {
            if(await setView('notes')) setCollection(collectionId === c.id ? null : c.id)
          }}
          className={`mb-0.5 flex w-full items-center gap-2 truncate rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
            collectionId === c.id
              ? 'bg-blue-50 font-medium text-[var(--ww-primary)] dark:bg-[#1c2a4a] dark:text-blue-300'
              : 'text-gray-700 hover:bg-[var(--ww-hover)] dark:text-gray-300 dark:hover:bg-[#252525]'
          }`}
        >
          <span className="truncate">{c.title}</span>
        </button>
      ))}

      <Modal
        title="新建集合"
        open={addOpen}
        onOk={() => void add()}
        onCancel={() => setAddOpen(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !title.trim() }}
      >
        <Input placeholder="集合名称" value={title} onChange={(e) => setTitle(e.target.value)} onPressEnter={() => void add()} autoFocus />
      </Modal>
    </>
  )
}

export default function Sidebar() {
  const { view, filter, collectionId, toolsTab, setFilter, setView, setToolsTab } = useUiStore()
  const {chats, activeChatId, openChat, newChat} = useChatStore()
  const nav = (selected:boolean) => `ww-nav-item ${selected ? 'is-active' : ''}`
  return (
    <aside className="ww-sidebar">
      <div className="ww-brand"><img width={32} height={32} src={brandIcon} alt="蓝色章鱼"/><strong>WhyWork</strong><span>本地</span></div>
      <nav className="ww-nav-scroll" aria-label="主导航">
        <button className={nav(view==='chat'&&!activeChatId)} onClick={async()=>{if(await setView('chat'))newChat()}}><PlusOutlined/><span>新对话</span></button>
        <button className={nav(view==='tools'&&toolsTab==='capture')} onClick={()=>void setToolsTab('capture')}><AudioOutlined/><span>录音与采集</span></button>
        <button className={nav(view==='tools'&&toolsTab!=='capture')} onClick={()=>void setToolsTab('office')}><AppstoreOutlined/><span>工作工具</span></button>
        <div className="ww-nav-label">知识库</div>
        {FILTERS.map(f=><button key={f.key} aria-current={view==='notes'&&filter===f.key&&!collectionId?'page':undefined} className={nav(view==='notes'&&filter===f.key&&!collectionId)} onClick={async()=>{if(await setView('notes'))setFilter(f.key)}}>{f.icon}<span>{f.label}</span></button>)}
        <CollectionsSection />
        <div className="ww-nav-label">最近对话</div>
        {chats.length===0 ? <p className="ww-nav-empty">开始提问后，对话会保存在这里</p> : chats.slice(0,20).map(c=><button key={c.chatId} className={nav(activeChatId===c.chatId)} title={c.title} onClick={async()=>{if(await setView('chat'))void openChat(c.chatId).catch(e=>void message.error(String(e)))}}><MessageOutlined/><span className="truncate">{c.title}</span></button>)}
      </nav>
      <div className="ww-sidebar-footer"><Button type="text" icon={<SettingOutlined/>} onClick={()=>void setView(view==='settings'?'chat':'settings')}>设置</Button><span>BYOK</span></div>
    </aside>
  )
}
