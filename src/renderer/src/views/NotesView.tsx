import FileCandidates from '../components/FileCandidates'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Select, Button, Empty, Input, Modal, Popconfirm, Progress, Spin, Tag, message } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  StarFilled,
  StarOutlined,
  PushpinFilled,
  PushpinOutlined,
  RestOutlined,
  UndoOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { t } from '../i18n/zh'
import { sys, useSysEvent } from '../api'
import { useUiStore, type NoteFilter } from '../store/ui'
import { useNotesStore, type NoteListItem } from '../store/notes'
import NoteDetailView from './NoteDetailView'

const FILTER_TITLES: Record<NoteFilter, string> = {
  all: t('nav.all'),
  favorite: t('nav.favorite'),
  pinned: t('nav.pinned'),
  later: t('nav.later'),
  unprocessed: t('nav.unprocessed'),
  trash: '回收站'
}

const FILTER_QUERY: Record<NoteFilter, Record<string, unknown> | undefined> = {
  all: undefined,
  favorite: { favorite: true },
  pinned: { pinned: true },
  later: { later: true },
  unprocessed: { unprocessed: true },
  trash: { deleted: true }
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function NoteCard({ note }: { note: NoteListItem }) {
  const { setActiveNote } = useUiStore()
  const { setStatus, remove, restore } = useNotesStore()

  return (
    <div
      className="ww-note-row group"
      onClick={() => setActiveNote(note.noteId)}
    >
      <div className="mb-1 flex items-center gap-1">
        {note.pinned ? <PushpinFilled className="text-amber-500" /> : null}
        <FileTextOutlined className="text-[var(--ww-primary)]"/><span className="min-w-0 flex-1 truncate font-medium">{note.title}</span>
        <span className="ml-2 shrink-0 text-xs text-[var(--ww-text-3)]">{fmtTime(note.modifiedAt)}</span>
      </div>
      <div className="mb-2 line-clamp-2 min-h-[2.5rem] text-xs text-gray-500 dark:text-[var(--ww-text-3)]">
        {note.searchSnippet || note.summary || '暂无摘要，打开查看正文'}
      </div>
      <div className="flex items-center gap-2 text-[var(--ww-text-3)]">
        {note.searchSource&&<Tag>{note.searchSource}</Tag>}
        {note.noteSource !== 'manual' && <Tag style={{ fontSize: 11 }}>{note.noteSource}</Tag>}
        <span className="flex-1" />
        <span className="hidden gap-1 group-hover:flex">
          {note.deleted ? (
            <>
              <UndoOutlined
                title="恢复"
                onClick={(e) => {
                  e.stopPropagation()
                  void restore(note.noteId)
                }}
              />
            </>
          ) : (
            <>
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  void setStatus(note.noteId, { favorite: !note.favorite })
                }}
              >
                {note.favorite ? <StarFilled className="text-amber-400" /> : <StarOutlined />}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  void setStatus(note.noteId, { pinned: !note.pinned })
                }}
              >
                {note.pinned ? <PushpinFilled className="text-amber-500" /> : <PushpinOutlined />}
              </span>
              <Popconfirm
                title="移入回收站？"
                onConfirm={(e) => {
                  e?.stopPropagation()
                  void remove(note.noteId)
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <DeleteOutlined onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

export default function NotesView() {
  const { filter, collectionId, search, searchMode,setSearchMode, activeNoteId, setActiveNote } = useUiStore()
  const { items, total, loading, warning,list } = useNotesStore()
  const [dragOver, setDragOver] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const creatingRef=useRef(false)
  const [creating,setCreating]=useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [searchDraft,setSearchDraft]=useState(search)
  useEffect(()=>{if(searchTimer.current)clearTimeout(searchTimer.current);setSearchDraft(search)},[search,filter,collectionId])
  const [importing, setImporting] = useState<{ done: number; total: number; current: string } | null>(null)
  const importIdRef = useRef<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    const filterQuery = filter === 'trash' ? { deleted: true } : FILTER_QUERY[filter]
    void list({
      filter: collectionId ? { collectionId } : filterQuery,
      query: search.trim() || undefined, searchMode
    }).catch(e=>message.error(String(e)))
  }, [filter, collectionId, search, searchMode,list])

  useEffect(() => {
    refresh()
  }, [refresh])

  useSysEvent('notes.changed', () => refresh())
  useSysEvent('import.progress', (p) => {
    const d = p as { importId: string; done: number; total: number; current?: string; finished?: boolean }
    importIdRef.current = d.importId
    if (d.finished) {
      setImporting(null)
      return
    }
    setImporting({ done: d.done, total: d.total, current: d.current ?? '' })
  })

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.whywork.pathForFile(f))
    if (paths.length === 0) return
    const importId = `imp_${Date.now().toString(36)}`
    importIdRef.current = importId
    try {
      const r = await sys<{ noteIds: string[]; errors: string[] }>('app.import', { paths, importId })
      if (r.errors.length > 0) void message.warning(r.errors.join('\n'))
      if (r.noteIds.length > 0) void message.success(`已导入 ${r.noteIds.length} 条笔记`)
    } catch (err) {
      void message.error(String(err))
    } finally {
      setImporting(null)
    }
  }

  const createNote = async () => {
    const title = newTitle.trim()
    if (!title || creatingRef.current) return
    creatingRef.current=true;setCreating(true)
    try {
      const r = await sys<{ noteId: string }>('notes.create', { title, body: '' })
      setNewOpen(false)
      setNewTitle('')
      setActiveNote(r.noteId)
    } catch (e) {
      void message.error(String(e))
    } finally {creatingRef.current=false;setCreating(false)}
  }

  if (activeNoteId) return <NoteDetailView />

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="ww-notes-toolbar">
        <span className="font-medium">{collectionId ? '集合笔记' : FILTER_TITLES[filter]}</span>
        <span className="text-xs text-[var(--ww-text-3)]">{t('notes.count', { n: total })}</span>
        <span className="flex-1" />
        <Select size="small" aria-label="本地检索路线" value={searchMode} style={{width:140}} onChange={setSearchMode} options={[{value:'fts',label:'FTS5 索引'},{value:'text',label:'本地正文逐词'}]}/>
        <Input.Search
          placeholder={t('notes.searchPlaceholder')}
          size="small"
          className="ww-note-search"
          allowClear
          value={searchDraft}
          onSearch={value=>{if(searchTimer.current)clearTimeout(searchTimer.current);useUiStore.getState().setSearch(value)}}
          onChange={(e) => {
            const v = e.target.value
            setSearchDraft(v)
            if (searchTimer.current) clearTimeout(searchTimer.current)
            searchTimer.current = setTimeout(() => useUiStore.getState().setSearch(v), 250)
          }}
        />
        {filter !== 'trash' && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
            新建笔记
          </Button>
        )}
      </div>

      {search.trim()&&<div className="px-6 py-1 text-xs text-[var(--ww-text-3)]">{searchMode==='fts'?'FTS5 短语检索；中文分词不命中时可切换本地正文。':'逐词匹配已入库笔记的本地正文；所有词都匹配，支持中文子串。'}不调用模型。</div>}
      {warning&&<Alert type="warning" message={warning}/>}
      {filter==='all'&&!collectionId&&<FileCandidates query={search.trim()}/>}
      {importing && (
        <div className="flex items-center gap-3 px-6 py-1 text-xs text-[var(--ww-text-2)]">
          <Progress
            percent={Math.round((importing.done / Math.max(importing.total, 1)) * 100)}
            size="small"
            style={{ maxWidth: 260 }}
          />
          <span className="truncate">正在导入 {importing.current}</span>
          <Button
            size="small"
            onClick={() => {
              if (importIdRef.current) void sys('app.import_cancel', { importId: importIdRef.current })
              setImporting(null)
            }}
          >
            取消
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<span className="whitespace-pre-line text-center text-sm text-[var(--ww-text-3)]">{search.trim() ? '没有找到匹配的笔记\n试试其他关键词，或清除搜索' : filter === 'trash' ? '回收站为空' : filter !== 'all' || collectionId ? '这里还没有笔记\n可以先到全部笔记中添加' : t('notes.empty')}</span>}
            />
          </div>
        ) : (
          <div className="ww-note-list">
            {items.map((n) => (
              <NoteCard key={n.noteId} note={n} />
            ))}
          </div>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-xl border-2 border-dashed border-blue-400 bg-white/95 px-16 py-10 text-center dark:bg-[#222]/95">
            <FileTextOutlined style={{ fontSize: 32 }} className="text-[var(--ww-primary)]" />
            <div className="mt-3 font-medium">松开以导入</div>
            <div className="text-xs text-[var(--ww-text-3)]">支持 .md / .txt / .docx / .pdf</div>
          </div>
        </div>
      )}

      <Modal
        title="新建笔记"
        open={newOpen}
        onOk={() => void createNote()}
        onCancel={() => {if(!creatingRef.current){setNewOpen(false);setNewTitle('')}}}
        confirmLoading={creating}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !newTitle.trim() || creating }}
      >
        <Input
          placeholder="笔记标题"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onPressEnter={e => {if(!e.nativeEvent.isComposing && e.keyCode!==229)void createNote()}}
          autoFocus
        />
      </Modal>
    </div>
  )
}

// 保留图标引用（trash 恢复按钮备用于列表头部操作）
void RestOutlined
