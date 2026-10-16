# WhyWork × remio 规划功能对比分析

> 生成：2026-10-15。用途：为 `docs/CODEX-TASKS-REMIO.md` 提供依据。范围仅限 WhyWork 已规划的功能。
> 目标版本：remio 3.21.4（`com.everdent.remio`），`app.asar` SHA-256 `ded6386d6d22f56152d013c1b574890d9b2b3b09cbf99189b7fa49c076c99f75`。
> WhyWork 基线：main @ 2ba2a71，加上工作区内未提交的改动（D3 等）。

## 0. 方法、证据与边界

### 0.1 证据来源

所有 remio 材料都在仓库外的 `/home/orca/work/remio-research/`，**不得复制进 WhyWork 仓库**（README 已约定闭源提取物不入库）。

| 标记 | 含义 | 位置 |
|---|---|---|
| 〔D:xxx〕 | remio 内置给 Agent 的能力契约文档（行为层，最可靠） | `extracted/out/main/agents/remio_syscalls_xxx.md`、`rvault.md`、`memory_flush_prompt.md` |
| 〔S:key〕 | remio 渲染层中文界面文案（交互层：按钮、状态、提示、确认） | `zh-clean.tsv`（从 `out/renderer/assets/index-*.js` 静态提取，8118 条，已去除日文） |
| 〔REA〕 | REA 6.5.0 对主进程/preload 的静态分析结果 | `rea-evidence/` |
| 〔W:path〕 | WhyWork 当前源码 | 本仓库 |

### 0.2 方法与限制

- 全部是**静态分析**：没有运行 remio，没有登录账号，没有读取用户数据。文案和契约文档说明的是“设计意图与界面元素”，不等于运行时一定如此。
- `app.asar.unpacked/`（原生模块）没有拷贝，解包时这部分缺失。原生能力（OCR 引擎、录音、快捷键模块）只凭文案和契约推断。
- REA MCP 工具在本次会话中未加载（安装后需重启会话），按 REA 技能文档的 CLI 备选路线执行 `analyze-javascript-application`。
- **清洁室规则**：本文和任务书只描述“行为与交互”，不搬运 remio 的代码、提示词原文、图标、品牌名或长段文案。实现时用 WhyWork 自己的写法和中文文案。

### 0.3 纳入与不纳入

**纳入**（WhyWork 已规划，DEVELOPMENT §6/§7/§10/§11、TASKS-HANDOFF P2）：知识库列表与检索、笔记详情与编辑、对话与 Agent、rVault、记忆、供应商与模型、MCP 与技能、采集（目录/剪藏/快捷键/在线音视频）、Office、浏览器、邮件、日历、录音与转写、OCR、手机配对。

**不纳入**（不在规划内，或违反 DEVELOPMENT §1.1 / TASKS-HANDOFF §三）：

| remio 功能 | 不纳入原因 |
|---|---|
| 账号登录、积分、兑换码、会员、签到 | §1.1 禁止 |
| 云同步（bisync）、公开分享 `share_note` | §1.1 禁止云同步；分享需上传到 remio 云 |
| aApp 智能应用、技能市场、aApp 市场 | §1.1 禁止 aApp 运行时与市场 |
| 自动化（定时/内容触发 prompt） | 未规划 |
| Table 结构化数据表、人物笔记、声纹 | 未规划 |
| 全局语音输入法 | 未规划 |
| OpenCLI（复用用户 Chrome 登录态） | 与 WhyWork“隔离浏览器、不带个人登录态”原则冲突 |
| 飞书/钉钉/Microsoft 365/Google Drive/Plaud/微信小助手 | 未规划，且依赖第三方账号 |
| Python/Node 包管理、bash 执行 | 未规划，Agent 工具不含 shell |
| 笔记密码与访问限制 `restrictions` | DDL 预留但“本期恒空” |

## 1. 对话与 Agent（M3）

### 1.1 消息渲染与回复操作

- **WhyWork 现状**：助手回复用 `whitespace-pre-wrap` 直接输出原文，不解析 Markdown〔W:src/renderer/src/components/ChatPanel.tsx:60-66〕。没有复制、重新生成、思考过程显示。供应商层没有处理推理内容〔W:src/main/providers/*〕。
- **remio 做法**：回复下方有“复制”“重新生成”〔S:copy, ai-regenerate〕；推理模型显示“思考中：N 字”，结束后变为“思考完了”并可折叠〔S:thinking-generating, thinking-done〕；长会话有“会话轮次”跳转〔S:chat-elevator〕；回复进行中离开会提示中断〔S:ai-chat-aborted〕；回复中禁止修改会话〔S:error-4503〕。
- **差距**：Markdown 不渲染是最明显的体验缺口，表格、代码、公式全部是原文。
- **借鉴结论**：复用笔记详情页已有的 markdown-it + DOMPurify + KaTeX 渲染管线；增加复制、重新生成；推理内容作为可折叠块显示。→ 任务 R1。

### 1.2 输入框：@ 引用、/ 技能、附件

- **WhyWork 现状**：输入框只有纯文本；“笔记上下文”只能通过当前打开的笔记隐式绑定〔W:ChatPanel.tsx:262〕；`chat.send` 只有 `{chatId,text,selection}`〔W:src/main/syscalls/chat.ts:136〕。
- **remio 做法**：输入框提示“直接提问，或按 @ 引用笔记，按 / 唤起智能应用和技能”〔S:ask-something〕；被引用内容显示为可移除的标签，可“移除引用/移除全部引用”，并显示“N 条引用”〔S:delete, clear, count〕；“添加文件或网页”〔S:add-file-or-webpage〕，支持 Word/PPT/Excel/CSV/PDF/图片/文本〔S:ask-upload-tips〕，有大小上限〔S:attachment-limits〕。
- **借鉴结论**：`@` 弹出笔记搜索、`/` 弹出技能列表、附件按钮，三者都以“引用标签”形式出现在输入框上方，随消息一起发送。→ 任务 R2。
- **WhyWork 取舍**：remio 附加一个文件时会同步该文件所在的整个文件夹〔S:upload-folder-modal〕，范围过大，WhyWork 不照搬，只导入所选文件。

### 1.3 知识库问答的引用来源

- **WhyWork 现状**：Agent 通过 `notes.search` 工具检索，但回答中没有来源标注，用户无法回到原文。RAG-01~07 用例要求答案可核对。
- **remio 做法**：`rag` 返回 `citations[{docIndex,noteId,title}]` 与逐句 `resolvedCitations`；流式时正文内嵌引用标记，并单独推送引用事件〔D:execution `rag`/`rag_stream`〕；界面可“定位引用 N”〔S:locate〕、“复制（带引用）”〔S:copy-with-citation〕；有“引用知识库”开关〔S:reference-knowledge-base〕和“精确引用”（附原句，可精确跳转）〔S:precise-citation-description〕；`search_notes` 返回 `chunks_info` 命中片段区间〔D:notes `search_notes`〕。
- **借鉴结论**：在 Agent 循环内为本轮检索到的笔记编号，模型用 `[n]` 标注，界面渲染为角标，点击打开笔记并定位片段。→ 任务 R3。
- **限制**：WhyWork 没有语义检索（只有 FTS5 与本地逐词），“精确到句”的引用不承诺，只承诺到“笔记 + 命中片段”。

### 1.4 确认交互

- **WhyWork 现状**：`chat.confirm` 事件弹出 `Modal.confirm`，显示工具名和原始 JSON 参数〔W:ChatPanel.tsx:150-156〕；邮件发送另有一个 Modal〔W:ToolsView.tsx〕。
- **remio 做法**：确认以卡片形式出现在对话流中。发信前必须先渲染预览卡：发件账号（多账号时可切换，单账号时隐藏选择器）、收件人/抄送/密送、主题、正文摘要、附件；用户修改草稿后重新渲染预览，不直接发送；没有草稿模式〔D:mail `send_mail`〕。删除受保险箱保护的本地文件、非空目录时有专门的二次确认〔S:confirm-delete-changed-item*, confirm-delete-non-empty-folder*〕。
- **借鉴结论**：确认改为对话流内的卡片，按工具类型渲染可读摘要（邮件、文件写入/删除、MCP 调用、网页脚本），不再展示原始 JSON。→ 任务 R4。

### 1.5 Agent 笔记工具契约

- **WhyWork 现状**：工具只有 `notes.search/get/create/update/delete/list`；`notes.update` 只能整体替换 `{title?,body?}`；`notes.search` 只有 `{query,limit}`〔W:src/main/agent/tools.ts〕。集合、状态、图片、OCR、文件读取都没有暴露给 Agent。
- **remio 做法**〔D:notes〕：
  - `update_note` 支持三种互斥写法：整体 `content`、局部 `edits[{oldText,newText}]`、末尾 `append`。`edits` 要求原文唯一、不重叠，找不到时尝试行级模糊匹配，错误信息具体到第几条。
  - 正文不要以与标题重复的 H1 开头，重复时自动去掉；`read_note` 返回的 frontmatter 回写时自动剥离。
  - 导入/生成类内容（网页、邮件、会议转写、PDF/Word 等解析结果）拒绝改写正文，只允许改元数据。
  - 删除同步来的本地文件必须走界面确认流程，Agent 不能直接删。
  - `search_notes` 支持时间区间（半开）、类型、状态、集合、排序、`item_ids`、标题过滤，`limit` 默认 20、上限 100，返回 `total/showing`、预览、所属集合、状态。
  - `read_note` 支持 `offset/limit` 分段读取。
  - `add_note_to_collection` 按标题不存在则自动建集合，返回 `createdCollection`。
  - `set_note_status` 幂等，返回实际改变的字段 `applied`。
  - `attach_image` 返回 token，正文用 token 引用，禁止跨笔记引用资源。
  - `read_file` 把本地 Office/音视频文件读成 Markdown，按文件修改时间缓存。
- **借鉴结论**：扩充 Agent 工具，重点是局部编辑与追加（长笔记改写可靠性显著提高）、检索过滤和分段读取。→ 任务 R5。

### 1.6 会话管理

- **WhyWork 现状**：侧栏“最近对话”只列 20 条〔W:Sidebar.tsx〕；**删除会话的 Popconfirm 包着一个空 `<span />`，界面上点不到**〔W:ChatPanel.tsx:281-285〕；`chat.rename` 在界面中没有入口；标题取首条消息前 20 字〔W:chat.ts:146〕。
- **remio 做法**：对话可分组，删除分组时同时删除其中对话并报告部分失败〔S:delete-group-and-sessions-*〕；原会话被删时给出明确提示〔S:sourceUnavailable〕；会话命名由基础模型生成〔S:basic-generation-description“总结、对话命名等”〕。
- **借鉴结论**：修复删除入口，增加重命名、搜索会话、AI 自动命名（使用后台任务模型）。分组列为可选。→ 任务 R6。

## 2. rVault 保险箱（M3）

- **WhyWork 现状**：抽屉按行显示 `kind/op/path` 英文原值和单条回滚〔W:ChatPanel.tsx:80-142〕；入口是一个无数字的盾牌图标。
- **remio 做法**〔D:vault, rvault〕：
  - 对话头部显示“保险箱 N”徽标〔S:changed-items〕，说明为“自动备份本会话删除/修改/创建的资料，一键还原”〔S:changed-items-plain〕。
  - 条目分为 文件/目录/笔记/笔记-集合关系 四类，动作分为 新建/修改/删除/重命名，重命名显示原路径。
  - 回滚结果分为 已恢复/已跳过/剩余；新建的文件和目录回滚时移到系统废纸篓；回滚含文件的新建目录前返回 `needsConfirm` 并列出嵌套项。
  - 同会话内“新建后删除”相互抵消；多次修改只保留第一次快照。
  - Agent 只在用户要求撤销时才可调用回滚，且必须先列出、按条目匹配，有歧义时询问。
- **借鉴结论**：界面中文化并分组，加数字徽标，回滚后给出结果摘要，新建目录回滚加二次确认。WhyWork 仍保持“回滚是用户操作、不暴露给 Agent”的既有规则〔W:DEVELOPMENT §7.5〕，这是有意保留的差异。→ 任务 R7。

## 3. 记忆、用户档案与回复语言（M3 §7.4）

- **WhyWork 现状**：`MEMORY.md`、日志、技能记忆的结构已按原作复刻〔W:DEVELOPMENT §7.4〕；设置页没有记忆相关入口，也没有用户档案和回复语言设置。
- **remio 做法**：记忆模式“高质量（每次切换会话同步记忆）/高性价比（跳过以节省 API 费用）”〔S:memory-system-preference*〕；设置项包括昵称、自我介绍、自定义 AI 指令、回复语言、默认转写语言〔D:general `get_settings`〕；记忆整理规则：只记 4 类、无事可记不写、合并重复、不记录可查询的运行时状态（路径、版本、配置、笔记内容）、`MEMORY.md` ≤3000 字、技能相关条目逐步迁移到技能记忆且“先写目标再删源”〔D:memory_flush_prompt〕。
- **借鉴结论**：设置页新增“个性化与记忆”分组；记忆整理规则中 WhyWork 缺的两条（不记录运行时状态、迁移时先写后删）补进提示词。→ 任务 R8。

## 4. 知识库列表与笔记详情（M1/M2）

### 4.1 列表

- **WhyWork 现状**：后端 `notes.list` 已支持 `sort` 和类型/来源过滤〔W:src/main/syscalls/notes.ts:89〕，界面没有排序、类型、时间筛选；只能单条操作；行内只有收藏/置顶/删除。
- **remio 做法**：检索维度含时间区间、内容类型、状态、集合、排序（修改/创建/访问/相关度）〔D:notes `search_notes`〕；“批量收藏”〔S:bookmark-batch〕；“加入集合”“加入稍后”〔S:add-to-collection, add-to-later〕；列表可“按 App/工作目录”分组〔S:group-by-source〕；网页笔记可按站点批量删除〔S:batch-delete-confirm-*〕；“复制标题和链接”“复制路径”〔S:copy-title-and-link, copy-path〕。
- **借鉴结论**：工具条加排序、类型、时间筛选；多选模式与批量操作；行“更多”菜单。→ 任务 R9。

### 4.2 笔记详情

- **WhyWork 现状**：已有编辑/预览、出入链与未解析链接创建、集合、导出 PDF、推送讯飞〔W:NoteDetailView.tsx〕。`llm.summarize` 已实现但**界面没有调用入口**，因此“未处理”筛选下的笔记无法在界面中处理；且它仍用旧的 `fast` 角色选模型〔W:src/main/syscalls/llm.ts:88〕，与当前“仅显式选择的模型生效”契约不一致。
- **remio 做法**：“添加摘要”“生成大纲”〔S:add-a-summary, generate-outline〕；“相关笔记”与“查找相关笔记中”状态〔S:for-your-reference, looking-for-related-notes〕；“插入内链”〔S:insert-remio-inlink〕。
- **借鉴结论**：详情页加“生成摘要与关键词”按钮，“未处理”列表加“批量处理”；加“相关笔记”面板，基于标题与关键词做 FTS 查询，明确标注“基于关键词匹配”；后台任务统一走一个可配置的“后台任务模型”。→ 任务 R10。

## 5. 供应商、模型与搜索设置（M4）

- **WhyWork 现状**：三类提供商入口、按会话显式选模型已完成〔W:DEVELOPMENT 2026-10-15 节〕；搜索固定 Brave > Tavily > DuckDuckGo 顺序。
- **remio 做法**：区分“基础模型”（摘要、对话命名等后台生成）与对话模型〔S:basic-generation-description〕；模型能力标注“支持推理/不支持推理”、上下文长度、默认推理级别〔S:reasoning-supported, default-reasoning-effort；D:general `llmAvailableModels`〕；每轮显示“共 N 次模型调用”〔S:detail〕；搜索模式 普通/智能（普通不足再补高质量）/高质量优先（无结果回退普通），API Key 有“验证”并显示已连接/失败〔S:mode-*, verify-*〕；模型过载时提示“与 API Key 是否有效无关”〔S:llm-error-solution-model_overloaded〕。
- **借鉴结论**：新增“后台任务模型”设置（不回退到 fast/expert，仍是显式的供应商+模型）；搜索模式三选一并适配 BYOK；Key 验证按钮；错误分类提示。→ 任务 R11。

## 6. MCP 与技能（M5）

- **WhyWork 现状**：只支持 stdio；把所有 MCP 工具以 `mcp__服务器__工具` 名义注入 Agent〔W:DEVELOPMENT §6.7, §7.5〕；技能为工作区/全局目录扫描 + 开关。
- **remio 做法**〔D:mcp, mcp_call〕：
  - 系统提示词只列出已连接服务器的名称和描述，不列工具；模型先用 `mcp_search_tools` 按关键词跨服务器搜索（精确名 > 名称子串 > 描述，返回不含 schema 的预览），再用 `mcp_list_tools` 取单个工具完整 schema，最后 `mcp_call`。工具多时提示词不会膨胀。
  - 单个服务器发现失败放进 `errors`，不影响其他服务器的结果。
  - 支持 `streamable-http` 传输，`token`/自定义 header 加密存储，凭据不经过模型。
  - 界面有“添加 MCP Server”、校验失败提示“请检查 URL 和 Token”〔S:mcp-validation-failed〕，以及“没找到要用的服务可切到手动配置”〔S:connector-quick-not-found-hint〕。
  - 技能库：我的技能、搜索、详情（技能说明）、卸载确认（可重新安装）、刷新〔S:mine, search-placeholder, instructions, uninstall-confirm-*〕。
- **借鉴结论**：工具数超过阈值时改用“搜索→取定义→调用”三段式元工具；增加 HTTP 传输与加密 token；技能库界面加搜索、详情、卸载；输入框 `/` 调用技能（见 R2）。技能市场不做。→ 任务 R12、R13。

## 7. 采集（M6）

### 7.1 目录同步

- **WhyWork 现状**：选择目录 → 监控，状态为字符串，可暂停/恢复/立即扫描/移除〔W:CaptureTools.tsx, src/main/syscalls/watch.ts〕。
- **remio 做法**〔D:sync_folder〕：添加时拒绝已登记路径，以及“已被上级同步文件夹覆盖”的子路径；状态为 收集中/生成笔记中/监控中/已暂停；移除时保留已导入笔记；有推荐文件夹（下载等）〔S:suggested-folders, connect_downloads_folder〕；权限不足时提示到系统设置开启〔S:folder-permission-tip〕。
- **借鉴结论**：增加祖先/子路径重叠校验、结构化状态、推荐目录一键添加、权限错误提示。→ 任务 R14。

### 7.2 全局快捷键

- **WhyWork 现状**：固定 `⌥⌘Space`、`⌥⌘N`〔W:src/main/services/capture.ts:19-20〕。
- **remio 做法**：点击后录制组合键；被占用、与另一个触发方式冲突、可能与系统冲突、缺少修饰键时分别提示；可恢复默认〔S:hotkey-*，error-4120/4121〕。
- **借鉴结论**：快捷键可自定义，带冲突检测。→ 任务 R15。

### 7.3 在线音视频（DEVELOPMENT §6.3 `web.get_media` ☆）

- **remio 做法**〔D:web `web_get media:true`, media〕：优先取平台字幕，没有再 ASR；链接是合集时只处理所指的那一集，并告诉用户是合集及集数，不自动批量下载；状态 pending/parsing/downloading/transcribing/processing/success/failed；产出主笔记 + 转写笔记 + 概览；可粘贴多个链接〔S:description“粘贴1个或多个在线音视频链接…”〕；取消时保留已建主笔记〔S:cancel-confirm-message〕。
- **借鉴结论**：按以上状态机实现，ASR 走用户自配端点。需要下载器（如 yt-dlp），是否内置由用户决定。→ 任务 R16。

## 8. 录音与转写（M10）

- **WhyWork 现状**：录音状态机完整（暂停/继续/取消/重试/幂等保存），单段 50MB 上限，ASR 需单独点击〔W:DEVELOPMENT 检索与录音补全契约〕。
- **remio 做法**：开始前选择录音语言〔S:language-selection-dialog-title〕；录音中可记录要点，录完后自动优化〔S:key-points〕；保存后询问“是否转录音频？另有 N 个待处理”〔S:description-with-pending〕；结果拆成 录音纪要（主笔记）/会议转录/会议纪要 三类笔记〔S:MeetingRecording, recording_transcript, recording_minutes〕；先贴原始转写再异步替换为优化结果〔S:async-optimize-desc〕；专有名词词典用于转写纠错〔S:dictionary-desc, guide-desc〕；超长录音到上限自动保存〔S:recording-timeout〕；过短提示〔S:recording-too-short〕；录音中退出应用需确认〔S:quit-confirmation-message〕。
- **借鉴结论**：语言选择、录音要点、保存后转写提示与待处理计数、三类关联笔记（转写 + 纪要由后台任务模型生成）、专有名词词典、单段上限自动分段。说话人识别与声纹不做。→ 任务 R17。

## 9. OCR（M10）

- **remio 做法**〔D:media `ocr_image`, notes `read_note`〕：OCR 结果是逐行文字 + 坐标框；默认整图一遍，必要时最多一次区域重试；笔记中的图片在 `read_note` 时附带 OCR 文本，图片因此可被检索和问答。
- **借鉴结论**：笔记内图片的 OCR 文本进入 FTS 索引，Agent 读取笔记时附带图片文字。→ 任务 R18。

## 10. Office（M7）

- **WhyWork 现状**：Univer 表格编辑与 ExcelJS 写回；笔记转 DOCX；按页纲生成 PPTX〔W:ToolsView.tsx, services/office*.ts〕。Agent 不能读表格。
- **remio 做法**〔D:office〕：`xls` 提供 summary（结构概览）与 read（指定工作表，按行分页，所有表共享字符预算，截断时告知剩余行数和续读 offset）；`ppt` 有 9 种设计预设（配色+字体角色+CJK 字体按语言选择）、单页插入/替换/删除/移动、页面截图预览、字体缺失警告。
- **借鉴结论**：Agent 增加表格 summary/分页 read 工具；PPT 生成前先展示可编辑的页纲，并提供少量主题预设。复杂版式、图表、逐页编辑不做（TASKS-HANDOFF §三）。→ 任务 R19。

## 11. 邮件（M9）

- **WhyWork 现状**：账户表单、同步、发送 Modal 确认；Agent 工具 `mail.send` 只支持纯文本〔W:tools.ts:135〕。
- **remio 做法**〔D:mail, accounts〕：见 1.4 的预览卡；附件单个 ≤20MB、总计 ≤25MB〔S:attachment-limits〕；解除邮箱连接时询问已同步邮件如何存档〔S:disconnect-mail-tip2〕；授权失效、连接失败有专门提示和诊断〔S:authorization-*, diagnosis-*〕。
- **借鉴结论**：发信预览卡（并入 R4）、附件与限额、移除账户时选择保留或删除已导入邮件、失败分类提示。→ 任务 R20。

## 12. 日历（M9，§6.13 `calendar.accounts_*` 占位）

- **WhyWork 现状**：仅导入 ICS 文件，搜索过去 30 日至未来一年。
- **remio 做法**〔D:calendar〕：支持 Mac 系统日历（系统权限：已授权/未授权）〔S:calendar-access-*〕；`search_events` 的日期为半开区间 `[start,end)`，省略时为当前 ±1 年，有关键词时默认按相关度排序，`limit` 默认 20、上限 100；返回带时区偏移的 ISO 时间，全天事件用日期。
- **借鉴结论**：接入 macOS 系统日历（只读，需要 Swift 辅助程序或 EventKit 桥接），统一搜索语义。创建/修改事件不在规划内。→ 任务 R21。

## 13. 手机配对（M11 / N1）

- **remio 做法**：“打开移动端扫一扫绑定”、二维码过期、绑定成功、解除绑定〔S:mobile-scan-to-bind, expired, mobile-bound-success, unbind〕。remio 依赖账号云端，WhyWork 只取交互。
- **借鉴结论**：二维码倒计时与过期刷新、绑定成功事件、解绑确认。Android 端仍按 N1 独立立项。→ 任务 R22。

## 14. REA 静态分析摘要

- 命令：`npx -y rea-agents@6.5.0 analyze-javascript-application <extracted> --source-path package.json --source-path out/main/index.js --source-path out/preload/index.js --json`
- Evidence ID：`ev_2bee3692fb588987581527c3bbcb9d5c226a5f97254dc52f664f0ef6457d5d0e`（authority `shipped-artifact`，confidence `derived`）；完整结果在 `rea-evidence/main-preload.json`，通道清单在 `rea-evidence/ipc-channels.txt`。
- **覆盖限制**：只选了 3 个源文件，其余 21065 个文件在范围外；`out/main/index.js`（7.8MB）分析时 REA 工作进程内存耗尽，主进程只有部分结果，所以 `main_handlers=0` 不代表主进程没有处理器。以下结论主要来自 preload。
- **观察到的结构**：preload 通过 3 个 contextBridge API 暴露 826 个成员；1029 处 IPC 操作中，736 个字面通道、275 处动态拼接通道。这印证了 WhyWork 只用 3 个通道、禁止动态通道的既有决定（DEVELOPMENT §1.1、§2.1），**不需要改动**。
- **与规划功能相关的通道**（只说明存在对应的界面调用，不证明运行时行为）：

| 通道（节选） | 对应任务 | 说明 |
|---|---|---|
| `saveChatReferences`、`getReferenceById` | R2、R3 | 对话引用会持久化，可按 ID 取回 |
| `registerAgentApprovalObserver`、`registerAgentAskUserQuestionObserver` | R4 | Agent 审批与“向用户提问”都有独立的界面通道 |
| `flushSessionMemoryIfNeeded`、`getAgentMemoryFolderNote` | R8 | 切换会话时按需整理记忆；记忆目录可作为笔记打开 |
| `receiveSummaryStream`、`cancelNoteSummaryStream`、`saveSummary`、`getResourceRelatedNotes` | R10 | 摘要流式生成、可取消、单独保存；相关笔记 |
| `getRecentCollections`、`noteRecommendedCollections`、`addNoteToCollection` | R9 | “加入集合”时提供最近使用的集合（AI 推荐默认关闭，见〔S:collection-settings-description〕） |
| `getSyncFolders`、`start/pause/resume/removeSyncFolder` | R14 | 目录同步生命周期 |
| `setShortcutBinding`、`resetShortcutBinding`、`resetAllShortcutBindings`、`shortcutConfigChanged` | R15 | 快捷键单项/全部恢复默认，变更广播 |
| `start/pause/resume/finishRecording`、`recordingTimeUpdate`、`meetingAutoStopRequested`、`listMeetingMinutesTemplates`、`generateMeetingInsights`、`meetingInsightsStream`、`retryMeetingProcess` | R17 | 录音时长推送、自动停止、**纪要模板**、纪要流式生成与重试 |
| `getMeetingTranscriptPreview`、`meetingTranscriptPreviewUpdate` | （不纳入） | 录音中的实时转写预览，需要流式 ASR，BYOK 批量端点一般不支持 |
| `queueBackgroundPdfOcr` | R18 | 扫描版 PDF 的后台 OCR 队列 |
| `calendar.checkOSCalendarAccess`、`calendar.requestOSCalendarAccess` | R21 | 系统日历权限检查与请求分离 |
| `sendMailQueued`、`getMailSendQueueStatus`、`retryMailSendTask`、`diagnoseMailNetwork` | R20 | 发信进入队列、可查询状态、失败可重试、网络诊断 |
| `queryInstalledSkills`、`getSkillDetail`、`get/setExternalAgentSkillDirs`、`skillsChanged` | R13 | 已装技能、详情、额外技能目录、变更广播 |
| `listMcpServers`、`setMcpServerEnabled`、`mcpServersChanged` | R12 | MCP 列表与启停广播（`listMcpConnectors`、`startMcpOauth` 属于不纳入的内置连接器与 OAuth） |
| `url-ingest-progress`、`podcast-progress`、`podcastBatchRetry` | R16 | 链接导入与音视频处理进度、批量重试 |

## 15. 未解决问题

1. 对话附件导入知识库还是只作临时上下文：本文采用“导入知识库并作为引用”，见 R2，需用户确认。
2. 在线音视频是否内置下载器（yt-dlp 等）：需用户决定（R16）。
3. macOS 系统日历桥接方案（Swift 辅助程序 vs. 其他）：需在 macOS 环境验证（R21）。
4. remio 的“精确到句”引用依赖语义检索与分句，WhyWork 只能做到“笔记 + 片段”，是否接受需用户确认。
5. 原生模块（`app.asar.unpacked`）未取得，录音、OCR、快捷键的底层实现细节未核实。
