import {expect,it} from 'vitest'
import {displayBody,formatSnippet} from '../src/renderer/src/markdown/render'

it('preserves inline comments, inline code and thematic breaks in user content',()=>{
 for(const body of ['付款金额 100 元 <!-- internal --> 请周五前付款','请使用 `<!-- comment -->` 注释。','---\n正常正文\n---\n后续内容','---\ntitle: example\n---\n这是正文中的 YAML 示例'])expect(displayBody(body)).toBe(body)
})
it('hides standalone importer metadata without hiding source-path code examples',()=>{
 expect(displayBody('正文\n\n<!-- source-path: imports/private.txt -->')).toBe('正文\n')
 for(const body of ['````md\n```\n<!-- source-path: example -->\n```\n````','    <!-- source-path: example -->','正文 <!-- source-path: example --> 后续'])expect(displayBody(body)).toBe(body)
})
it('strips structured file headers only in snippets and escapes highlighted content',()=>{
 expect(formatSnippet('---\ntitle: Test\nsource: import\n---\n⟦<script>⟧')).toBe('<mark>&lt;script&gt;</mark>')
 expect(formatSnippet('---\n正常正文\n---\n后续')).toBe('---\n正常正文\n---\n后续')
})
