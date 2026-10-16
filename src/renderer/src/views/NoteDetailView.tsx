import RecordingNoteActions from '../components/RecordingNoteActions'
import NoteInsights from '../components/NoteInsights'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Input, Modal, Select, Spin, Tag, message } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, MoreOutlined, ReadOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { renderMarkdown } from '../markdown/render'
import {t} from '../i18n/zh'
import { sys, useSysEvent } from '../api'
import { useUiStore } from '../store/ui'
import { useNotesStore } from '../store/notes'
import NoteEditor from '../editor/Editor'

interface LinkItem {
  id?: string
  targetText?: string
  targetNoteId?: string | null
  sourceNoteId?: string
  sourceTitle?: string
}

interface NoteDetail {
  note: {
    noteId: string
    title: string
    summary: string
    noteSource: string
    favorite: boolean
    pinned: boolean
    modifiedAt: number
    relativePath: string
  }
  body: string
  links: { out: LinkItem[]; in: LinkItem[] }
  collections: { id: string; title: string }[]
}

export default function NoteDetailView() {
  const { activeNoteId, setActiveNote } = useUiStore()
  const citationSnippet=useUiStore(s=>s.citationSnippet)
  const previewRef=useRef<HTMLDivElement>(null)
  const setStatus = useNotesStore((s) => s.setStatus)
  const remove = useNotesStore((s) => s.remove)
  const [detail, setDetail] = useState<NoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [colOpen, setColOpen] = useState(false)
  const [allCols, setAllCols] = useState<{ id: string; title: string }[]>([])
  const [colPick, setColPick] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [titles, setTitles] = useState<string[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const bodyRef = useRef('')

  useEffect(() => {
    if (!activeNoteId || editing) return
    let current=true
    setLoading(true)
    sys<NoteDetail>('notes.get', { noteId: activeNoteId })
      .then((d) => {
        if(!current)return
        setDetail(d)
        bodyRef.current = d.body
        setTitleDraft(d.note.title)
      })
      .catch((e) => void message.error(String(e)))
      .finally(() => {if(current)setLoading(false)})
    sys<{ items: { title: string }[] }>('notes.list', { limit: 100 })
      .then((r) => setTitles(r.items.map((n) => n.title)))
      .catch(() => undefined)
    return()=>{current=false}
  }, [activeNoteId, editing])

  const html = useMemo(() => (detail ? renderMarkdown(detail.body) : ''), [detail])

  useEffect(()=>{
    if(!citationSnippet||!detail||detail.note.noteId!==activeNoteId)return
    const needle=(citationSnippet.match(/⟦([^⟧]+)⟧/)?.[1]??citationSnippet).replace(/[⟦⟧…]/g,'').trim().slice(0,60)
    for(const node of previewRef.current?.querySelectorAll('p,li,pre,td')??[]){
      if(needle&&node.textContent?.includes(needle)){node.classList.add('ww-citation-hit');node.scrollIntoView({block:'center'});return()=>node.classList.remove('ww-citation-hit')}
    }
  },[citationSnippet,detail,activeNoteId,html])

  const onWikiClick = async (text: string) => {
    const target = detail?.links.out.find((l) => l.targetText === text)?.targetNoteId ?? null
    if (target) {
      setActiveNote(target)
      return
    }
    // 未解析：创建同名笔记并跳转（保存本笔记后链接自动回填）
    try {
      const r = await sys<{ noteId: string }>('notes.create', { title: text, body: `# ${text}\n` })
      // 重新加载当前笔记以刷新 links
      sys<NoteDetail>('notes.get', { noteId: activeNoteId! }).then(setDetail).catch(() => undefined)
      void message.success(`已创建「${text}」`)
      void r
    } catch (e) {
      void message.error(String(e))
    }
  }

  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  }
  if (!detail) return null

  const { note, links, collections } = detail
  const recordingUrl = note.noteSource === 'audio' ? detail.body.match(/\[播放录音\]\((whywork-res:\/\/resources\/recordings\/[0-9a-f-]{36}\.(?:webm|m4a))\)/i)?.[1] : undefined
  const unresolved = links.out.filter((l) => !l.targetNoteId)

  return (
    <div className="ww-note-detail flex h-full flex-col">
      {!editing&&<RecordingNoteActions key={activeNoteId} noteId={activeNoteId!}/>}
      {!editing&&<NoteInsights key={activeNoteId} noteId={activeNoteId!}/>}
      <div className="ww-detail-toolbar">
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => setActiveNote(null)}>
          返回
        </Button>
        {editing ? (
          <Input
            className="max-w-md"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft !== note.title) {
                void sys('notes.update', { noteId: note.noteId, title: titleDraft.trim() }).catch((e) =>
                  void message.error(String(e))
                )
              }
            }}
            style={{ fontWeight: 600, fontSize: 16 }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-lg font-semibold">{note.title}</span>
        )}
        <span className="flex-1" />
        <Button
          type={editing ? 'primary' : 'default'}
          size="small"
          icon={editing ? <ReadOutlined /> : <EditOutlined />}
          onClick={() => setEditing(!editing)}
        >
          {editing ? '完成' : '编辑'}
        </Button>
        <span onClick={() => void setStatus(note.noteId, { favorite: !note.favorite })} className="cursor-pointer">
          {note.favorite ? <StarFilled className="text-amber-400" /> : <StarOutlined />}
        </span>
        <Dropdown
          menu={{
            items: [
              {
                key: 'collection',
                label: '加入集合…',
                onClick: () => {
                  sys<{ items: { id: string; title: string }[] }>('notes.collections_list')
                    .then((r) => {
                      setAllCols(r.items)
                      setColPick(detail.collections.map((c) => c.title))
                      setColOpen(true)
                    })
                    .catch((e) => void message.error(String(e)))
                }
              },
              {
                key: 'export_pdf',
                label: '导出 PDF…',
                onClick: () => {
                  void sys<{ canceled: boolean; path?: string }>('export.note_pdf', { noteId: note.noteId })
                    .then((r) => {
                      if (!r.canceled) void message.success(`已导出：${r.path}`)
                    })
                    .catch((e) => void message.error(String(e)))
                }
              },
              {
                key: 'iflytek_send',
                label: '推送到讯飞办公本…',
                onClick: () => {
                  void message.loading({ content: '正在推送到办公本（读写驿站）…', key: 'ifly', duration: 0 })
                  void sys('iflytek.send_file', { path: note.relativePath })
                    .then(() => void message.success({ content: '已推送，办公本联网后自动接收', key: 'ifly' }))
                    .catch((e) => void message.error({ content: String(e), key: 'ifly' }))
                }
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: '移入回收站',
                danger: true,
                onClick: () => {
                  Modal.confirm({title:'移入回收站？',content:`“${note.title}”可在回收站恢复。`,okText:'移入回收站',cancelText:'取消',okButtonProps:{danger:true},
                    onOk:async()=>{await remove(note.noteId);setActiveNote(null)}})
                }
              }
            ]
          }}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} />
        </Dropdown>
      </div>

      {editing ? (
        <div className="min-h-0 flex-1">
          <NoteEditor
            noteId={note.noteId}
            initialBody={bodyRef.current}
            titles={titles}
            onSave={async (body) => {
              bodyRef.current = body
              await sys('notes.update', { noteId: note.noteId, body })
            }}
          />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
        <article
          className="prose prose-sm dark:prose-invert min-h-0 flex-1 overflow-y-auto px-8 pb-16"
          onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a')
            if (recordingUrl && anchor?.getAttribute('href') === recordingUrl) {
              e.preventDefault()
              e.currentTarget.querySelector('audio')?.focus()
              return
            }
            const chip = (e.target as HTMLElement).closest('[data-target]')
            if (chip) void onWikiClick(chip.getAttribute('data-target') ?? '')
          }}
        >
          {recordingUrl && <audio key={note.noteId} controls preload="metadata" src={recordingUrl} aria-label="已保存录音" className="mb-4 max-w-full" />}
          {citationSnippet&&<blockquote><b>{t('chat.sourceSnippet')}</b><p>{citationSnippet}</p></blockquote>}
          <div ref={previewRef} dangerouslySetInnerHTML={{ __html: html }} />
        </article>

        <aside className="ww-note-links w-48 shrink-0 overflow-y-auto border-l border-gray-200 px-4 py-3 text-sm dark:border-[#2a2a2a] lg:block">
          <div className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">出链（{links.out.length}）</div>
          <div className="mb-4 flex flex-wrap gap-1">
            {links.out.length === 0 && <span className="text-xs text-[var(--ww-text-3)]">无</span>}
            {links.out.map((l) => (
              <button
                key={l.id}
                className={`rounded border px-1.5 py-0.5 text-xs ${
                  l.targetNoteId
                    ? 'border-[var(--ww-primary)] text-[var(--ww-primary)] hover:bg-[var(--ww-primary-soft)] dark:text-blue-300'
                    : 'border-dashed border-[var(--ww-border)] text-[var(--ww-text-3)] hover:bg-gray-50 dark:border-gray-600'
                }`}
                onClick={() => void onWikiClick(l.targetText!)}
                title={l.targetNoteId ? '跳转' : '未解析，点击创建'}
              >
                {l.targetText}
              </button>
            ))}
          </div>

          <div className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">入链（{links.in.length}）</div>
          <div className="mb-4 flex flex-wrap gap-1">
            {links.in.length === 0 && <span className="text-xs text-[var(--ww-text-3)]">无</span>}
            {links.in.map((l) => (
              <button
                key={l.id}
                className="rounded bg-[var(--ww-hover)] px-1.5 py-0.5 text-xs text-[var(--ww-text-2)] hover:bg-gray-200 dark:bg-[#2a2a2a] dark:text-[var(--ww-text-3)]"
                onClick={() => setActiveNote(l.sourceNoteId!)}
              >
                {l.sourceTitle}
              </button>
            ))}
          </div>

          {collections.length > 0 && (
            <>
              <div className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">所属集合</div>
              <div className="mb-4 flex flex-wrap gap-1">
                {collections.map((c) => (
                  <Tag key={c.id}>{c.title}</Tag>
                ))}
              </div>
            </>
          )}

          {unresolved.length > 0 && (
            <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-600 dark:bg-[#332b1a]">
              {unresolved.length} 条未解析链接——点击虚线标签可直接创建对应笔记。
            </div>
          )}

          <div className="mt-4 truncate text-xs text-[var(--ww-text-3)]" title={note.relativePath}>
            {note.relativePath}
          </div>
        </aside>
      </div>
      )}

      <Modal
        title="加入集合"
        open={colOpen}
        okText="保存"
        cancelText="取消"
        onCancel={() => setColOpen(false)}
        onOk={async () => {
          try {
            const wanted = new Set(colPick)
            // 移除不再勾选的
            for (const c of detail.collections) {
              if (!wanted.has(c.title)) await sys('notes.collections_remove_note', { noteId: note.noteId, collectionId: c.id })
            }
            // 新增（可输入新名称直接建集合）
            for (const title of colPick) {
              await sys('notes.collections_add_note', { noteId: note.noteId, collectionTitle: title })
            }
            setColOpen(false)
            sys<NoteDetail>('notes.get', { noteId: activeNoteId! }).then(setDetail).catch(() => undefined)
          } catch (e) {
            void message.error(String(e))
          }
        }}
      >
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="选择或输入新集合名称"
          value={colPick}
          onChange={setColPick}
          options={allCols.map((c) => ({ value: c.title, label: c.title }))}
        />
      </Modal>
    </div>
  )
}
