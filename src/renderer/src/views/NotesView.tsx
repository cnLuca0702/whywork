import SummaryBatch from '../components/SummaryBatch'
import CollectionPicker from '../components/CollectionPicker'
import FileCandidates from '../components/FileCandidates'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { Alert, Button, Checkbox, DatePicker, Dropdown, Input, Modal, Popconfirm, Popover, Select, Spin, Switch, Empty, Progress, Tag, message } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  StarFilled,
  StarOutlined,
  PushpinFilled,
  PushpinOutlined,
  UndoOutlined,
  FileTextOutlined,
  ImportOutlined,
  FolderOpenOutlined,
  FilterOutlined
} from '@ant-design/icons'
import dayjs, {type Dayjs} from 'dayjs'
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

const TYPE_KEYS = { note: 'notes.manualType', web: 'notes.webType', document: 'notes.documentType', email: 'notes.mailType', audio: 'notes.audioType', image: 'notes.imageType' } as const
const SOURCE_OF_TYPE: Record<string, string[]> = { note: ['manual','text','journal','chat'], web: ['page'], document: ['word','pdf','ppt'], email: ['mail_message'], audio: ['audio','meeting_transcript','meeting_overview'], image: ['image'] }

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 两行紧凑行：标题行（图标/标题/时间/悬停操作），第二行摘要（无摘要时由主进程给正文开头，U-19） */
function NoteCard({ note, selecting, selected, onSelect, onCollection }: { note: NoteListItem; selecting:boolean; selected:boolean; onSelect:()=>void; onCollection:()=>void }) {
  const { setActiveNote } = useUiStore()
  const { setStatus, remove, restore } = useNotesStore()

  return (
    <div
      className="ww-note-row group"
      onClick={() => selecting ? onSelect() : setActiveNote(note.noteId)}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {selecting&&<Checkbox className="flex-shrink-0" checked={selected} onClick={e=>e.stopPropagation()} onChange={onSelect}/>}
        {note.pinned ? <PushpinFilled className="flex-shrink-0 text-amber-500" /> : <FileTextOutlined className="flex-shrink-0 text-[var(--ww-primary)]"/>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
        <span className="ww-note-actions ml-1 flex flex-shrink-0 items-center gap-1.5" onClick={e=>e.stopPropagation()}>
          {!note.deleted&&<Dropdown trigger={['click']} menu={{items:[
            {key:'collection',label:t('notes.addCollection'),onClick:onCollection},
            {key:'later',label:t(note.later?'notes.unlater':'notes.later'),onClick:()=>void setStatus(note.noteId,{later:!note.later}).catch(e=>message.error(String(e)))},
            {key:'copy',label:t('notes.copyTitle'),onClick:()=>void navigator.clipboard.writeText(note.title).catch(e=>message.error(String(e)))},
            {key:'reveal',label:t('notes.reveal'),onClick:()=>void sys('app.reveal_in_finder',{path:note.relativePath}).catch(e=>message.error(String(e)))},
            {key:'pdf',label:t('notes.exportPdf'),onClick:()=>void sys('export.note_pdf',{noteId:note.noteId}).catch(e=>message.error(String(e)))}
          ]}}><Button size="small" type="text" aria-label={t('notes.moreMenu')}>…</Button></Dropdown>}
          {note.deleted ? (
            <UndoOutlined aria-label="恢复" title="恢复" onClick={()=>void restore(note.noteId)}/>
          ) : (<>
            <span onClick={()=>void setStatus(note.noteId,{favorite:!note.favorite})} title={t('notes.favorite')}>
              {note.favorite ? <StarFilled className="text-amber-400"/> : <StarOutlined/>}
            </span>
            <span onClick={()=>void setStatus(note.noteId,{pinned:!note.pinned})} title={t('nav.pinned')}>
              {note.pinned ? <PushpinFilled className="text-amber-500"/> : <PushpinOutlined/>}
            </span>
            <Popconfirm title="移入回收站？" onConfirm={(e)=>{e?.stopPropagation();void remove(note.noteId)}} onCancel={(e)=>e?.stopPropagation()}>
              <DeleteOutlined aria-label={t('notes.trash')} onClick={(e)=>e.stopPropagation()}/>
            </Popconfirm>
          </>)}
        </span>
        <span className="ml-1 flex-shrink-0 text-xs text-[var(--ww-text-3)]">{fmtTime(note.modifiedAt)}</span>
      </div>
      <div className="mt-0.5 truncate pl-[26px] pr-2 text-xs text-[var(--ww-text-3)]">
        {note.searchSnippet || note.summary || '\u00A0'}
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
  const [filterOpen,setFilterOpen]=useState(false)
  useEffect(()=>{if(searchTimer.current)clearTimeout(searchTimer.current);setSearchDraft(search)},[search,filter,collectionId])
  const [importing, setImporting] = useState<{ done: number; total: number; current: string } | null>(null)
  const importIdRef = useRef<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const listFilter=useMemo(()=>{const filterQuery=filter==='trash'?{deleted:true}:FILTER_QUERY[filter];return {...(collectionId ? { collectionId } : filterQuery),sources:types.length?types.flatMap(type=>SOURCE_OF_TYPE[type]??[]):undefined,modifiedFrom:from?new Date(from+'T00:00:00').getTime():undefined,modifiedTo:to?new Date(to+'T00:00:00').getTime():undefined}},[filter,collectionId,types,from,to])
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

  const importPaths=async(paths:string[])=>{
    if(!paths.length)return
    const importId=`imp_${Date.now().toString(36)}`
    importIdRef.current=importId
    try{
      const r=await sys<{noteIds:string[];errors:string[]}>('app.import',{paths,importId})
      if(r.errors.length>0)void message.warning(r.errors.join('\n'))
      if(r.noteIds.length>0)void message.success(`已导入 ${r.noteIds.length} 条笔记`)
    }catch(e){void message.error(String(e))}finally{setImporting(null)}
  }
  const importFiles=async()=>{
    const picked=await sys<{canceled:boolean;paths:string[]}>('app.pick_files')
    if(!picked.canceled)await importPaths(picked.paths)
  }
  const importFolder=async()=>{
    const picked=await sys<{canceled:boolean;path?:string}>('app.pick_folder')
    if(!picked.canceled&&picked.path)await importPaths([picked.path])
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

  const dateValue:(Dayjs|null)[]=[from?dayjs(from):null,to?dayjs(to):null]
  const filterActive=types.length>0||!!from||!!to
  const filterContent=<div className="w-64 space-y-3">
   <div><div className="mb-1 text-xs font-medium text-[var(--ww-text-2)]">{t('notes.sort')}</div>
    <Select className="w-full" size="small" aria-label={t('notes.sort')} value={sort} onChange={setSort} options={(['modified','created','accessed','title'] as const).map(value=>({value,label:t(`notes.${value}`)}))}/></div>
   <div><div className="mb-1 text-xs font-medium text-[var(--ww-text-2)]">{t('notes.type')}</div>
    <Select className="w-full" size="small" mode="multiple" allowClear aria-label={t('notes.type')} value={types} onChange={setTypes}
     options={(Object.keys(TYPE_KEYS) as (keyof typeof TYPE_KEYS)[]).map(value=>({value,label:t(TYPE_KEYS[value])}))}/></div>
   <div><div className="mb-1 text-xs font-medium text-[var(--ww-text-2)]">{t('notes.modifiedRange')}</div>
    <DatePicker.RangePicker className="w-full" size="small" aria-label={t('notes.modifiedRange')} value={dateValue as [Dayjs|null,Dayjs|null]}
     presets={[{label:'今天',value:[dayjs(),dayjs()]},{label:'近 7 天',value:[dayjs().subtract(6,'day'),dayjs()]},{label:'近 30 天',value:[dayjs().subtract(29,'day'),dayjs()]}]}
     onChange={(dates)=>{const [a,b]=dates??[];setFrom(a?a.format('YYYY-MM-DD'):'');setTo(b?b.format('YYYY-MM-DD'):'')}}/></div>
   {filterActive&&<Button size="small" block onClick={()=>{setTypes([]);setFrom('');setTo('')}}>清除筛选</Button>}
  </div>

  return (
    <div
      className="relative flex h-full flex-col"
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
        <Select size="small" aria-label="检索方式" value={searchMode} style={{width:130}} onChange={setSearchMode} options={[{value:'fts',label:t('notes.searchFast')},{value:'text',label:t('notes.searchExact')}]}/>
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
          <Dropdown trigger={['click']} menu={{items:[
            {key:'new',label:t('notes.newNote'),onClick:()=>setNewOpen(true)},
            {key:'import',label:t('notes.importFiles'),icon:<ImportOutlined/>,onClick:()=>void importFiles()},
            {key:'importDir',label:t('notes.importFolder'),icon:<FolderOpenOutlined/>,onClick:()=>void importFolder()}
          ]}}>
            <Button size="small" type="primary" icon={<PlusOutlined />}>{t('notes.newNote')}</Button>
          </Dropdown>
        )}
        <Popover open={filterOpen} onOpenChange={setFilterOpen} trigger="click" placement="bottomRight" content={filterContent} arrow={false}>
          <Button size="small" icon={<FilterOutlined/>} className={filterActive?'!border-[var(--ww-primary)] !text-[var(--ww-primary)]':''}>{t('notes.filter')}</Button>
        </Popover>
        <label className="flex cursor-pointer items-center gap-1 text-sm" onClick={()=>setGroup(!group)}>
          <Switch checked={group} onChange={setGroup} size="small"/><span className="text-xs text-[var(--ww-text-2)]">{t('notes.group')}</span>
        </label>
        <Button size="small" onClick={()=>{setSelecting(!selecting);setSelected([])}}>{t(selecting?'common.cancel':'notes.select')}</Button>
      </div>

      {collectionNotes&&<CollectionPicker noteIds={collectionNotes} onClose={()=>{setCollectionNotes(null);refresh()}}/>}
      {search.trim()&&<div className="px-6 py-1 text-xs text-[var(--ww-text-3)]">{searchMode==='fts'?t('notes.searchFastHint'):t('notes.searchExactHint')}</div>}
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
              {group&&<h3 className="mb-1 mt-3 text-sm font-medium text-[var(--ww-text-2)]">{source} · {items.filter(n=>n.noteSource===source).length}</h3>}
              {items.filter(n=>!group||n.noteSource===source).map(n=><NoteCard key={n.noteId} note={n} selecting={selecting} selected={selected.includes(n.noteId)} onSelect={()=>setSelected(ids=>ids.includes(n.noteId)?ids.filter(id=>id!==n.noteId):[...ids,n.noteId])} onCollection={()=>setCollectionNotes([n.noteId])}/>)}
            </div>)}
          </div>
        )}
      </div>

      {total>100&&<div className="flex justify-center gap-3 p-2"><Button disabled={limit===100||loading} onClick={()=>setLimit(n=>Math.max(100,n-100))}>←</Button><span>{Math.ceil(limit/100)} / {Math.max(1,Math.ceil(total/100))}</span><Button disabled={limit>=total||loading} onClick={()=>setLimit(n=>n+100)}>→</Button></div>}

      {selecting&&selected.length>0&&<div className="ww-batch-bar" role="toolbar" aria-label={t('notes.batchBar')}>
        <span className="font-medium">{t('notes.selected',{n:selected.length})}</span>
        {filter==='trash'
          ?<Button size="small" disabled={batchBusy} onClick={()=>void batch('notes.batch_restore')}>{t('notes.restore')}</Button>
          :<><Button size="small" disabled={batchBusy} onClick={()=>void batch('notes.batch_set_status',{favorite:true})}>{t('notes.favorite')}</Button>
          <Button size="small" disabled={batchBusy} onClick={()=>void batch('notes.batch_set_status',{later:true})}>{t('notes.later')}</Button>
          <Button size="small" disabled={batchBusy} onClick={()=>setCollectionNotes(selected)}>{t('notes.addCollection')}</Button>
          <Button size="small" danger disabled={batchBusy} onClick={()=>Modal.confirm({title:t('notes.batchDeleteConfirm'),onOk:()=>batch('notes.batch_delete')})}>{t('notes.trash')}</Button></>}
        <Button size="small" type="text" onClick={()=>setSelected([])} aria-label={t('common.cancel')}>×</Button>
      </div>}

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
