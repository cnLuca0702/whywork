import { describe, expect, it } from 'vitest'
import { markdownToDoc, docToMarkdown } from '../src/renderer/src/editor/markdown'

/** M2 验收：markdown ⇄ PM 文档往返（DEVELOPMENT.md §11-M2）
 *  断言：①序列化幂等（ser(ser(x)) == ser(x)）②结构语义保持 ③自定义语法保持 */

function assertStable(name: string, md: string, opts: { exact?: boolean } = {}): void {
  it(name, () => {
    const ser1 = docToMarkdown(markdownToDoc(md))
    const ser2 = docToMarkdown(markdownToDoc(ser1))
    expect(ser2).toBe(ser1)
    if (opts.exact !== false) expect(ser1.trim()).toBe(md.trim())
  })
}

function structure(md: string): { types: string[]; marks: string[] } {
  const doc = markdownToDoc(md)
  const types: string[] = []
  const marks = new Set<string>()
  doc.descendants((n) => {
    types.push(n.type.name)
    for (const m of n.marks) marks.add(m.type.name)
    return true
  })
  return { types, marks: [...marks] }
}

describe('markdown 往返（严格：语法逐字保持）', () => {
  assertStable('标题与段落', '# 一级\n\n正文段落。\n\n## 二级')
  assertStable('行内标记', '**粗体** *斜体* `代码` [链接](https://a.b)')
  assertStable('引用', '> 引用内容')
  assertStable('代码块', '```ts\nconst a = 1\n```')
  assertStable('分割线', '上\n\n---\n\n下')
  assertStable('wikilink', '前 [[目标笔记]] 后')
  assertStable('行内数学', '质能方程 $E=mc^2$ 成立')
  assertStable('块级数学', '$$\n\\int_0^1 x^2 dx\n$$')
  assertStable('图片', '![图](myremio-res://resources/a/b.png)')
})

describe('宽松输入归一化（语义保持）', () => {
  it('紧凑列表 - 分隔', () => {
    const a = structure('- 甲\n- 乙')
    const b = structure(docToMarkdown(markdownToDoc('- 甲\n- 乙')))
    expect(a.types).toEqual(b.types)
    expect(a.marks).toEqual(b.marks)
  })
})

describe('自定义语法语义', () => {
  it('wikilink 解析为 mark 且保留目标', () => {
    const doc = markdownToDoc('看 [[笔记A]] 和 [[笔记B]]')
    const targets: string[] = []
    doc.descendants((n) => {
      for (const m of n.marks) {
        if (m.type.name === 'wikilink') targets.push(String(m.attrs.target))
      }
      return true
    })
    expect(targets).toEqual(['笔记A', '笔记B'])
    expect(docToMarkdown(doc).trim()).toBe('看 [[笔记A]] 和 [[笔记B]]')
  })

  it('行内数学解析为 mark（TeX 原文不转义）', () => {
    const doc = markdownToDoc('$a_i * b$')
    const { marks } = structure('$a_i * b$')
    expect(marks).toContain('math_inline')
    const text = []
    doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'math_inline')) text.push(n.text)
      return true
    })
    expect(text.join('')).toBe('a_i * b')
    expect(docToMarkdown(doc).trim()).toBe('$a_i * b$')
  })

  it('块级数学解析为原子节点（tex 属性）', () => {
    const doc = markdownToDoc('$$\n\\frac{1}{2}\n$$')
    let tex = ''
    doc.descendants((n) => {
      if (n.type.name === 'math_block') tex = String(n.attrs.tex)
      return true
    })
    expect(tex).toBe('\\frac{1}{2}')
    expect(docToMarkdown(doc).trim()).toBe('$$\n\\frac{1}{2}\n$$')
  })
})
