import ChatHistory from './ChatHistory'
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
  PlusOutlined,
  DownOutlined
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

const COLLECTION_LIMIT = 5

/** 集合分区：默认最多 5 个，多出的收进“更多”，分区可折叠并记住状态（U-11） */
function CollectionsSection() {
  const { collectionId, setCollection, setView } = useUiStore()
  const [items, setItems] = useState<Collection[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(() => localStorage.getItem('ww.collections.open') !== 'false')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const sync = () => setOpen(localStorage.getItem('ww.collections.open') !== 'false')
    window.addEventListener('ww-collections-toggle', sync)
    return () => window.removeEventListener('ww-collections-toggle', sync)
  }, [])
  const toggle = () => {
    setOpen(v => {
      localStorage.setItem('ww.collections.open', String(!v))
      window.dispatchEvent(new CustomEvent('ww-collections-toggle'))
      return !v
    })
  }

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

  const visible = expanded ? items : items.slice(0, COLLECTION_LIMIT)

  return (
    <>
      <div className="ww-nav-label flex items-center gap-1">
        <FolderOpenOutlined />
        <button type="button" className="ww-nav-collapsible flex flex-1 items-center gap-1" aria-expanded={open} aria-label={t('nav.collections')} onClick={toggle}>
          <span className="flex-1 text-left">{t('nav.collections')}</span>
          <DownOutlined className={`text-[9px] transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <PlusOutlined
          role="button" aria-label="新建集合" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setAddOpen(true)}} className="cursor-pointer hover:text-[var(--ww-primary)]"
          onClick={() => setAddOpen(true)}
        />
      </div>
      {open && (
        <>
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={async () => {
                if(await setView('notes')) setCollection(collectionId === c.id ? null : c.id)
              }}
              className={`mb-0.5 flex w-full items-center gap-2 truncate rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                collectionId === c.id
                  ? 'bg-blue-50 font-medium text-[var(--ww-primary)] dark:bg-[#1c2a4a] dark:text-blue-300'
                  : 'text-[var(--ww-text-2)] hover:bg-[var(--ww-hover)]'
              }`}
            >
              <span className="truncate">{c.title}</span>
            </button>
          ))}
          {items.length > COLLECTION_LIMIT && (
            <button
              className="mb-0.5 w-full rounded-md px-3 py-1 text-left text-xs text-[var(--ww-text-3)] hover:bg-[var(--ww-hover)]"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? t('nav.collapse') : t('nav.moreItems', { n: items.length - COLLECTION_LIMIT })}
            </button>
          )}
        </>
      )}

      <Modal
        title="新建集合"
        open={addOpen}
        onOk={() => void add()}
        onCancel={() => setAddOpen(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !title.trim() }}
      >
        <Input placeholder="集合名称" value={title} onChange={(e) => setTitle(e.target.value)}
          onPressEnter={e => { if (!e.nativeEvent.isComposing && e.keyCode !== 229) void add() }} autoFocus />
      </Modal>
    </>
  )
}

/** 左侧栏只负责“我的内容”（对话、笔记、集合）；工具入口统一在最右侧竖栏（U-07） */
export default function Sidebar() {
  const { view, filter, collectionId, setFilter, setView } = useUiStore()
  const { activeChatId, newChat } = useChatStore()
  const nav = (selected:boolean) => `ww-nav-item ${selected ? 'is-active' : ''}`
  return (
    <aside className="ww-sidebar">
      <div className="ww-brand"><img width={32} height={32} src={brandIcon} alt="蓝色章鱼"/><strong>WhyWork</strong><span>本地 · BYOK</span></div>
      <nav className="ww-nav-scroll" aria-label="主导航">
        <button className={nav(view==='chat'&&!activeChatId)} onClick={async()=>{if(await setView('chat'))newChat()}}><PlusOutlined/><span>新对话</span></button>
        <div className="ww-nav-label">知识库</div>
        {FILTERS.map(f=><button key={f.key} aria-current={view==='notes'&&filter===f.key&&!collectionId?'page':undefined} className={nav(view==='notes'&&filter===f.key&&!collectionId)} onClick={async()=>{if(await setView('notes'))setFilter(f.key)}}>{f.icon}<span>{f.label}</span></button>)}
        <CollectionsSection />
        <ChatHistory/>
      </nav>
      <div className="ww-sidebar-footer">
        <Tooltip title={t('nav.settings')} placement="right">
          <Button type="text" aria-label={t('nav.settings')} icon={<SettingOutlined/>} onClick={()=>void setView(view==='settings'?'chat':'settings')}/>
        </Tooltip>
      </div>
    </aside>
  )
}
