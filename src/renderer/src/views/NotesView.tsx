import SummaryBatch from '../components/SummaryBatch'
import CollectionPicker from '../components/CollectionPicker'
import FileCandidates from '../components/FileCandidates'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { Alert, Checkbox, Dropdown, Switch, Select, Button, Empty, Input, Modal, Popconfirm, Progress, Spin, Tag, message } from 'antd'
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

function NoteCard({ note, selecting, selected, onSelect, onCollection }: { note: NoteListItem; selecting:boolean; selected:boolean; onSelect:()=>void; onCollection:()=>void }) {
  const { setActiveNote } = useUiStore()
  const { setStatus, remove, restore } = useNotesStore()

  return (
    <div
      className="ww-note-row group"
      onClick={() => selecting ? onSelect() : setActiveNote(note.noteId)}
    >
      <div className="mb-1 flex items-center gap-1">
        {selecting&&<Checkbox checked={selected} onClick={e=>e.stopPropagation()} onChange={onSelect}/>}
        {note.pinned ? <PushpinFilled className="text-amber-500" /> : null}
        <FileTextOutlined className="text-[var(--ww-primary)]"/><span className="min-w-0 flex-1 truncate font-medium">{note.title}</span>
        <span className="ml-2 shrink-0 text-xs text-[var(--ww-text-3)]">{fmtTime(note.modifiedAt)}</span>
      </div>
      <div className="mb-2 line-clamp-2 min-h-[2.5rem] text-xs text-[var(--ww-text-3)] dark:text-[var(--ww-text-3)]">
        {note.searchSnippet || note.summary || '暂无摘要，打开查看正文'}
      </div>
      <div className="flex items-center gap-2 text-[var(--ww-text-3)]">
        {note.searchSource&&<Tag>{note.searchSource}</Tag>}
        {note.noteSource !== 'manual' && <Tag style={{ fontSize: 11 }}>{note.noteSource}</Tag>}
        <span className="flex-1" />
        {!note.deleted&&<span onClick={e=>e.stopPropagation()}><Dropdown trigger={['click']} menu={{items:[
          {key:'collection',label:t('notes.addCollection'),onClick:onCollection},
          {key:'later',label:t(note.later?'notes.unlater':'notes.later'),onClick:()=>void setStatus(note.noteId,{later:!note.later}).catch(e=>message.error(String(e)))},
          {key:'copy',label:t('notes.copyTitle'),onClick:()=>void navigator.clipboard.writeText(note.title).catch(e=>message.error(String(e)))},
          {key:'reveal',label:t('notes.reveal'),onClick:()=>void sys('app.reveal_in_finder',{path:note.relativePath}).catch(e=>message.error(String(e)))},
          {key:'pdf',label:t('notes.exportPdf'),onClick:()=>void sys('export.note_pdf',{noteId:note.noteId}).catch(e=>message.error(String(e)))}
        ]}}><Button size="small" type="text" aria-label={t('notes.moreMenu')}>…</Button></Dropdown></span>}
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
  const [sort,setSort]=useState<'modified'|'created'|'accessed'|'title'>('modified')
  const [types,setTypes]=useState<string[]>([]),[from,setFrom]=useState(''),[to,setTo]=useState(''),[group,setGroup]=useState(false)
  const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[collectionNotes,setCollectionNotes]=useState<string[]|null>(null),[limit,setLimit]=useState(100),[batchBusy,setBatchBusy]=useState(false)
  useEffect(()=>{setSelected([]);setLimit(100)},[filter,collectionId,search,types,from,to,sort])
  const batch=async(action:string,patch:Record<string,unknown>={})=>{
    if(batchBusy||!selected.length)return;setBatchBusy(true)
    try{const r=await sys<{success:string[];failed:{noteId:string;reason:string}[]}>(action,{noteIds:selected,...patch});setSelected(r.failed.map(f=>f.noteId));if(r.failed.length)message.warning(r.failed.map(f=>f.reason).join('；'));else message.success(t('notes.batchDone',{n:r.success.length}));refresh()}catch(e){message.error(String(e))}finally{setBatchBusy(false)}
  }
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

  const listFilter=useMemo(()=>{const filterQuery=filter==='trash'?{deleted:true}:FILTER_QUERY[filter];return {...(collectionId ? { collectionId } : filterQuery),sources:types.length?types.flatMap(type=>({note:['manual','text','journal','chat'],web:['page'],document:['word','pdf','ppt'],email:['mail_message'],audio:['audio','meeting_transcript','meeting_overview'],image:['image']}[type]??[])):undefined,modifiedFrom:from?new Date(from+'T00:00:00').getTime():undefined,modifiedTo:to?new Date(to+'T00:00:00').getTime():undefined}},[filter,collectionId,types,from,to])
  const refresh=useCallback(()=>{void list({filter:listFilter,sort,limit:100,offset:limit-100,query:search.trim()||undefined,searchMode}).catch(e=>message.error(String(e)))},[listFilter,sort,limit,search,searchMode,list])

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

      <div className="flex flex-wrap items-center gap-2 px-6 py-2">
        <Select aria-label={t('notes.sort')} value={sort} onChange={setSort} options={(['modified','created','accessed','title'] as const).map(value=>({value,label:t(`notes.${value}`)}))}/>
        <Select mode="multiple" allowClear style={{minWidth:150}} placeholder={t('notes.type')} value={types} onChange={setTypes} options={['note','web','document','email','audio','image'].map((value,i)=>({value,label:t((['notes.manualType','notes.webType','notes.documentType','notes.mailType','notes.audioType','notes.imageType'] as const)[i]!)}))}/>
        <input type="date" aria-label={t('notes.from')} value={from} onChange={e=>setFrom(e.target.value)}/><input type="date" aria-label={t('notes.to')} min={from} value={to} onChange={e=>setTo(e.target.value)}/>
        <Switch checked={group} onChange={setGroup}/><span>{t('notes.group')}</span>
        <Button onClick={()=>{setSelecting(!selecting);setSelected([])}}>{t(selecting?'common.cancel':'notes.select')}</Button>
      </div>
      {selecting&&<div className="flex flex-wrap items-center gap-2 px-6 py-2">
        <Checkbox checked={items.length>0&&items.every(n=>selected.includes(n.noteId))} onChange={e=>setSelected(e.target.checked?items.map(n=>n.noteId):[])}/><span>{t('notes.selected',{n:selected.length})}</span>
        {filter==='trash'?<Button disabled={!selected.length||batchBusy} onClick={()=>void batch('notes.batch_restore')}>{t('notes.restore')}</Button>:<>
          <Button disabled={!selected.length||batchBusy} onClick={()=>void batch('notes.batch_set_status',{favorite:true})}>{t('notes.favorite')}</Button>
          <Button disabled={!selected.length||batchBusy} onClick={()=>void batch('notes.batch_set_status',{later:true})}>{t('notes.later')}</Button>
          <Button disabled={!selected.length||batchBusy} onClick={()=>setCollectionNotes(selected)}>{t('notes.addCollection')}</Button>
          <Button danger disabled={!selected.length||batchBusy} onClick={()=>Modal.confirm({title:t('notes.batchDeleteConfirm'),onOk:()=>batch('notes.batch_delete')})}>{t('notes.trash')}</Button>
        </>}
      </div>}
      {collectionNotes&&<CollectionPicker noteIds={collectionNotes} onClose={()=>{setCollectionNotes(null);refresh()}}/>}
      {search.trim()&&<div className="px-6 py-1 text-xs text-[var(--ww-text-3)]">{searchMode==='fts'?'FTS5 短语检索；中文分词不命中时可切换本地正文。':'逐词匹配已入库笔记的本地正文；所有词都匹配，支持中文子串。'}不调用模型。</div>}
      {filter==='unprocessed'&&<SummaryBatch total={total} filter={listFilter} query={search.trim()} searchMode={searchMode}/>}
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
            {(group?[...new Set(items.map(n=>n.noteSource))]:['']).map(source=><div key={source}>
              {group&&<h3>{source} · {items.filter(n=>n.noteSource===source).length}</h3>}
              {items.filter(n=>!group||n.noteSource===source).map(n=><NoteCard key={n.noteId} note={n} selecting={selecting} selected={selected.includes(n.noteId)} onSelect={()=>setSelected(ids=>ids.includes(n.noteId)?ids.filter(id=>id!==n.noteId):[...ids,n.noteId])} onCollection={()=>setCollectionNotes([n.noteId])}/>)}
            </div>)}
          </div>
        )}
      </div>

      <div className="flex justify-center gap-3 p-2"><Button disabled={limit===100||loading} onClick={()=>setLimit(n=>Math.max(100,n-100))}>←</Button><span>{Math.ceil(limit/100)} / {Math.max(1,Math.ceil(total/100))}</span><Button disabled={limit>=total||loading} onClick={()=>setLimit(n=>n+100)}>→</Button></div>
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
