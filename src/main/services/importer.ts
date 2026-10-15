import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import TurndownService from 'turndown'
import { parseFrontmatter } from '../db/notes-file'
export async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // pdfjs v6 在 Node/Electron 主进程：直接注入 worker 模块（官方 fake-worker 通道），
  // 避免任何 workerSrc 路径解析问题
  const w = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs')) as unknown as Record<string, unknown>
  ;(globalThis as Record<string, unknown>)['pdfjsWorker'] = w
  return pdfjs
}

/** 导入器：md/txt(UTF8/UTF16)/docx/pdf/enex → 笔记（DEVELOPMENT.md §6.12）
 *  CAP 用例：ENEX(CAP-03)、UTF16(REC-02)、NFC 文件名(CAP-09)、本地图片改链(EDIT-04)、目录递归(CAP-06)、取消(CAP-08) */

export interface ImportResult {
  title: string
  markdown: string
  source: string
  /** 输入文件所在目录（供本地图片相对路径解析） */
  baseDir: string
  tags?: string[]
}

/** 读文本：自动识别 UTF-8 BOM / UTF-16 LE/BE（REC-02） */
function readTextSmart(absPath: string): string {
  const buf = fs.readFileSync(absPath)
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      const le = Buffer.from(buf.subarray(2).swap16())
      return le.toString('utf16le')
    }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf-8')
  }
  return buf.toString('utf-8')
}

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
td.addRule('documentTable', {
  filter: 'table',
  replacement: (_content, node) => {
    const elements = node.querySelectorAll('tr') as ArrayLike<{ children: ArrayLike<{nodeName: string; innerHTML: string}> }>
    const rows = Array.from(elements).map(row => Array.from(row.children)
      .filter(cell => /^(TH|TD)$/i.test(cell.nodeName))
      .map(cell => td.turndown(cell.innerHTML).trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>')))
      .filter(row => row.length)
    if (!rows.length) return ''
    const width = Math.max(...rows.map(row => row.length))
    const lines = rows.map(row => '| ' + Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ') + ' |')
    lines.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |')
    return '\n\n' + lines.join('\n') + '\n\n'
  }
})

/** ENEX（Evernote 导出 XML）→ markdown（CAP-03：标题/正文/标签保真） */
function importEnex(absPath: string): ImportResult[] {
  const xml = readTextSmart(absPath)
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml) as {
    'en-export'?: { note?: unknown }
  }
  let notes = doc['en-export']?.note
  if (!notes) return [{ title: pathToTitle(absPath), markdown: '_（空 ENEX：未找到 note 节点）_', source: 'page', baseDir: path.dirname(absPath) }]
  if (!Array.isArray(notes)) notes = [notes]
  const out: ImportResult[] = []
  for (const n of notes as Record<string, unknown>[]) {
    const title = String(n['title'] ?? pathToTitle(absPath))
    const content = n['content']
    const html = typeof content === 'string' ? content : typeof content === 'object' && content ? String((content as Record<string, unknown>)['#text'] ?? '') : ''
    let md = td.turndown(html)
    // ENEX media 引用（en-media hash）标注为未解析附件
    const tagsRaw = n['tag']
    const tags = (Array.isArray(tagsRaw) ? tagsRaw : tagsRaw ? [tagsRaw] : []).map(String)
    if (tags.length > 0) md = `${md}\n\n---\n标签：${tags.join(', ')}`
    out.push({ title, markdown: md, source: 'page', baseDir: path.dirname(absPath), tags })
  }
  return out
}

function pathToTitle(absPath: string): string {
  return path.basename(absPath, path.extname(absPath)) || '导入笔记'
}

/** Unicode 文件名规范化：macOS HFS+ 返回 NFD，统一 NFC 存储（CAP-09） */
export function normalizeName(s: string): string {
  return s.normalize('NFC')
}

/** 魔数校验（REC-01）：损坏文件在导入入口明确失败，不留半成品 */
function assertHealthy(absPath: string, ext: string): void {
  const checks: Record<string, (b: Buffer) => boolean> = {
    '.png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50,
    '.jpg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8,
    '.jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8,
    '.wav': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE',
    '.aiff': (b) => b.length > 4 && b.subarray(0, 4).toString('ascii') === 'FORM',
    '.pdf': (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
    '.docx': (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b,
    '.enex': (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '<?xml'
  }
  const check = checks[ext]
  if (!check) return
  const head = fs.readFileSync(absPath).subarray(0, 16)
  if (!check(head)) {
    throw new Error(`文件损坏或格式不符（${ext} 魔数校验失败）`)
  }
}

export async function importFile(absPath: string): Promise<ImportResult[]> {
  const norm = absPath
  const ext = path.extname(norm).toLowerCase()
  const baseDir = path.dirname(norm)
  assertHealthy(norm, ext)

  if (ext === '.md' || ext === '.markdown') {
    const { fm, body } = parseFrontmatter(readTextSmart(norm).replaceAll('\r\n', '\n'))
    return [{ title: normalizeName(fm.title ?? pathToTitle(norm)), markdown: body, source: 'manual', baseDir }]
  }

  if (ext === '.txt') {
    return [{ title: pathToTitle(norm), markdown: readTextSmart(norm), source: 'text', baseDir }]
  }

  if (ext === '.enex') {
    return importEnex(norm)
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const { value: html } = await mammoth.convertToHtml({ path: norm })
    return [{ title: pathToTitle(norm), markdown: td.turndown(html), source: 'word', baseDir }]
  }

  if (ext === '.pdf') {
    const pdfjs = await loadPdfJs()
    const data = new Uint8Array(fs.readFileSync(norm))
    const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise
    const parts: string[] = [`# ${pathToTitle(norm)}`, '']
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      let lastY: number | null = null
      let line = ''
      const lines: string[] = []
      for (const item of tc.items) {
        if (!('str' in item)) continue
        const y = item.transform ? item.transform[5] : null
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line)
          line = ''
        }
        line += item.str
        if (item.hasEOL) {
          lines.push(line)
          line = ''
        }
        lastY = y
      }
      if (line) lines.push(line)
      parts.push(...lines.map((l) => l.trim()).filter(Boolean), '', '---', '')
    }
    return [{ title: pathToTitle(norm), markdown: parts.join('\n'), source: 'pdf', baseDir }]
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    return [{ title: pathToTitle(norm), markdown: `![${pathToTitle(norm)}](${path.basename(norm)})`, source: 'image', baseDir }]
  }

  if (['.wav', '.mp3', '.m4a', '.aiff', '.flac', '.ogg', '.webm'].includes(ext)) {
    return [{ title: pathToTitle(norm), markdown: `> 音频文件：${path.basename(norm)}（可用“转写”生成文字稿）`, source: 'audio', baseDir }]
  }

  throw new Error(`暂不支持的导入格式: ${ext}（支持 .md/.txt/.enex/.docx/.pdf/图片/音频）`)
}

/** 收集目录下全部可导入文件（递归，CAP-06 嵌套目录） */
export function collectImportable(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(md|markdown|txt|enex|docx|pdf|png|jpe?g|gif|webp|svg|wav|mp3|m4a|aiff|flac|ogg|webm)$/i.test(e.name)) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/** 导入后改链：把 markdown 中引用的本地图片复制进 resources/<noteId>/ 并改写链接（EDIT-04） */
export function validateEmbeddedImages(markdown:string):void {
  const sources=[...markdown.matchAll(/!\[[^\]]*\]\((data:[^)]*)\)/gi),...markdown.matchAll(/<img[^>]+src="(data:[^"]+)"/gi)]
  let total=0
  for(const source of sources){
    const match=/^data:image\/(png|jpeg|gif|bmp|webp);base64,([a-z\d+/=\s]+)$/i.exec(source[1]!)
    if(!match||match[2]!.length>14*1024*1024)throw new Error('嵌入图片格式不支持或超过10MB，请转换为PNG/JPEG后导入')
    const size=Buffer.byteLength(match[2]!,'base64');total+=size
    if(!size||size>10*1024*1024||total>50*1024*1024)throw new Error('嵌入图片超出导入容量（单张10MB，合计50MB）')
  }
}
export function relinkLocalImages(markdown: string, noteId: string, baseDir: string, wsPath: string, resourceDirRel: string): string {
  validateEmbeddedImages(markdown)
  let out = markdown
  let embeddedBytes = 0
  // ![alt](relative.png) 与 <img src="...">
  out = out.replace(/(!\[[^\]]*\]\()([^)\s][^)]*)(\))/g, (m, pre: string, src: string, post: string) => {
    const copied = copyIfLocal(src, pre, post)
    return copied ?? m
  })
  out = out.replace(/(<img[^>]+src=")([^"]+)("[^>]*>)/g, (m, pre: string, src: string, post: string) => {
    const copied = copyIfLocal(src, pre, post)
    return copied ?? m
  })
  return out

  function copyIfLocal(src: string, pre: string, post: string): string | null {
    // Mammoth emits embedded DOCX images as data URLs. Persist bounded raster
    // bytes into the note's resources so the editor's CSP can display them.
    if (/^data:/i.test(src)) {
      const match = /^data:image\/(png|jpeg|gif|bmp|webp);base64,([a-z\d+/=\s]+)$/i.exec(src)
      if (!match || match[2]!.length > 14 * 1024 * 1024) throw new Error('嵌入图片格式不支持或超过10MB，请转换为PNG/JPEG后导入')
      const data = Buffer.from(match[2]!, 'base64')
      embeddedBytes += data.length
      if (!data.length || data.length > 10 * 1024 * 1024 || embeddedBytes > 50 * 1024 * 1024) throw new Error('嵌入图片超出导入容量（单张10MB，合计50MB）')
      const destRel = path.join(resourceDirRel, crypto.randomUUID() + '.' + match[1]!.toLowerCase())
      const destAbs = path.join(wsPath, destRel)
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      fs.writeFileSync(destAbs, data, { flag: 'wx' })
      return `${pre}whywork-res://${destRel}${post}`
    }
    if (/^(https?:|whywork-res:|myremio-res:|LOCAL_IMAGE:)/i.test(src)) return null
    const srcAbs = path.isAbsolute(src) ? src : path.resolve(baseDir, decodeURIComponent(src))
    if (!fs.existsSync(srcAbs)) return null
    const root = fs.realpathSync(path.dirname(baseDir))
    const real = fs.realpathSync(srcAbs)
    if (real !== root && !real.startsWith(root + path.sep)) return null
    const destName = `${crypto.randomUUID()}-${normalizeName(path.basename(srcAbs))}`
    const destRel = path.join(resourceDirRel, destName)
    const destAbs = path.join(wsPath, destRel)
    try {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      fs.copyFileSync(srcAbs, destAbs)
      return `${pre}whywork-res://${destRel}${post}`
    } catch {
      return null
    }
  }
}
