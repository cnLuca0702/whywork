import MarkdownIt from 'markdown-it'
import { resourcePath, resolveWorkspacePath } from '../security/paths'
import { parseFrontmatter } from '../db/notes-file'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { BrowserWindow, dialog } from 'electron'
import { register, type SysContext } from './registry'
import { getWorkspacePath } from './app'
import { getDb } from '../db/client'
import { noteMarkdownForExport } from '../services/note-export'

/** export 域（EXPORT 用例）：markdown→PDF（printToPDF）、音频/图片字节复制、
 *  同名覆盖确认（系统保存对话框自带，EXPORT-06）、导出取消（EXPORT-05：保存对话框取消即无文件写出） */

async function markdownToPdf(absPath: string, title: string, markdown: string): Promise<void> {
  // 简易样式 + 转义，渲染到隐藏窗口后 printToPDF
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const md = new MarkdownIt({html:false,linkify:true,breaks:true})
  md.renderer.rules.image = (tokens,index) => {
    const src=String(tokens[index]?.attrGet('src')??'')
    if (!src.startsWith('whywork-res:') && !src.startsWith('myremio-res:')) return '<span>[外部图片未加载]</span>'
    try {
      const file=resourcePath(src),ext=path.extname(file).toLowerCase()
      const mime = ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'} as Record<string,string>)[ext]
      if(!mime) return '<span>[图片格式未支持]</span>'
      return `<img style="max-width:100%" src="data:${mime};base64,${fs.readFileSync(file).toString('base64')}"/>`
    } catch { return '<span>[图片缺失]</span>' }
  }
  const body = md.render(markdown)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 48px 56px; color: #15141a; line-height: 1.7; font-size: 14px; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 1.4em; } h3 { font-size: 15px; }
  blockquote { border-left: 3px solid #5768ff; color: #73777f; padding-left: 12px; margin-left: 0; }
  hr { border: none; border-top: 1px solid #eceef4; margin: 1.5em 0; }
  p { margin: 0.5em 0; word-break: break-word; }
</style></head><body>${body}</body></html>`

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } })
    fs.mkdirSync(path.dirname(absPath),{recursive:true})
    const tmp=absPath+'.'+Date.now()+'.tmp'
    try { fs.writeFileSync(tmp,pdf);fs.renameSync(tmp,absPath) } finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
  } finally {
    win.destroy()
  }
}

/** 保存对话框（同名覆盖由系统对话框确认，EXPORT-06；取消→不写出文件，EXPORT-05）
 *  targetPath：程序化导出（测试/自动化），跳过对话框 */
async function pickSave(ctx: SysContext, defaultName: string, targetPath?: string): Promise<string | null> {
  if (targetPath) {
    if (!path.isAbsolute(targetPath)) throw new Error('导出路径必须为绝对路径')
    if (fs.existsSync(targetPath)) throw new Error('目标文件已存在，请使用保存对话框确认覆盖或选择新文件')
    return targetPath
  }
  const win = ctx.win()
  if (!win) return null
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: defaultName.endsWith('.pdf') ? 'PDF' : '文件', extensions: [defaultName.split('.').pop() ?? '*'] }]
  })
  if (r.canceled || !r.filePath) return null
  return r.filePath
}

function noteBody(rel: string): string {
  try {
    return parseFrontmatter(fs.readFileSync(resolveWorkspacePath(rel), 'utf-8')).body
  } catch {
    return ''
  }
}

export function registerExportDomain(): void {
  register('export', {
    note_pdf: {
      schema: z.object({ noteId: z.string().min(1), targetPath: z.string().optional() }),
      handler: async (p: { noteId: string; targetPath?: string }, ctx) => {
        const note = getDb().prepare('SELECT title, relative_path FROM notes WHERE note_id = ?').get(p.noteId) as
          | { title: string; relative_path: string }
          | undefined
        if (!note) throw new Error('笔记不存在')
        const target = await pickSave(ctx, `${note.title}.pdf`, p.targetPath)
        if (!target) return { canceled: true }
        await markdownToPdf(target, note.title, noteMarkdownForExport(noteBody(note.relative_path)))
        return { canceled: false, path: target }
      }
    },
    text_pdf: {
      schema: z.object({ title: z.string().default('导出'), text: z.string().min(1), targetPath: z.string().optional() }),
      handler: async (p: { title: string; text: string; targetPath?: string }, ctx) => {
        const target = await pickSave(ctx, `${p.title}.pdf`, p.targetPath)
        if (!target) return { canceled: true }
        await markdownToPdf(target, p.title, p.text)
        return { canceled: false, path: target }
      }
    },
    copy_file: {
      // 音频/图片字节复制导出（EXPORT-03/04：hash 一致）
      schema: z.object({ path: z.string().min(1), targetPath: z.string().optional() }),
      handler: async (p: { path: string; targetPath?: string }, ctx) => {
        const ws = getWorkspacePath()
        const srcAbs = resolveWorkspacePath(p.path)
        if (!fs.existsSync(srcAbs)) throw new Error('文件不存在')
        const target = await pickSave(ctx, path.basename(srcAbs), p.targetPath)
        if (!target) return { canceled: true }
        fs.mkdirSync(path.dirname(target),{recursive:true})
        fs.copyFileSync(srcAbs, target)
        return { canceled: false, path: target }
      }
    }
  })
}
