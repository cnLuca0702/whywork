import katex from 'katex'
import { EditorView as CMEditorView, basicSetup } from 'codemirror'
import { EditorState as CMEditorState } from '@codemirror/state'
import type { NodeView, EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

/** 数学（原子节点）与代码块的 NodeView（DEVELOPMENT.md §9） */

/** 块级数学：渲染 KaTeX，点击进入编辑（setNodeMarkup 更新 tex 属性） */
export class MathBlockView implements NodeView {
  dom: HTMLElement
  private input: HTMLTextAreaElement | null = null
  private rendered: HTMLElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'pm-math-block'
    this.rendered = document.createElement('div')
    this.rendered.className = 'pm-math-rendered'
    this.dom.appendChild(this.rendered)
    this.render()
    this.dom.addEventListener('click', (e) => {
      e.stopPropagation()
      this.startEdit()
    })
  }

  private render(): void {
    const tex = String(this.node.attrs.tex ?? '')
    try {
      this.rendered.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: false })
    } catch {
      this.rendered.textContent = tex
    }
  }

  private startEdit(): void {
    if (this.input) return
    this.rendered.style.display = 'none'
    this.input = document.createElement('textarea')
    this.input.value = String(this.node.attrs.tex ?? '')
    this.input.className = 'pm-math-input'
    this.input.rows = 2
    this.input.addEventListener('blur', () => this.commit())
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        this.commit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        this.input?.remove()
        this.input = null
        this.rendered.style.display = ''
      }
    })
    this.dom.appendChild(this.input)
    this.input.focus()
  }

  private commit(): void {
    const value = this.input?.value ?? ''
    const pos = this.getPos()
    if (pos !== undefined && value !== this.node.attrs.tex) {
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { tex: value }))
    }
    this.input?.remove()
    this.input = null
    this.rendered.style.display = ''
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'math_block') return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }
}

/** 代码块：CodeMirror 自管理内容（无 contentDOM），双向同步到 PM 文档 */
export class CodeBlockView implements NodeView {
  dom: HTMLElement
  private cm: CMEditorView
  private syncing = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'pm-codeblock'
    const header = document.createElement('div')
    header.className = 'pm-codeblock-lang'
    header.textContent = node.attrs.params || 'code'
    header.contentEditable = 'false'
    this.dom.appendChild(header)

    this.cm = new CMEditorView({
      state: CMEditorState.create({
        doc: node.textContent,
        extensions: [
          basicSetup,
          CMEditorView.lineWrapping,
          CMEditorView.updateListener.of((u) => {
            if (u.docChanged && !this.syncing) this.forwardToPM()
          })
        ]
      }),
      parent: this.dom
    })
  }

  private forwardToPM(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const text = this.cm.state.doc.toString()
    this.syncing = true
    this.view.dispatch(this.view.state.tr.insertText(text, pos + 1, pos + 1 + this.node.textContent.length))
    this.syncing = false
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const newText = node.textContent
    if (!this.syncing && newText !== this.cm.state.doc.toString()) {
      this.syncing = true
      this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: newText } })
      this.syncing = false
    }
    this.node = node
    const header = this.dom.firstElementChild as HTMLElement | null
    if (header) header.textContent = node.attrs.params || 'code'
    return true
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }
}
