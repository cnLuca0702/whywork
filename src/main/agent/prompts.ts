import {resolveWorkspacePath} from '../security/paths'
import {getSetting} from '../syscalls/settings'
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspacePath } from '../syscalls/app'

/** 系统提示词与记忆体系（DEVELOPMENT.md §7.2/§7.4） */

export function profilePrompt(read:(key:string)=>string|null=getSetting):string {
 const fields=[['profile.nickname','用户称呼'],['profile.role','身份/角色'],['profile.instructions','用户自定义指令']]
 const lines=fields.map(([key,label])=>read(key!)?`${label}：${read(key!)}`:'').filter(Boolean)
 const language=read('ai.responseLanguage')
 if(language&&language!=='auto')lines.push(`回复语言：${language}。此设置不写入记忆。`)
 return lines.join('\n')
}
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
- 局部修改优先使用 notes.update 的 edits，追加日志优先用 append。导入和转写正文受保护，必要时另建笔记。检索可指定时间、来源、状态和集合，长笔记使用 offset/limit 分段读取。
- 当前时间可用 get_local_time 获取。
${skills}\n\n${profilePrompt()}`
}

export function memoryDir(): string {
  return resolveWorkspacePath('.whywork/memory',true)
}

export function readRootMemory(): string {
  try {
    return fs.readFileSync(resolveWorkspacePath('.whywork/memory/MEMORY.md',true), 'utf-8')
  } catch {
    return ''
  }
}

/** 组装进 system 的记忆摘要（MEMORY.md 全量 + 今日日志尾部 2000 字） */
export function memoryContext(): string {
  if(getSetting('memory.mode')==='off')return ''
  const root = readRootMemory().trim()
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let daily = ''
  try {
    const raw = fs.readFileSync(resolveWorkspacePath(`.whywork/memory/MEM-${today}.md`,true), 'utf-8')
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
  const file = resolveWorkspacePath(`.whywork/memory/MEM-${today}.md`,true)
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : `# ${new Date().toISOString().slice(0, 10)} 工作日志\n`
  fs.writeFileSync(file, `${prev}\n${content.trim()}\n`)
}

export function updateRootMemory(content: string): void {
  const dir = memoryDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = resolveWorkspacePath('.whywork/memory/MEMORY.md',true)
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '# MEMORY\n'
  fs.writeFileSync(file, `${prev}\n${content.trim()}\n`.slice(-12000))
}
