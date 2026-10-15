import MarkdownIt from 'markdown-it'

// Importers append a standalone source-path comment for local provenance.
// Do not publish it, but preserve examples inside fenced/indented code blocks.
const parser = new MarkdownIt({ html: true })

export function noteMarkdownForExport(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const tokens = parser.parse(normalized, {})
  const last = tokens.at(-1)
  if (last?.type !== 'html_block' || !last.map ||
      !/^<!-- source-path: [^\r\n]* -->\s*$/.test(last.content)) return markdown
  return normalized.split('\n').slice(0, last.map[0]).join('\n').trimEnd()
}
