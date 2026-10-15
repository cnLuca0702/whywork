import fs from 'node:fs'
import path from 'node:path'
import { getWorkspacePath } from '../syscalls/app'

/** 系统提示词与记忆体系（DEVELOPMENT.md §7.2/§7.4） */

export function systemPrompt(skillTexts: string[]): string {
  const skills = skillTexts.length > 0 ? `\n\n# 已加载技能\n${skillTexts.join('\n\n')}` : ''
  return `你是 WhyWork 的 AI 助手——一个本地优先的知识库。用户的所有笔记、文件都存储在本机工作区。

## 工作准则
- 回答语言跟随用户（默认中文）。
- 涉及用户笔记内容时，先用 search_notes / read_note 检索确认，不要凭空猜测。
- 创建、修改、删除笔记或文件必须通过提供的工具（notes_*/file_*），禁止编造路径；所有写入会先自动快照，用户可回滚。
- 删除类操作（notes_delete / file_delete）与批量写入前，先用一句话说明将要做什么再执行。
- 检索外部信息用 web_search / web_get；涉及数据图表用 chart_generate。
- 完成任务后给出简短总结；不确定时直接问用户。
- 当前时间可用 get_local_time 获取。
${skills}`
}

export function memoryDir(): string {
  return path.join(getWorkspacePath(), '.whywork', 'memory')
}

export function readRootMemory(): string {
  try {
    return fs.readFileSync(path.join(memoryDir(), 'MEMORY.md'), 'utf-8')
  } catch {
    return ''
  }
}

/** 组装进 system 的记忆摘要（MEMORY.md 全量 + 今日日志尾部 2000 字） */
export function memoryContext(): string {
  const root = readRootMemory().trim()
  if (!root) return ''
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let daily = ''
  try {
    const raw = fs.readFileSync(path.join(memoryDir(), `MEM-${today}.md`), 'utf-8')
    daily = raw.length > 2000 ? `\n${raw.slice(-2000)}` : `\n${raw}`
  } catch {
    /* 无今日日志 */
  }
  return `# 用户记忆（自动维护）\n${root}${daily}`
}

/** flush：把会话摘要写入今日日志 + 合并 MEMORY.md（跳过无事可记） */
export function appendDailyMemory(content: string): void {
  const dir = memoryDir()
  fs.mkdirSync(dir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const file = path.join(dir, `MEM-${today}.md`)
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : `# ${new Date().toISOString().slice(0, 10)} 工作日志\n`
  fs.writeFileSync(file, `${prev}\n${content.trim()}\n`)
}

export function updateRootMemory(content: string): void {
  const dir = memoryDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'MEMORY.md')
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '# MEMORY\n'
  fs.writeFileSync(file, `${prev}\n${content.trim()}\n`)
}
