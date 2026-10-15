import fs from 'node:fs'
import MarkdownIt from 'markdown-it'
import { nativeImage } from 'electron'
import { Document, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, ImageRun, Packer,
  Table, TableRow, TableCell, WidthType, LevelFormat, BorderStyle,
  type ParagraphChild, type IRunOptions, type INumberingOptions } from 'docx'
import { resourcePath } from '../security/paths'
type Token = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number]

// Keep Packer and document classes in one module format: docx resolves hyperlink
// relationships using instanceof, which cannot cross its CJS/ESM class copies.
export async function markdownDocxBuffer(title: string, markdown: string): Promise<Buffer> {
  return Packer.toBuffer(markdownDocument(title, markdown))
}

/** Export editable Markdown structure. External images are never fetched. */
export function markdownDocument(title: string, markdown: string): Document {
  if (markdown.length > 5_000_000) throw new Error('文档超过当前导出容量（500万字符）')
  const tokens = new MarkdownIt({ html: false, breaks: false }).parse(markdown, {})
  const blocks: (Paragraph | Table)[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })]
  const numbering: { config: INumberingOptions['config'][number][] } = { config: [] }
  const lists: { reference: string; pending: boolean }[] = []
  let quoteDepth = 0, imageBytes = 0

  function inline(items: Token[], inherited: IRunOptions = {}): ParagraphChild[] {
    const out: ParagraphChild[] = []
    let bold = 0, italics = 0, strike = 0
    for (let i = 0; i < items.length; i++) {
      const t = items[i]!
      if (t.type === 'strong_open') { bold++; continue }
      if (t.type === 'strong_close') { bold--; continue }
      if (t.type === 'em_open') { italics++; continue }
      if (t.type === 'em_close') { italics--; continue }
      if (t.type === 's_open') { strike++; continue }
      if (t.type === 's_close') { strike--; continue }
      const style: IRunOptions = { ...inherited, bold: !!bold || inherited.bold, italics: !!italics || inherited.italics, strike: !!strike || inherited.strike }
      if (t.type === 'link_open') {
        const end = items.findIndex((item, j) => j > i && item.type === 'link_close')
        if (end < 0) continue
        const href = String(t.attrGet('href') ?? ''), children = inline(items.slice(i + 1, end), style)
        if (/^(https?:|mailto:)/i.test(href)) out.push(new ExternalHyperlink({ link: href, children }))
        else out.push(...children)
        i = end; continue
      }
      if (t.type === 'image') {
        const src = String(t.attrGet('src') ?? '')
        if (!/^(whywork-res:|myremio-res:)/i.test(src)) throw new Error('Word导出图片须先导入工作区；不会自动读取外部路径或下载远程图片')
        const file = resourcePath(src)
        const size = fs.statSync(file).size
        imageBytes += size
        if (size > 10 * 1024 * 1024 || imageBytes > 50 * 1024 * 1024) throw new Error('文档图片超过导出容量（单张10MB，合计50MB）')
        const image = nativeImage.createFromBuffer(fs.readFileSync(file))
        if (image.isEmpty()) throw new Error('无法解码文档图片，请转换为PNG或JPEG后重试')
        const dimensions = image.getSize(), scale = Math.min(1, 600 / dimensions.width, 720 / dimensions.height)
        out.push(new ImageRun({ type: 'png', data: image.toPNG(), transformation: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) }, altText: { title: t.content, description: t.content, name: '笔记图片' } }))
      } else if (t.type === 'hardbreak' || t.type === 'softbreak') out.push(new TextRun({ break: 1 }))
      else if (t.type === 'code_inline') out.push(new TextRun({ ...style, text: t.content, font: 'Menlo', shading: { fill: 'F1F5F9' } }))
      else if (t.type === 'text') out.push(new TextRun({ ...style, text: t.content }))
    }
    return out
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.type === 'blockquote_open') { quoteDepth++; continue }
    if (t.type === 'blockquote_close') { quoteDepth--; continue }
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const reference = 'list-' + numbering.config.length
      const ordered = t.type === 'ordered_list_open'
      numbering.config.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({ level, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: ordered ? `%${level + 1}.` : '•', start: Number(t.attrGet('start') ?? 1), style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) })
      lists.push({ reference, pending: false }); continue
    }
    if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') { lists.pop(); continue }
    if (t.type === 'list_item_open') { if (lists.length) lists[lists.length - 1]!.pending = true; continue }
    if (t.type === 'table_open') {
      const rows: TableRow[] = []
      let cells: TableCell[] = [], header = false
      while (++i < tokens.length && tokens[i]!.type !== 'table_close') {
        const cell = tokens[i]!
        if (cell.type === 'thead_open') header = true
        if (cell.type === 'thead_close') header = false
        if (cell.type === 'tr_open') cells = []
        if (cell.type === 'inline') cells.push(new TableCell({ children: [new Paragraph({ children: inline(cell.children ?? [], { bold: header }) })], ...(header ? { shading: { fill: 'E8EEF8' } } : {}) }))
        if (cell.type === 'tr_close') rows.push(new TableRow({ children: cells, tableHeader: header }))
      }
      if (rows.length) blocks.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
    } else if (t.type === 'inline') {
      const previous = tokens[i - 1], list = lists.at(-1)
      const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
      blocks.push(new Paragraph({ children: inline(t.children ?? []),
        ...(previous?.type === 'heading_open' ? { heading: headings[Number(previous.tag.slice(1)) - 1] } : {}),
        ...(list?.pending ? { numbering: { reference: list.reference, level: Math.min(lists.length - 1, 8) } } : {}),
        ...(quoteDepth ? { indent: { left: 360 * quoteDepth }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } } } : {}) }))
      if (list) list.pending = false
    } else if (t.type === 'fence' || t.type === 'code_block') {
      blocks.push(new Paragraph({ children: t.content.replace(/\n$/, '').split('\n').map((text, line) => new TextRun({ text, font: 'Menlo', ...(line ? { break: 1 } : {}) })), shading: { fill: 'F1F5F9' } }))
    } else if (t.type === 'hr') blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } } }))
  }
  return new Document({ creator: 'WhyWork', title, numbering, styles: { default: { document: { run: { font: 'PingFang SC', size: 22 }, paragraph: { spacing: { after: 120 } } } } }, sections: [{ children: blocks }] })
}
