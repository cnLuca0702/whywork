import MarkdownIt from 'markdown-it'
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { wikiLinkSchema } from './schema'

/** markdown ⇄ PM 文档（DEVELOPMENT.md §9）
 *  [[wikilink]] 与 $行内数学$ 用 open/close token 对（内容天然流入 mark）；
 *  $$块数学$$ 用原子 token（tex 存属性）。 */

interface TokenLike {
  content: string
  attrs: [string, string][] | null
  block?: boolean
}
interface InlineStateLike {
  pos: number
  src: string
  push(type: string, tag: string, nesting: number): TokenLike
}
interface BlockStateLike {
  bMarks: number[]
  tShift: number[]
  eMarks: number[]
  lineMax: number
  line: number
  src: string
  push(type: string, tag: string, nesting: number): TokenLike
}
type MD = InstanceType<typeof MarkdownIt>

function wikilinkPlugin(md: MD): void {
  md.inline.ruler.after('emphasis', 'wikilink', (state, silent) => {
    const s = state as InlineStateLike
    const start = s.pos
    if (s.src[start] !== '[' || s.src[start + 1] !== '[') return false
    const end = s.src.indexOf(']]', start + 2)
    if (end < 0) return false
    const target = s.src.slice(start + 2, end).trim()
    if (!target || target.includes('[') || target.includes('\n')) return false
    if (!silent) {
      // 原子 token：prosemirror-markdown 对无下划线的 mark 规范走 openMark+addText(content)+closeMark
      const token = s.push('wikilink', 'span', 0)
      token.content = target
      token.attrs = [['target', target]]
    }
    s.pos = end + 2
    return true
  })
}

function mathPlugin(md: MD): void {
  md.block.ruler.after('blockquote', 'math_block', (state, startLine, _endLine, silent) => {
    const s = state as BlockStateLike
    const startPos = s.bMarks[startLine]! + s.tShift[startLine]!
    const firstLine = s.src.slice(startPos, s.eMarks[startLine]).trim()
    if (firstLine !== '$$') return false
    let line = startLine + 1
    let closed = false
    while (line < s.lineMax) {
      const l = s.src.slice(s.bMarks[line]! + s.tShift[line]!, s.eMarks[line]).trim()
      if (l === '$$') {
        closed = true
        break
      }
      line++
    }
    if (!closed) return false
    if (silent) return true
    const lines: string[] = []
    for (let i = startLine + 1; i < line; i++) {
      lines.push(s.src.slice(s.bMarks[i]! + s.tShift[i]!, s.eMarks[i]))
    }
    const token = s.push('math_block', '', 0)
    token.content = lines.join('\n').trim()
    token.block = true
    s.line = line + 1
    return true
  })

  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const s = state as InlineStateLike
    const start = s.pos
    if (s.src[start] !== '$') return false
    if (s.src[start + 1] === '$') return false
    const end = s.src.indexOf('$', start + 1)
    if (end < 0 || end === start + 1) return false
    const content = s.src.slice(start + 1, end)
    if (content.includes('\n')) return false
    if (/\d/.test(content) && content.includes(' ')) return false
    if (!silent) {
      s.push('math_inline_open', 'span', 1)
      const text = s.push('text', '', 0)
      text.content = content
      s.push('math_inline_close', 'span', -1)
    }
    s.pos = end + 1
    return true
  })
}

const md = MarkdownIt('commonmark', { html: false }).use(wikilinkPlugin).use(mathPlugin)

export const mdParser = new MarkdownParser(wikiLinkSchema, md, {
  ...defaultMarkdownParser.tokens,
  // 基础名键 + noCloseToken（本版本 tokenHandlers 需显式声明原子语义）
  wikilink: {
    mark: 'wikilink',
    noCloseToken: true,
    getAttrs: (tok) => ({ target: tok.attrGet('target') ?? tok.content })
  },
  math_inline: { mark: 'math_inline' },
  math_block: {
    node: 'math_block',
    noCloseToken: true,
    getAttrs: (tok) => ({ tex: tok.content })
  }
})

export const mdSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    image(state, node) {
      state.write(`![${node.attrs.alt ?? ''}](${node.attrs.src})`)
    },
    math_block(state, node) {
      state.write(`$$\n${node.attrs.tex ?? ''}\n$$`)
      state.closeBlock(node)
    }
  },
  {
    ...defaultMarkdownSerializer.marks,
    wikilink: {
      open: '[[',
      close: ']]',
      mixable: false,
      escape: false
    },
    math_inline: {
      open: '$',
      close: '$',
      mixable: false,
      escape: false,
      expelEnclosingWhitespace: true
    }
  }
)

export function markdownToDoc(mdText: string) {
  return mdParser.parse(mdText)
}

export function docToMarkdown(doc: import('prosemirror-model').Node): string {
  return mdSerializer.serialize(doc)
}
