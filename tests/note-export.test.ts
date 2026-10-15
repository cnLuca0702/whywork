import {describe,expect,it} from 'vitest'
import {noteMarkdownForExport} from '../src/main/services/note-export'

describe('note export provenance boundary',()=>{
  it('omits the importer trailing path comment while retaining formatted content',()=>{
    expect(noteMarkdownForExport('# 标题\r\n\r\n**正文**\r\n\r\n<!-- source-path: ../../private/source.md -->\r\n')).toBe('# 标题\n\n**正文**')
  })
  it('preserves literal provenance examples in fenced and indented code',()=>{
    for(const body of ['```md\n<!-- source-path: example.md -->\n```','```md\n<!-- source-path: example.md -->','    <!-- source-path: example.md -->']) {
      expect(noteMarkdownForExport(body)).toBe(body)
    }
  })
  it('preserves user comments, inline content and nonterminal provenance text',()=>{
    for(const body of ['<!-- user comment -->','正文 <!-- source-path: example.md -->','<!-- source-path: example.md -->\n\n后续正文']) {
      expect(noteMarkdownForExport(body)).toBe(body)
    }
  })
})
