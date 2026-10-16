import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'

const md = new MarkdownIt({ html: false, breaks: true, linkify: true,
  highlight: (code, language) => language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '' })
export interface Citation {n:number;noteId:string;title:string;snippet:string}
md.inline.ruler.before('link','citation',(state,silent)=>{
  if(!state.env.sources)return false
  const match=/^\[(\d+)\]/.exec(state.src.slice(state.pos))
  if(!match)return false
  const source=(state.env.sources as Citation[]).find(s=>s.n===Number(match[1]))
  if(!silent&&source){const token=state.push('citation','',0);token.meta={...source}}
  state.pos+=match[0].length;return true
})
md.renderer.rules.citation=(tokens,index)=>{
  const s=tokens[index]!.meta as unknown as Citation
  return `<sup><button type="button" data-source="${s.n}" title="${md.utils.escapeHtml(s.title+'：'+s.snippet)}">[${s.n}]</button></sup>`
}
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const match = /^\[\[([^\[\]\n]+)\]\]/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) { const token = state.push('wikilink', '', 0); token.content = match[1]!.trim() }
  state.pos += match[0].length
  return true
})
md.renderer.rules.wikilink = (tokens, index) => {
  const text = md.utils.escapeHtml(tokens[index]!.content)
  return `<button type="button" class="wikilink-chip" data-target="${text}">${text}</button>`
}
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const match = /^\$([^$\n]+?)\$/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) { const token = state.push('math_inline', '', 0); token.content = match[1]! }
  state.pos += match[0].length
  return true
})
md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const from = state.bMarks[start]! + state.tShift[start]!
  const source = state.src.slice(from)
  const match = /^\$\$([\s\S]+?)\$\$(?:[ \t]*\n|[ \t]*$)/.exec(source)
  if (!match) return false
  const lines = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0)
  if (start + lines > end) return false
  if (!silent) { const token = state.push('math_block', '', 0); token.content = match[1]!; token.block = true; token.map = [start, start + lines] }
  state.line = start + lines
  return true
})
for (const type of ['math_inline', 'math_block']) md.renderer.rules[type] = (tokens, index) =>
  katex.renderToString(tokens[index]!.content, { displayMode: type === 'math_block', throwOnError: false, trust: false, maxExpand: 1000 })

export function renderMarkdown(body: string,sources?:Citation[]): string {
  try {
    return DOMPurify.sanitize(md.render(body,{sources}), { ADD_ATTR: ['data-target','data-source'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|whywork-res|myremio-res):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i })
  } catch { return `<pre>${md.utils.escapeHtml(body)}</pre>` }
}
