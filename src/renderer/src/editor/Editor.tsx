import { queueNoteSave } from './save-queue'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { history, undo, redo } from 'prosemirror-history'
import { baseKeymap, toggleMark, wrapIn, setBlockType } from 'prosemirror-commands'
import { inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes } from 'prosemirror-inputrules'
import { wikiLinkSchema } from './schema'
import { docToMarkdown, markdownToDoc } from './markdown'
import { MathBlockView, CodeBlockView } from './nodeviews'
import { sys } from '../api'
import {
  BoldOutlined,
  ItalicOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CodeOutlined,
  LinkOutlined,
  LineOutlined,
  FunctionOutlined
} from '@ant-design/icons'
import { Tooltip, message } from 'antd'

export interface NoteEditorProps {
  noteId: string
  initialBody: string
  onSave: (body: string, dirty: boolean) => Promise<void>
  titles: string[]
}

/** [[ 补全：检测光标前是否有未闭合 [[ */
function detectWikiPrefix(view: EditorView): { text: string; from: number } | null {
  const $pos = view.state.selection.$from
  const parentText = $pos.parent.textContent
  const offsetInParent = $pos.parentOffset
  const before = parentText.slice(0, offsetInParent)
  const m = before.match(/\[\[([^\[\]]*)$/)
  if (!m) return null
  return { text: m[1] ?? '', from: $pos.pos - (m[1]?.length ?? 0) - 2 }
}

export default function NoteEditor({ noteId, initialBody, onSave, titles }: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [suggest, setSuggest] = useState<{ items: string[]; active: number } | null>(null)
  const suggestRef = useRef<{ items: string[]; active: number; from: number } | null>(null)
  const dirtyRef = useRef(false)
  const titlesRef = useRef(titles)
  titlesRef.current = titles

  const saveChain = useRef(Promise.resolve())
  const revision = useRef(0)
  const persist = (view: EditorView, save = onSave) => {
    const rev = revision.current
    const md = docToMarkdown(view.state.doc)
    saveChain.current = queueNoteSave(noteId, () => save(md,true)).then(() => {
      if (rev === revision.current) dirtyRef.current = false
    }).catch(e => { dirtyRef.current = true; void message.error(`保存失败：${String(e)}`) })
    return saveChain.current
  }
  const scheduleSave = (view: EditorView) => {
    dirtyRef.current = true
    revision.current++
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(view) }, 800)
  }

  const insertWikilink = (view: EditorView, from: number, text: string) => {
    const tr = view.state.tr
    tr.delete(from, view.state.selection.to) // 删掉已输入的 [[prefix
    tr.insertText(text, from)
    tr.addMark(from, from + text.length, wikiLinkSchema.marks.wikilink.create({ target: text }))
    view.dispatch(tr)
    view.focus()
  }

  useEffect(() => {
    if (!hostRef.current) return
    const doc = markdownToDoc(initialBody)

    const state = EditorState.create({
      doc,
      schema: wikiLinkSchema,
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-shift-z': redo,
          'Mod-b': toggleMark(wikiLinkSchema.marks.strong),
          'Mod-i': toggleMark(wikiLinkSchema.marks.em),
          'Mod-e': toggleMark(wikiLinkSchema.marks.code),
          'Mod-s': () => {
            if (viewRef.current) {
              if (saveTimer.current) clearTimeout(saveTimer.current)
              void persist(viewRef.current)
            }
            return true
          },
          Escape: () => {
            if (suggestRef.current) {
              suggestRef.current = null
              setSuggest(null)
              return true
            }
            return false
          },
          ArrowDown: () => {
            const s = suggestRef.current
            if (s) {
              suggestRef.current = { ...s, active: Math.min(s.active + 1, s.items.length - 1) }
              setSuggest({ items: s.items, active: suggestRef.current.active })
              return true
            }
            return false
          },
          ArrowUp: () => {
            const s = suggestRef.current
            if (s) {
              suggestRef.current = { ...s, active: Math.max(s.active - 1, 0) }
              setSuggest({ items: s.items, active: suggestRef.current.active })
              return true
            }
            return false
          },
          Enter: () => {
            const s = suggestRef.current
            const view = viewRef.current
            if (s && view) {
              const pick = s.items[s.active]
              if (pick) insertWikilink(view, s.from, pick)
              suggestRef.current = null
              setSuggest(null)
              return true
            }
            return false
          }
        }),
        keymap(baseKeymap),
        inputRules({
          rules: [
            ...smartQuotes,
            wrappingInputRule(/^\s*>\s$/, wikiLinkSchema.nodes.blockquote),
            wrappingInputRule(/^(\d+)\.\s$/, wikiLinkSchema.nodes.ordered_list, (m) => ({ start: Number(m[1]) })),
            wrappingInputRule(/^\s*[-*+]\s$/, wikiLinkSchema.nodes.bullet_list),
            textblockTypeInputRule(/^```(\w*)\s$/, wikiLinkSchema.nodes.code_block, (m) => ({ params: m[1] ?? '' })),
            textblockTypeInputRule(new RegExp('^(#{1,6})\\s$'), wikiLinkSchema.nodes.heading, (m) => ({ level: (m[1] ?? '#').length }))
          ]
        })
      ]
    })

    const view = new EditorView(hostRef.current, {
      state,
      nodeViews: {
        math_block: (node, view, getPos) => new MathBlockView(node, view, getPos as () => number),
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos as () => number)
      },
      handleTextInput: (view, from, to, text) => {
        // [[ 前缀补全
        setTimeout(() => {
          const p = detectWikiPrefix(view)
          if (p && view.state.selection.empty) {
            const q = p.text.toLowerCase()
            const items = titlesRef.current.filter((t) => t.toLowerCase().includes(q)).slice(0, 8)
            if (items.length > 0) {
              suggestRef.current = { items, active: 0, from: p.from }
              setSuggest({ items, active: 0 })
              return
            }
          }
          suggestRef.current = null
          setSuggest(null)
        }, 0)
        return false
      },
      handleClickOn: () => {
        suggestRef.current = null
        setSuggest(null)
        return false
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        const image = files.find((f) => f.type.startsWith('image/'))
        if (image) {
          event.preventDefault()
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              const r = await sys<{ url: string }>('notes.attach_image', {
                noteId,
                dataUrl: String(reader.result)
              })
              const pos = view.state.selection.from
              const img = wikiLinkSchema.nodes.image.createAndFill({ src: r.url, alt: image.name })
              if (img) view.dispatch(view.state.tr.insert(pos, img))
            } catch (e) {
              console.error(e)
            }
          }
          void reader.readAsDataURL(image)
          return true
        }
        return false
      },
      dispatchTransaction(tr) {
        const view = viewRef.current!
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged) scheduleSave(view)
      }
    })
    viewRef.current = view

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      void persist(view, onSave)
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (dirtyRef.current) void persist(view, onSave)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  const run = useMemo(
    () => ({
      bold: () => viewRef.current && toggleMark(wikiLinkSchema.marks.strong)(viewRef.current.state, viewRef.current.dispatch),
      italic: () => viewRef.current && toggleMark(wikiLinkSchema.marks.em)(viewRef.current.state, viewRef.current.dispatch),
      code: () => viewRef.current && toggleMark(wikiLinkSchema.marks.code)(viewRef.current.state, viewRef.current.dispatch),
      h1: () => viewRef.current && setBlockType(wikiLinkSchema.nodes.heading, { level: 1 })(viewRef.current.state, viewRef.current.dispatch),
      h2: () => viewRef.current && setBlockType(wikiLinkSchema.nodes.heading, { level: 2 })(viewRef.current.state, viewRef.current.dispatch),
      quote: () => viewRef.current && wrapIn(wikiLinkSchema.nodes.blockquote)(viewRef.current.state, viewRef.current.dispatch),
      ul: () => viewRef.current && wrapIn(wikiLinkSchema.nodes.bullet_list)(viewRef.current.state, viewRef.current.dispatch),
      ol: () => viewRef.current && wrapIn(wikiLinkSchema.nodes.ordered_list)(viewRef.current.state, viewRef.current.dispatch),
      math: () => {
        const view = viewRef.current
        if (!view) return
        const { from, to, empty } = view.state.selection
        if (!empty && to > from) {
          toggleMark(wikiLinkSchema.marks.math_inline)(view.state, view.dispatch)
        } else {
          view.dispatch(view.state.tr.insertText('$x^2$'))
        }
        view.focus()
      },
      link: () => {
        const view = viewRef.current
        if (!view) return
        const url = window.prompt('链接地址', 'https://')
        if (!url) return
        toggleMark(wikiLinkSchema.marks.link, { href: url })(view.state, view.dispatch)
      }
    }),
    []
  )

  const s = suggest

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-gray-200 px-4 py-1.5 dark:border-[#2a2a2a]">
        {[
          { icon: <BoldOutlined />, title: '加粗 ⌘B', fn: run.bold },
          { icon: <ItalicOutlined />, title: '斜体 ⌘I', fn: run.italic },
          { icon: <CodeOutlined />, title: '行内代码 ⌘E', fn: run.code },
          { icon: <LineOutlined />, title: '标题 1', fn: run.h1 },
          { icon: <LineOutlined />, title: '标题 2', fn: run.h2 },
          { icon: <UnorderedListOutlined />, title: '无序列表', fn: run.ul },
          { icon: <OrderedListOutlined />, title: '有序列表', fn: run.ol },
          { icon: <FunctionOutlined />, title: '数学公式', fn: run.math },
          { icon: <LinkOutlined />, title: '链接', fn: run.link }
        ].map((b, i) => (
          <Tooltip key={i} title={b.title}>
            <button
              className="rounded px-2 py-1 text-sm text-[var(--ww-text-2)] hover:bg-[var(--ww-hover)] dark:text-gray-300 dark:hover:bg-[#2a2a2a]"
              onClick={b.fn}
              type="button"
            >
              {b.icon}
            </button>
          </Tooltip>
        ))}
        <span className="flex-1" />
        <span className="text-xs text-[var(--ww-text-3)]">⌘S 保存 · [[ 引用笔记 · 粘贴图片自动上传</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={hostRef} className="pm-editor mx-auto max-w-3xl px-8 py-6" />
      </div>

      {s && s.items.length > 0 && (
        <div className="absolute bottom-24 left-1/2 z-20 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-[#3a3a3a] dark:bg-[#252525]">
          {s.items.map((item, i) => (
            <button
              key={item}
              className={`block w-full truncate rounded px-3 py-1.5 text-left text-sm ${
                i === s.active ? 'bg-blue-50 text-[var(--ww-primary)] dark:bg-[#1c2a4a]' : 'hover:bg-[var(--ww-hover)]'
              }`}
              onClick={() => {
                const view = viewRef.current
                const ref = suggestRef.current
                if (view && ref) {
                  insertWikilink(view, ref.from, item)
                  suggestRef.current = null
                  setSuggest(null)
                }
              }}
            >
              {item}
            </button>
          ))}
          <div className="px-3 py-1 text-xs text-[var(--ww-text-3)]">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
        </div>
      )}
    </div>
  )
}
