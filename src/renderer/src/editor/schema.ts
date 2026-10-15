import { Schema } from 'prosemirror-model'

/** ProseMirror schema（DEVELOPMENT.md §9）
 *  wikilink 与行内数学是 mark（open/close token 内容天然流入）；
 *  块级数学是原子节点（attrs.tex）；code_block 属性名 params（对齐 prosemirror-markdown 默认序列器） */

export const wikiLinkSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 1, validate: 'number' } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (n) => [`h${n.attrs.level}`, 0]
    },
    blockquote: { content: 'block+', group: 'block', parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    code_block: {
      content: 'text*',
      group: 'block',
      code: true,
      attrs: { params: { default: '' } },
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (el) => ({ params: (el as HTMLElement).dataset['lang'] ?? '' })
        }
      ],
      toDOM: (n) => ['pre', { 'data-lang': n.attrs.params }, ['code', 0]]
    },
    bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { start: { default: 1 } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (el) => ({
            start: (el as HTMLElement).hasAttribute('start') ? Number((el as HTMLElement).getAttribute('start')) : 1
          })
        }
      ],
      toDOM: (n) => (n.attrs.start === 1 ? ['ol', 0] : ['ol', { start: n.attrs.start }, 0])
    },
    list_item: { content: 'paragraph block*', parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    image: {
      inline: true,
      attrs: { src: {}, alt: { default: null }, title: { default: null } },
      group: 'inline',
      draggable: true,
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (el) => ({
            src: (el as HTMLImageElement).getAttribute('src'),
            alt: (el as HTMLImageElement).getAttribute('alt'),
            title: (el as HTMLImageElement).getAttribute('title')
          })
        }
      ],
      toDOM: (n) => ['img', { src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title }]
    },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    // 块级数学 $$...$$（原子节点，tex 存属性）
    math_block: {
      group: 'block',
      atom: true,
      attrs: { tex: { default: '' } },
      toDOM: (n) => ['div', { class: 'pm-math-block', 'data-tex': n.attrs.tex }],
      parseDOM: [{ tag: 'div.pm-math-block', getAttrs: (el) => ({ tex: (el as HTMLElement).dataset['tex'] ?? '' }) }]
    },
    text: { group: 'inline' }
  },
  marks: {
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    code: {
      code: true,
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', { class: 'pm-inline-code' }, 0]
    },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (el) => ({
            href: (el as HTMLAnchorElement).getAttribute('href'),
            title: (el as HTMLAnchorElement).getAttribute('title')
          })
        }
      ],
      toDOM: (n) => ['a', { href: n.attrs.href, title: n.attrs.title, class: 'pm-link' }, 0]
    },
    // [[双向链接]]：mark（open/close token，内容即笔记标题）
    wikilink: {
      attrs: { target: {} },
      inclusive: false,
      parseDOM: [
        { tag: 'span.pm-wikilink', getAttrs: (el) => ({ target: (el as HTMLElement).dataset['target'] ?? '' }) }
      ],
      toDOM: (n) => ['span', { class: 'pm-wikilink', 'data-target': n.attrs.target }, 0]
    },
    // 行内数学 $...$：mark（escape:false 保持 TeX 原文）
    math_inline: {
      inclusive: false,
      parseDOM: [{ tag: 'span.pm-math-inline' }],
      toDOM: () => ['span', { class: 'pm-math-inline' }, 0]
    }
  }
})
