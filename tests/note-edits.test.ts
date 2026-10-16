import {expect,it} from 'vitest'
import {applyNoteEdits,appendNote,stripDuplicateHeading,noteLines,assertEditableSource} from '../src/main/services/note-edits'
it('matches every edit against the original, never the output of previous edits',()=>{
 expect(applyNoteEdits('alpha beta',[{oldText:'alpha',newText:'beta'},{oldText:'beta',newText:'gamma'}])).toBe('beta gamma')
 expect(()=>applyNoteEdits('alpha',[{oldText:'alpha',newText:'new'},{oldText:'new',newText:'other'}])).toThrow('第2条：未找到')
})
it('rejects duplicate and overlapping occurrences including self-overlap',()=>{
 expect(()=>applyNoteEdits('aaaa',[{oldText:'aa',newText:'b'}])).toThrow('多次')
 expect(()=>applyNoteEdits('abcd',[{oldText:'abc',newText:'x'},{oldText:'cd',newText:'y'}])).toThrow('第2条：与第1条重叠')
})
it('falls back only to per-line leading/trailing whitespace normalization',()=>{
 expect(applyNoteEdits('  alpha  \n\tbeta\nend',[{oldText:'alpha\nbeta',newText:'new'}])).toBe('  new\nend')
 expect(()=>applyNoteEdits('alpha  beta',[{oldText:'alpha beta',newText:'new'}])).toThrow('未找到')
 expect(()=>applyNoteEdits(' a\n a ',[{oldText:'a ',newText:'x'}])).not.toThrow()
 expect(()=>applyNoteEdits(' a \n a ',[{oldText:' a',newText:'x'}])).toThrow('多次')
})
it('rejects empty edits and append, separates appended paragraphs',()=>{
 expect(()=>applyNoteEdits('body',[])).toThrow()
 expect(()=>applyNoteEdits('body',[{oldText:' ',newText:'x'}])).toThrow()
 expect(()=>appendNote('body',' ')).toThrow()
 expect(appendNote('body\n\n','next')).toBe('body\n\nnext\n')
})
it('removes only a matching first H1 and preserves other headings',()=>{
 expect(stripDuplicateHeading('# 标题\n\n正文','标题')).toBe('正文')
 expect(stripDuplicateHeading('# 其他\n正文','标题')).toBe('# 其他\n正文')
 expect(stripDuplicateHeading('## 标题\n正文','标题')).toBe('## 标题\n正文')
})
it('reads bounded lines and offsets from the end',()=>{
 expect(noteLines('a\nb\nc',2,1)).toEqual({body:'b',totalLines:3})
 expect(noteLines('a\nb\nc',-2,1)).toEqual({body:'b',totalLines:3})
 expect(noteLines('a\nb',9,1)).toEqual({body:'',totalLines:2})
})
it('protects imported content from agents but permits metadata and user editing paths',()=>{
 expect(()=>assertEditableSource('pdf','agent')).toThrow('受保护')
 expect(()=>assertEditableSource('pdf','user')).not.toThrow()
 expect(()=>assertEditableSource('chat','agent')).not.toThrow()
})
