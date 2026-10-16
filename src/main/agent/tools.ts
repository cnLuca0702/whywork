import { executionContext } from './context'
import { requireToolConfirmation } from './confirmation'
import { invokeSys, type SysContext } from '../syscalls/registry'

/** Agent 工具注册表：syscall 包装为 LLM tool（DEVELOPMENT.md §7.5）
 *  不暴露：provider/settings/vault.rollback（回滚是用户操作） */

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 返回文本结果（给 LLM 看） */
  run: (args: Record<string, unknown>) => Promise<string>
}

function prop(type: string, description: string, required = false): { type: string; description: string; items?: {type:string} } {
  return { type, description: description || (required ? '' : ''), ...(type==='array'?{items:{type:'string'}}:{}) }
}

function wrap(name: string, description: string, params: Record<string, Record<string, unknown>>, required: string[]): AgentTool {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: params,
      required
    },
    run: async (args) => {
      const payload = name === 'mail.send' ? {...args,confirmed:true} : args
      const r = await invokeSys(name, payload, executionContext.getStore() ?? { win: () => null, emit: () => undefined })
      if (!r.ok) return `错误 [${r.error.code}]: ${r.error.message}`
      const data = r.data
      const prefix=executionContext.getStore()?.sources?.capture(name,data)
      return (prefix?prefix+'\n':'')+(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }
}

export function buildTools(): AgentTool[] {
  return [
    wrap('office.xlsx_summary','只读查看工作簿的工作表、行列数和表头',{path:prop('string','工作区xlsx路径')},['path']),
    wrap('office.xlsx_read','分页读取工作表，多表共享20000字符预算',{path:prop('string','工作区xlsx路径'),sheets:prop('array','工作表名'),offset:prop('number','起始行，从1开始'),limit:prop('number','最多1000行')},['path']),
    wrap('mcp.search_tools','搜索已启用MCP工具预览，不含schema',{query:prop('string','工具名称或描述'),serverIds:prop('array','限定服务器ID'),limit:prop('number','最多20')},['query']),
    wrap('mcp.list_tools','获取MCP工具完整参数定义',{serverId:prop('string','服务器ID'),toolName:prop('string','工具名'),limit:prop('number','分页条数'),offset:prop('number','分页偏移')},['serverId']),
    wrap('mcp.call','按服务器ID和原始工具名调用，需用户确认',{serverId:prop('string','服务器ID'),toolName:prop('string','原始工具名'),arguments:{type:'object',additionalProperties:true}},['serverId','toolName','arguments']),
    wrap('web.get_media','用户指定的在线音视频链接入库，异步返回任务ID',{url:prop('string','用户提交的HTTP(S)链接')},['url']),
    wrap('notes.set_status','设置收藏/置顶/稍后读，返回实际变化字段',{noteId:prop('string','笔记ID'),favorite:prop('boolean','收藏'),pinned:prop('boolean','置顶'),later:prop('boolean','稍后读')},['noteId']),
    wrap('collections.add_note','将笔记加入集合，按标题不存在则创建',{noteId:prop('string','笔记ID'),collectionTitle:prop('string','集合标题')},['noteId','collectionTitle']),
    wrap('collections.remove_note','从集合移除笔记',{noteId:prop('string','笔记ID'),collectionId:prop('string','集合ID')},['noteId','collectionId']),
    wrap('notes.attach_image','附加工作区内图片，返回可用于正文的资源URL',{noteId:prop('string','笔记ID'),path:prop('string','工作区图片路径')},['noteId','path']),
    wrap('file.read_document','将工作区PDF/DOCX/PPTX/XLSX只读转换为Markdown（有预算上限）',{path:prop('string','工作区路径')},['path']),
    wrap(
      'notes.search',
      '在用户知识库全文检索笔记。返回 noteId、标题与命中片段。',
      { query: prop('string', '搜索关键词', true), limit: prop('number', '最多100条，默认20'),timeFrom:prop('string','修改日期起点YYYY-MM-DD'),timeTo:prop('string','修改日期终点YYYY-MM-DD，不含当天'),types:prop('array','笔记类型'),sources:prop('array','来源'),status:{type:'object',properties:{favorite:{type:'boolean'},pinned:{type:'boolean'},later:{type:'boolean'}}},collection:prop('string','集合标题'),sort:{type:'string',enum:['modified','created','accessed','relevance']} },
      ['query']
    ),
    wrap(
      'notes.get',
      '读取一条笔记的完整内容（正文 markdown、双向链接、所属集合）。',
      { noteId: prop('string', '笔记 ID', true),offset:prop('integer','从1开始的行号，负数表示倒数'),limit:prop('integer','读取行数，上限5000') },
      ['noteId']
    ),
    wrap(
      'notes.create',
      '创建新笔记（markdown 正文）。返回 noteId。',
      {
        title: prop('string', '标题', true),
        body: prop('string', 'markdown 正文'),
        source: prop('string', "来源标记，如 chat/manual/pdf，默认 chat"),
        collectionTitles: prop('array', '加入的集合名称列表，不存在会自动创建')
      },
      ['title']
    ),
    wrap(
      'notes.update',
      '更新笔记标题或正文（写前自动快照，可回滚）。',
      { noteId: prop('string', '笔记 ID', true), title: prop('string', '新标题'), body: prop('string', '新正文（整篇替换）'),append:prop('string','末尾追加，与body/edits互斥'),edits:{type:'array',items:{type:'object',properties:{oldText:{type:'string'},newText:{type:'string'}},required:['oldText','newText']}} },
      ['noteId']
    ),
    wrap(
      'notes.delete',
      '把笔记移入回收站（软删，可恢复）。执行前先告知用户。',
      { noteId: prop('string', '笔记 ID', true) },
      ['noteId']
    ),
    wrap(
      'notes.list',
      '按条件列出笔记。',
      {
        query: prop('string', '可选搜索词'),
        filter: prop('object', '过滤：{favorite,pinned,later,unprocessed,collectionId}'),
        limit: prop('number', '默认 100')
      },
      []
    ),
    wrap(
      'file.write',
      '把文本内容写入工作区文件（相对路径；写前自动快照）。禁止覆盖 notes/ 之外的未知大文件。',
      { path: prop('string', '工作区相对路径', true), content: prop('string', '文本内容', true) },
      ['path', 'content']
    ),
    wrap(
      'file.read',
      '读取工作区内文本文件。',
      { path: prop('string', '工作区相对路径', true) },
      ['path']
    ),
    wrap(
      'file.list',
      '列出工作区某目录内容。',
      { path: prop('string', '目录相对路径，缺省为根') },
      []
    ),
    wrap(
      'web.search',
      '联网搜索。返回标题、链接、摘要。',
      {
        query: prop('string', '搜索词，支持 site:/filetype: 等操作符', true),
        count: prop('number', '结果数 1-20，默认 5'),
        freshness: prop('string', '时效过滤：pd(一天)/pw(一周)/pm(一月)/py(一年)')
      },
      ['query']
    ),
    wrap(
      'web.get',
      '抓取网页并转为 markdown 正文。',
      { url: prop('string', 'http(s) 链接', true) },
      ['url']
    ),
    wrap(
      'chart.generate',
      '用 Vega-Lite JSON 规格渲染 SVG 图表，返回文件相对路径。',
      { spec: prop('object', 'Vega-Lite 规格对象', true) },
      ['spec']
    ),
    wrap(
      'llm.decide',
      '向决策模型提问一个是/否问题（用于不确定时的校验）。',
      { question: prop('string', '问题', true) },
      ['question']
    ),
    wrap('browser.fetch','使用隔离浏览器读取动态网页；首次使用下载 Chromium，不使用个人 Cookie。',{url:prop('string','HTTP/HTTPS 网页 URL')},['url']),
    wrap('browser.eval','在隔离网页上下文执行 JavaScript；需用户确认。',{url:prop('string','网页 URL'),script:prop('string','脚本')},['url','script']),
    wrap('calendar.search','搜索本地已导入的 ICS 日历事件。',{query:prop('string','搜索词')},[]),
    wrap('mail.send','发送纯文本邮件；必须由用户确认收件人、主题及正文。',{attachments:{type:'array',items:{type:'object',properties:{path:{type:'string'}},required:['path']}},cc:prop('array','抄送邮箱'),bcc:prop('array','密送邮箱'),id:prop('string','邮件账户 ID'),to:prop('string','收件人邮箱'),subject:prop('string','主题'),text:prop('string','正文')},['id','to','subject','text']),
    {
      name: 'get_local_time',
      description: '获取用户本机当前时间。',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => JSON.stringify({ now: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
    }
  ]
}

export function toProviderTools(tools: AgentTool[]): {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}[] {
  return tools.map((t) => ({ type: 'function' as const, function: { name: t.name.replaceAll('.', '__'), description: t.description, parameters: t.parameters } }))
}

export async function runTool(name: string, argsJson: string, ctx: SysContext): Promise<string> {
  if (!(name.startsWith('mcp__')&&name.split('__').length>=3)) name = name.replaceAll('__', '.')
  if(ctx.useKnowledge===false&&['notes.search','notes.get','notes.list'].includes(name))return '错误：本轮已关闭知识库检索，显式引用仍有效'
  if (ctx.signal?.aborted) throw new Error('操作已取消')
  argsJson=await requireToolConfirmation(name, argsJson, ctx)
  return executionContext.run(ctx, async () => {
  // MCP 工具（mcp__ 前缀）直接路由
  if (name.startsWith('mcp__')) {
    try {
      const { callTool } = await import('../mcp/manager')
      const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
      return await callTool(name, args)
    } catch (e) {
      return `MCP 工具执行失败: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const tools = buildTools()
  const t = tools.find((x) => x.name === name)
  if (!t) return `错误: 未知工具 ${name}`
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return `错误: 工具参数不是合法 JSON: ${argsJson.slice(0, 200)}`
  }
  try {
    return await t.run(args)
  } catch (e) {
    return `工具执行失败: ${e instanceof Error ? e.message : String(e)}`
  }
  })
}
