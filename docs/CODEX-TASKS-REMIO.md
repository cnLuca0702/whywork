# Codex 开发任务书：借鉴 remio 交互改写 WhyWork

> 生成：2026-10-15。依据：`docs/REMIO-COMPARISON.md`（逐功能对比与证据）。
> 本任务书只覆盖 WhyWork 已规划的功能。不在规划内的 remio 功能见对比文档 §0.3，**不要实现**。
> 与现有清单的关系：本任务书的 R 系列与 `TASKS-HANDOFF.md` 的 D4～D7 相互独立。执行计划先完成 D4（CI），让后续改动有回归保护；D6 的核心检查随 CI 接入。当前状态统一见 `TASKS-HANDOFF.md`，运行证据见 `PROGRESS.md`。

## 一、开工前必读

1. 阅读顺序：`docs/PROGRESS.md` 末三节 → `docs/DEVELOPMENT.md` §2/§6/§7/§10 → `docs/REMIO-COMPARISON.md` 中对应章节 → 本任务。
2. **先改文档再改代码**（DEVELOPMENT 文首规则）：凡是新增或修改 syscall、事件、表结构、设置键，先在 `DEVELOPMENT.md` 写清契约，再实现；完成后在 `PROGRESS.md` 记会话日志和 changelog。
3. **清洁室**：remio 材料在仓库外的 `/home/orca/work/remio-research/`，只用于理解行为。不复制其代码、提示词原文、图标、品牌名或长段文案，也不要把任何 remio 文件放进本仓库。
4. 工程纪律沿用 `TASKS-HANDOFF.md` §四：main/preload 改动后重启 dev；剪贴板菜单约束；所有文件访问经 `src/main/security/paths.ts`；凭据只进 safeStorage；新增界面文案进 `src/renderer/src/i18n/zh.ts`。
5. 每个任务完成门槛：`npm run typecheck && npm test && npm run build && electron out/main/index.js --smoke-test` 全绿；涉及界面的任务再跑 `npm run check:ui`（Linux 用 `xvfb-run -a`），并把新视图状态纳入截图。
6. 数据库变更只能做**可重复执行的增量迁移**（`CREATE TABLE IF NOT EXISTS`、检查列存在后 `ALTER TABLE ... ADD COLUMN`），不得删列或改变既有语义，旧工作区必须能直接打开。
7. 工作区内可能有其他 agent 并行改动：用 `git worktree` 分支开发，提交前 `git pull --rebase`，提交信息按模块前缀。

## 二、任务总览

| ID | 任务 | 优先级 | 依赖 | 规模 |
|---|---|---|---|---|
| R1 | 对话消息 Markdown 渲染、复制、重新生成、思考过程 | P0 | — | 中 |
| R11 | 后台任务模型、搜索模式、Key 验证、错误分类、用量显示 | P0（后台模型部分）/P1 | — | 中 |
| R5 | Agent 笔记工具契约增强 | P0 | — | 中 |
| R2 | 输入框 @ 引用笔记、/ 技能、附件 | P0 | R1 | 中 |
| R3 | 知识库问答引用来源 | P0 | R1、R5 | 中 |
| R4 | 对话流内确认卡（含发信预览卡） | P0 | — | 中 |
| R6 | 会话管理：修复删除、重命名、搜索、AI 命名 | P0 | R11 | 小 |
| R7 | rVault 保险箱面板升级 | P1 | — | 小 |
| R8 | 个性化与记忆设置 | P1 | — | 小 |
| R9 | 知识库列表：排序、筛选、多选批量、更多菜单 | P1 | — | 中 |
| R10 | 笔记详情：AI 摘要、批量处理、相关笔记 | P1 | R11 | 中 |
| R14 | 目录同步：重叠校验、结构化状态、推荐目录 | P1 | — | 小 |
| R17 | 录音：语言、要点、转写提示、三类笔记、词典、分段 | P1 | R11 | 大 |
| R12 | MCP：HTTP 传输、工具搜索三段式 | P2 | — | 中 |
| R13 | 技能库界面 | P2 | — | 小 |
| R15 | 全局快捷键自定义 | P2 | — | 小 |
| R16 | 在线音视频链接转写（`web.get_media`） | P2 | R11、R17 | 大 |
| R18 | 图片 OCR 进入检索与 Agent 读取 | P2 | — | 中 |
| R19 | Office：Agent 读表格、PPT 页纲编辑与主题 | P2 | R11 | 中 |
| R20 | 邮件：附件、移除账户选项、错误分类 | P2 | R4 | 小 |
| R21 | macOS 系统日历只读接入与搜索语义统一 | P2 | — | 大（需 macOS） |
| R22 | 手机配对交互细节 | P3 | — | 小 |

**执行批次（2026-10-15 按用户方案纳入计划，R 系列尚未开工）**：
- 准备批次：复核 D3 工作区成果 → D4（CI）及 D6 核心检查接入 → 批次 A。D3 已有完成日志，不重复开发；`--model-check` 的 configured-only 合成配置需先对齐。
- 批次 A（对话核心）：R1 → R11（后台模型） → R5 → R2 → R3 → R4 → R6
- 批次 B（知识库与数据安全）：R7 → R9 → R10 → R8 → R11（搜索模式、Key 验证、错误分类、用量显示）
- 批次 C（采集与媒体）：R14 → R17 → R15 → R18 → R16
- 批次 D（扩展）：R12 → R13 → R19 → R20 → R21 → R22

R11 两段共用一个任务编号，只有两段均完成才将 R11 标为完成。R6 的删除入口与重命名修复归 R6；摘要入口归 R10，其旧 fast 选模问题先由 R11 后台模型部分修复。

依赖补充：R3 的完整验收包含 R2 的显式引用；R4 发信卡的 cc/bcc 等字段先写明并实现最小发送契约，R20 再补附件限额、失败列表和重试，禁止展示无法提交的可编辑字段。R21 在 Linux 可推进契约与平台隔离，EventKit、权限及签名验收必须留到 macOS。

D5 随每个任务同步契约与界面文档，批次收尾再统一核对；D6 新增断言随涉及任务进入 CI。D7 在 macOS 交付阶段处理，先核实当前包包含的修复，避免沿用过时的“尚未打包”记录。U1～U7 仍按真实配置、预算、设备等条件独立验收，不阻塞可离线完成的开发。Android N1 保持独立立项，R22 只改桌面配对交互。

每个任务及批次结束都更新 `PROGRESS.md` 和交接状态，并把新增检查纳入 smoke 或单测。CI 配置落盘与 GitHub 实际运行通过分开记录；未在 macOS 或真实账号环境运行的项目不得标为通过。

## 三、任务详情

### R1 对话消息渲染与回复操作（P0）

**目标**：助手回复按 Markdown 正确显示，可复制、可重新生成；推理模型的思考过程可见且可折叠。

**交互规格**
- 助手消息用与笔记预览相同的渲染管线（markdown-it + DOMPurify + KaTeX，代码块高亮，`[[双链]]` 可点击打开笔记，外链经现有外部导航守卫）。
- 流式输出期间按增量重渲染；渲染失败时回退为纯文本，不得白屏。
- 每条助手消息悬停显示操作条：复制（复制 Markdown 原文）、重新生成（仅最后一条可用）。
- 重新生成：如果上一轮产生了未回滚的保险箱变更，先提示“上一轮的笔记/文件变更不会自动撤销，可在保险箱中回滚”，确认后再执行。
- 思考过程：流式时在回复上方显示“思考中 · N 字”，结束后显示“已思考 · N 字”，默认折叠，点击展开。
- 回复进行中切换会话、关闭窗口或修改模型时，沿用已有的锁定逻辑并给出明确提示。

**契约变更**
- `StreamEvent` 增加 `{type:'reasoning'; delta:string}`。OpenAI 兼容实现解析 `delta.reasoning_content`；Anthropic 实现解析 `thinking_delta`。不支持的供应商不发此事件。
- 新事件 `chat.reasoning {chatId, delta}`。
- `messages` 表增量加列 `reasoning TEXT`。
- 新 action `chat.regenerate {chatId, selection}`：删除最后一条用户消息之后的助手与工具消息，再用同一用户文本重跑；会话运行中拒绝。

**涉及文件**：`src/main/providers/{types,openai-compat,anthropic}.ts`、`src/main/agent/loop.ts`、`src/main/syscalls/chat.ts`、`src/main/db/ddl.ts`、`src/renderer/src/components/ChatPanel.tsx`、`src/renderer/src/store/chat.ts`；把 `NoteDetailView` 中的渲染逻辑抽成 `src/renderer/src/markdown/render.ts` 共用。

**不做**：编辑历史用户消息、分支对话。

**验收**
- 单测：SSE 中 `reasoning_content` 与 `thinking_delta` 解析；重新生成只删除最后一轮；运行中重新生成被拒绝。
- 实机/截图：含表格、代码块、公式、双链的回复正确渲染（亮/暗两主题）；复制内容与原文一致。

### R11 后台任务模型、搜索模式与错误提示（P0/P1）

**目标**：摘要、会话命名、纪要等后台生成使用用户指定的模型，不再依赖旧的 fast/expert 角色；搜索与报错更易理解。

**交互规格**
- 设置 → 模型供应商 增加“后台任务模型”选择器（供应商 + 具体模型，选项来源与对话选择器相同，仅显示已勾选且就绪的模型），说明“用于生成摘要、会话标题、录音纪要等”。
- 未设置时，依赖它的功能按钮可点击但给出提示“请先在设置中选择后台任务模型”，**不得静默回退**到其他供应商或角色。
- 设置 → 搜索 增加搜索模式单选：
  - 普通：只用 DuckDuckGo；
  - 智能：先 DuckDuckGo，结果少于 3 条时再用已配置的 Brave/Tavily；
  - 高质量优先：先用 Brave/Tavily，无结果或未配置时回退 DuckDuckGo。
  - 选择后两种模式但没有任何 Key 时，提示并保持“普通”。
- Brave/Tavily Key 旁加“验证”按钮，只在用户点击时发起一次真实查询，显示“已连接”或失败原因。
- 模型请求失败按类别提示：认证失败（检查密钥）、限流/服务过载（“服务商繁忙，与密钥是否有效无关，请稍后重试或切换模型”）、网络不可达、上下文过长。
- 每条助手消息底部可选显示“模型调用 N 次 · 输入 X / 输出 Y tokens”（来自 `usage` 事件）。

**契约变更**
- 设置键 `ai.backgroundModel: {providerId, model} | null`、`search.mode: 'basic'|'smart'|'hq_first'`（默认 `basic`）。
- `llm.summarize` 与 `oneShot` 改为使用 `ai.backgroundModel`，删除对 `resolveModel('fast')` 的依赖（当前位于 `src/main/syscalls/llm.ts:12-13`）。
- 新 action `web.verify_key {engine:'brave'|'tavily'}`。
- `messages` 表增量加列 `usage TEXT`（JSON：`{calls,input,output}`）。

**验收**
- 单测：后台模型未设置时报明确错误；三种搜索模式的引擎顺序与回退；错误分类函数覆盖 401/403/429/5xx/网络/上下文过长。
- `--model-check` 增加后台模型路由检查（loopback，不发真实请求）。

### R5 Agent 笔记工具契约增强（P0）

**目标**：Agent 能可靠地局部修改长笔记、按条件检索、分段读取，并操作集合与状态。

**工具变更**（均经执行层校验，写操作经 rVault 快照）
1. `notes.update` 增加 `edits?: {oldText,newText}[]` 与 `append?: string`，与 `body` 三者互斥。
   - `edits` 按原文匹配（不是逐条累积匹配），每条 `oldText` 必须唯一且互不重叠；精确匹配失败时尝试按行去除首尾空白后匹配。
   - 错误信息指明第几条：未找到 / 出现多次 / 与第 j 条重叠。
   - `append` 自动补空行分隔，空字符串拒绝。
2. 创建与整体更新时，如果正文首行是与标题相同的一级标题，自动去掉。
3. **来源保护**：Agent 不得改写导入或转写类笔记的正文（`note_source` 不属于 `manual|text|journal|chat` 的笔记），只能改标题、状态、集合，或另建新笔记；错误提示说明原因。用户在界面中的编辑不受影响。
4. `notes.search`（Agent 工具）增加：`timeFrom/timeTo`（`YYYY-MM-DD`，左闭右开，按修改时间）、`types`、`sources`、`status{favorite,pinned,later}`、`collection`（集合标题）、`sort`（`modified|created|accessed|relevance`），`limit` 默认 20、上限 100。返回 `{total, showing, items:[{noteId,title,noteType,noteSource,preview,created,modified,collections,status}]}`，时间为带时区偏移的 ISO 字符串。
5. `notes.get`（Agent 工具）增加 `offset/limit`（按行，`offset` 从 1 开始，负数表示从末尾），返回 `totalLines`。
6. 新增 Agent 工具：`notes.set_status`（返回实际变化的字段 `applied`）、`collections.add_note`（按标题不存在则创建，返回 `createdCollection`）、`collections.remove_note`、`notes.attach_image`（仅工作区内文件）、`file.read_document {path}`（仅工作区内，复用导入器把 PDF/DOCX/PPTX/XLSX 转为 Markdown，按文件修改时间缓存到 `.whywork/tmp/`）。
7. 工具描述同步更新到 `prompts.ts`，并写明“局部修改优先用 edits，追加日志优先用 append”。

**涉及文件**：`src/main/agent/{tools,prompts,vault}.ts`、`src/main/syscalls/notes.ts`、`src/main/db/repos/notes.ts`、`src/main/services/importer.ts`。

**验收**：单测覆盖 edits 的唯一/重叠/模糊匹配/找不到，append、互斥校验、H1 去重、来源保护、检索各过滤条件与上限、分段读取、集合自动创建与 vault 记录；`--core-check` 增加一条合成 Agent 局部编辑并回滚的链路。

### R2 输入框：@ 引用笔记、/ 技能、附件（P0）

**目标**：用户能明确指定本轮要用的笔记、技能和文件。

**交互规格**
- 占位文字改为“直接提问，或输入 @ 引用笔记、/ 使用技能”。
- 输入 `@`（非输入法组合状态）弹出笔记搜索浮层：实时检索标题，最多 8 条，方向键选择、回车确认、Esc 关闭。选中后在输入框上方显示笔记标签，正文中的 `@关键词` 被移除。
- 输入 `/` 且位于行首时弹出已启用技能列表，选中后显示技能标签；每轮最多 3 个。
- 输入框左下角“添加”按钮：
  - 选择本地文件：经现有导入器导入知识库，显示进度，完成后作为笔记标签；
  - 添加网页：输入 URL，经 `clip.save_url` 保存为笔记后作为标签（受黑名单约束）。
  - 界面说明“附件会保存到知识库”。
- 标签可单独移除，也可“全部移除”；超过 10 个笔记标签时禁止继续添加并提示。
- 发出后，用户消息气泡下方显示本轮引用的标签，点击打开笔记。

**契约变更**
- `chat.send` 增加 `refs?: {noteIds?: string[] (≤10), skills?: string[] (≤3)}`。
- Agent 上下文：被引用笔记的正文按单篇 ≤8000 字、合计 ≤24000 字注入，截断时注明；被选技能的 SKILL.md 本轮强制注入。被引用笔记自动登记为 R3 的引用来源。
- `messages` 表增量加列 `refs TEXT`。
- 新 action `app.pick_files {filters?}`（原生多选对话框，仅用户操作触发）。

**取舍说明**：remio 附加文件时会同步其所在文件夹，WhyWork 只导入所选文件。是否改为“临时上下文、不入库”，需用户确认；在确认前按“导入知识库”实现。

**验收**：单测覆盖 refs 上限、上下文预算与截断、技能注入；实机验证中文输入法下输入 `@`、`/` 不误触发，标签增删、导入进度、网页黑名单拦截。

### R3 知识库问答引用来源（P0）

**目标**：回答中能看到依据的笔记，点击可回到原文。

**交互规格**
- 回答正文中的 `[n]` 渲染为上标角标；悬停显示笔记标题与命中片段；点击打开笔记并在详情页高亮片段所在段落。
- 回答末尾显示“来源”列表（序号、标题）。
- 操作条增加“复制（带引用）”：正文后附“来源：[1] 标题……”。
- 输入框下方增加“引用知识库”开关，默认开启；关闭时本轮不提供笔记检索类工具（`@` 引用仍然有效）。

**实现规格**
- Agent 循环为本轮维护来源登记表：`notes.search/notes.get/notes.list` 和 R2 引用的笔记依次编号；工具结果文本以“[来源 n] 标题”开头。
- 系统提示词要求：只对登记过的来源用 `[n]` 标注，不得编造编号；没有依据时直接说明。
- 回合结束发送 `chat.sources {chatId, msgId, sources:[{n,noteId,title,snippet}]}`；`messages` 表增量加列 `sources TEXT`。渲染层丢弃没有登记的编号。
- `chat.send` 增加 `useKnowledge?: boolean`，默认 `true`。

**限制**：WhyWork 没有语义检索，引用只精确到“笔记 + 命中片段”，不承诺逐句对应。

**验收**：单测覆盖来源登记、编号解析（忽略代码块中的 `[n]`、丢弃未登记编号）；FakeProvider 集成测试验证 `chat.sources` 事件与持久化；`--run-cases` 的 RAG 用例在有真实凭据时增加“回答至少含一个有效来源”检查（无凭据仍为 BLOCKED）。

### R4 对话流内确认卡（P0）

**目标**：需要用户确认的操作以可读卡片出现在对话中，替代弹窗与原始 JSON。

**交互规格**
- 确认卡插入在当前回复的位置，标题说明动作（如“发送邮件”“删除笔记”“写入文件”“调用 MCP 工具”“在网页中执行脚本”），正文为可读摘要，底部“允许 / 拒绝”。
- 决定后卡片变为只读状态“已允许 / 已拒绝”；点击停止或会话被取消时显示“已取消”。
- 发信卡：显示发件账户（仅一个账户时不显示选择器）、收件人、抄送、密送、主题、正文、附件；收件人/主题/正文可直接修改，允许时按修改后的内容发送。
- 文件写入卡显示路径与新内容前若干行；删除卡显示目标及“可在保险箱中回滚”；批量写入卡显示条数和前 5 项。
- 同时只允许一张待确认卡；回复进行中用户输入新消息时提示先处理确认卡。
- “工作工具 → 邮件”的发送也改用同一个发信预览组件。

**契约变更**
- `chat.confirm` 事件增加 `preview: {kind:'mail'|'file_write'|'file_delete'|'note_delete'|'mcp'|'browser_eval'|'bulk', title, fields:[{label,value}], body?, warnings?:string[]}`，由主进程按工具类型生成。
- `chat.confirm` action 增加 `override?: object`；主进程按原工具 schema 重新校验，只允许覆盖该卡片声明为可编辑的字段（发信卡：`to/cc/bcc/subject/text/accountId`）。

**涉及文件**：`src/main/agent/{confirmation,loop,tools}.ts`、`src/main/syscalls/chat.ts`、`ChatPanel.tsx`、`ToolsView.tsx`，新增 `src/renderer/src/components/ConfirmCard.tsx`、`MailPreview.tsx`。

**验收**：单测覆盖 preview 生成、override 白名单与重新校验、取消后撤销待确认请求；截图包含各类卡片的待确认与已决状态。

### R6 会话管理（P0）

**交互规格**
- 修复：删除会话的入口目前点不到（`ChatPanel.tsx:281-285` 的 Popconfirm 包着空元素），移除该死代码。
- 侧栏“最近对话”每行悬停显示“…”菜单：重命名（行内输入，回车保存、Esc 取消）、删除（确认；会话运行中禁止删除并提示）。
- 侧栏列表上方加搜索框，按标题过滤；超过 20 条时显示“查看全部”，进入完整列表。
- AI 命名：首轮回复完成后，如果标题仍是自动截取的文本，用后台任务模型生成不超过 16 字的标题；失败时静默保留原标题。设置中可关闭。

**契约变更**：`chat.list` 增加 `query?`、`limit/offset`；设置键 `chat.autoTitle`（默认 `true`）。

**验收**：单测覆盖运行中删除被拒、自动命名只改自动标题；实机验证重命名与删除。

### R7 rVault 保险箱面板升级（P1）

**交互规格**
- 对话标题栏的保险箱按钮显示本会话未回滚条目数（为 0 时不显示数字），提示文字“保险箱：自动备份本次对话中 Agent 修改、创建、删除的资料，可一键还原”。
- 抽屉按“笔记 / 文件 / 集合关系”分组；动作显示为中文“新建 / 修改 / 删除 / 重命名”，重命名显示原路径；笔记显示标题而不是路径。
- 回滚后弹出结果摘要：已恢复 N 项、已跳过 N 项（及原因）、剩余 N 项；新建的文件说明“已移到系统废纸篓”。
- 回滚一个新建目录且目录中还有其他文件时，先列出这些文件并二次确认。

**契约变更**
- `vault.list` 返回补充 `type`（`note|file|dir|note-collection`）、`noteTitle`、`originalPath`。
- `vault.rollback` 返回 `{restored:[], skipped:[{changeId,reason}], remaining, needsConfirm?:{changeId,nestedItems}}`，保留原 `rolledBack` 字段兼容；增加 `confirm?: boolean`。
- 新建文件的回滚改用 `shell.trashItem`，不再直接删除。
- 新事件或复用 `vault.changed` 携带 `{chatId, activeCount}`。
- 维持 DEVELOPMENT §7.5：回滚不暴露给 Agent。

**验收**：单测覆盖分组字段、跳过原因、新建目录需确认、移到废纸篓（测试中用替身）；截图包含徽标与结果摘要。

### R8 个性化与记忆设置（P1）

**交互规格**：设置新增“个性化与记忆”分组：
- 称呼、身份/角色、自定义指令（≤2000 字）、回复语言（跟随提问 / 简体中文 / English / 繁體中文 / 日本語，可扩展）。
- 记忆模式：高质量（会话静默或切换会话时都整理记忆，切换时只在有未整理内容时触发）/ 节省（只在会话静默后整理）/ 关闭。
- “查看长期记忆”“查看今日日志”在编辑器中打开对应文件；“清空长期记忆”需二次确认。

**契约变更**
- 设置键：`profile.nickname`、`profile.role`、`profile.instructions`、`ai.responseLanguage`、`memory.mode: 'quality'|'economy'|'off'`。
- `prompts.ts` 注入档案与回复语言；回复语言不得写入记忆文件。
- 记忆整理提示词补充两条规则：不记录可随时查询的运行时状态（路径、版本、配置、笔记正文、搜索结果）；把技能相关条目迁移到技能记忆时，先确认目标写入成功再删除源条目。

**验收**：单测覆盖提示词注入、`off` 模式不触发整理、`quality` 模式在切换会话时触发。

### R9 知识库列表（P1）

**交互规格**
- 工具条：排序（最近修改 / 创建时间 / 最近打开 / 标题）、类型筛选（笔记、网页、文档、邮件、录音与转写、图片，多选）、修改时间范围。筛选与搜索可组合，状态保留在当前视图。
- 多选：工具条“选择”进入多选模式，每行显示复选框，顶部显示“已选 N 项”和批量操作：收藏、加入稍后、加入集合…、移入回收站（一次确认）、取消选择。回收站视图中批量操作为“恢复”。
- 每行“更多”菜单：加入集合…、加入/移出稍后、复制标题、在 Finder 中显示、导出 PDF。
- “加入集合”选择器顶部列出最近使用的 5 个集合，支持输入新名称直接创建。不做 AI 推荐集合。
- “按来源分组”开关：按 `note_source` 分组显示组标题与数量。

**契约变更**：`notes.list` 的 `filter` 增加 `sources?: string[]`、`modifiedFrom?/modifiedTo?`；新 action `notes.batch_set_status {noteIds (≤500), favorite?, pinned?, later?}`、`notes.batch_delete {noteIds}`、`notes.batch_restore {noteIds}`、`collections.batch_add {noteIds, collectionId|collectionTitle}`，均单事务执行并返回成功与失败列表。

**验收**：单测覆盖批量事务的部分失败、筛选组合的 SQL 正确性与分页；截图包含多选状态。

### R10 笔记详情：AI 摘要、批量处理、相关笔记（P1）

**交互规格**
- 详情页标题区显示摘要、关键词、主题；没有时显示“生成摘要”按钮，有时显示“重新生成”。生成中显示进度，可取消。
- “未处理”视图顶部显示“批量处理（N 条）”：逐条串行执行，显示进度与当前标题，可取消；失败的跳过并在结束时汇总。
- 详情页侧栏增加“相关笔记”：以关键词（没有关键词时用标题分词）做 FTS 检索，排除自身，最多 5 条，注明“基于关键词匹配”；加载时显示“正在查找相关笔记”。

**契约变更**：`llm.summarize` 使用后台任务模型（依赖 R11），成功后写 `processed=1`；新 action `notes.related {noteId, limit≤10}`、`llm.summarize_batch_start {filter}` / `llm.summarize_batch_cancel {batchId}`，进度事件 `summarize.progress`。

**验收**：单测覆盖 processed 回写、批量取消、相关笔记排除自身与已删除；实机验证未设置后台模型时的提示。

### R14 目录同步（P1）

**交互规格**
- 添加目录时校验：与已登记目录相同则提示“已在同步”；是某个已登记目录的子目录则提示“已被上级目录 X 覆盖”；是已登记目录的上级时，确认后合并并移除子目录登记；拒绝工作区自身、用户主目录根和系统目录。
- 状态改为结构化并显示中文：扫描中、导入中、监控中、已暂停、出错；附带已导入数、失败数、最近扫描时间。
- 首次进入时显示推荐目录（下载、文稿、桌面，存在才显示）一键添加。
- 权限错误（EACCES/EPERM）提示“请在系统设置 → 隐私与安全性中授予 WhyWork 访问该目录的权限，然后重新扫描”。

**契约变更**：`watch_folders` 增量加列 `state TEXT`、`imported INTEGER`、`failed INTEGER`、`last_scan_at INTEGER`；保留旧 `status` 文本列作为兼容显示；`watch.folders_add` 返回 `{id}` 或可识别的冲突错误码；新 action `watch.suggested_folders`。

**验收**：单测覆盖相同、子目录、上级目录合并、符号链接 realpath 判定、拒绝目录。

### R17 录音与转写（P1）

**交互规格**
- 开始录音前选择语言（中文 / English / 自动），默认取设置“默认转写语言”，并记住上次选择。
- 录音中显示“要点”输入框，可随时记录，内容与录音一起保存。
- 保存后，如果已配置 ASR，在录音卡片内提示“是否转写这段录音？（另有 N 条待转写）”，按钮为“转写”“稍后”。
- 转写完成后生成三条相互链接的笔记：录音（音频与要点）、转写稿、纪要（概览、决定、待办，由后台任务模型结合要点与词典生成）。转写稿先出现，纪要随后补上。
- 设置 → 媒体 增加“专有名词词典”（每行一个词），用于 ASR 的提示参数（端点支持时）和纪要生成时的纠错。
- 单段接近 50MB 上限时自动保存当前段并继续录制下一段，提示“已自动保存第 N 段”；不足 1 秒的录音提示过短，不保存。
- 纪要模板：内置“通用会议 / 访谈 / 讲座”三种，生成纪要前可选，默认通用会议；纪要可“重新生成”。
- 纪要生成为流式输出，可取消；失败可重试，不影响已保存的录音与转写稿。
- 说话人识别、声纹、录音中实时转写预览不做（后者需要流式 ASR）。

**契约变更**：设置键 `media.transcriptionLanguage`、`media.dictionary`；`media.save_recording` 增加 `keyPoints?`、`segmentOf?`、`segmentIndex?`；新 action `media.pending_transcriptions`、`media.generate_minutes {recordingNoteId}`；转写稿 `note_source=meeting_transcript`，纪要 `note_source=meeting_overview`，三者通过 `links` 表互相关联。

**验收**：单测覆盖分段保存与幂等、待转写计数、三条笔记的关联、词典进入请求参数；`--ui-check` 合成音源走完“录音 → 保存 → 转写提示”的界面路径（不调用真实 ASR）。

### R12 MCP（P2）

- **工具发现三段式**：已启用 MCP 工具总数超过 40 时（设置键 `mcp.directToolLimit` 可调），不再把全部工具注入模型，改为三个元工具：`mcp.search_tools {query, serverIds?, limit≤20}`（排序：工具名完全匹配 > 名称包含 > 仅描述包含；返回不含 schema 的预览；某服务器失败放进 `errors` 而不影响其他结果）→ `mcp.list_tools {serverId, toolName?, limit, offset}`（返回完整 inputSchema）→ `mcp.call {serverId, toolName, arguments}`（仍需确认卡）。系统提示词只列服务器名称与描述。
- **HTTP 传输**：`mcp.servers_save` 增加 `transport:'stdio'|'http'`、`url`、`token`（safeStorage 加密）、`tokenHeader`（默认 `Authorization`）；使用 SDK 的 Streamable HTTP 传输。设置页“测试连接”返回工具数或分类错误（地址不可达 / 认证失败 / 协议不兼容）。
- 不做：内置连接器目录、MCP OAuth。
- 验收：单测覆盖排序、失败隔离、阈值切换；本地合成 HTTP MCP 服务器的连通检查。

### R13 技能库界面（P2）

- 设置 → 技能：列表（名称、来源工作区/全局、描述、开关）、搜索、详情抽屉渲染 SKILL.md、“从文件夹添加”（校验 frontmatter 的 name/description 后复制到工作区技能目录，重名拒绝）、“移除”（移到系统废纸篓，确认文案说明可重新添加）、刷新。
- 不做：技能市场与联网安装。
- 验收：单测覆盖 frontmatter 校验与重名；截图包含列表与详情。

### R15 全局快捷键（P2）

- 设置 → 快捷键：“唤起对话”“快速新建笔记”两项，点击后录制组合键。
- 校验：必须包含 ⌘/⌃/⌥ 之一；两项不能相同；注册失败提示“已被其他应用占用”；常见系统组合（⌘Q、⌘W、⌘Tab、⌘Space 等）给出冲突警告；可恢复默认。
- 设置键 `shortcuts.focusChat`、`shortcuts.newNote`；修改后立即注销旧组合并注册新组合，失败则回滚到旧值。
- 验收：单测覆盖校验函数；实机在 macOS 验证（Linux 只验证设置与校验）。

### R16 在线音视频链接（P2，对应 §6.3 `web.get_media`）

- “采集”页新增“在线音视频”：可粘贴 1～10 个链接，列表显示每个任务的状态（等待、解析、下载、转写、生成纪要、完成、失败），可取消、可重试。
- 优先获取平台字幕；没有字幕再下载音频走用户配置的 ASR。
- 链接指向合集或播放列表时只处理所指的那一集（无法确定时处理最新一集），并提示“这是合集《X》，共 N 集，本次只处理了一集”。
- 产出：主笔记（来源链接、元数据）+ 转写稿 + 概览（后台任务模型）。取消时保留已创建的主笔记。
- **需要用户决策**：下载器（如 yt-dlp）是内置还是由用户在设置中指定路径。决策前按“用户指定路径”实现，未配置时给出说明。
- 新表 `media_jobs`，新 action `media.add_urls`、`media.jobs`、`media.cancel_job`、`media.retry_job`，事件 `media.job`。所有网络请求只在用户提交链接后发起。

### R18 图片 OCR 进入检索（P2）

- 导入或附加到笔记的图片在后台排队做本地 OCR（并发 1，可在设置中关闭），结果存 `resource_ocr(resource_id, text, items, engine, created_at)`。
- FTS 索引正文时追加该笔记图片的 OCR 文本；搜索命中来自图片时片段注明“图片文字”。
- Agent 的 `notes.get` 返回 `images:[{resourceId, ocrText}]`。
- 导入的 PDF 如果几乎没有文本层（扫描件），加入同一后台队列逐页 OCR，结果追加到该笔记索引；进度可在笔记详情查看。
- 验收：合成图片 OCR → 搜索命中 → 删除图片后索引移除；合成扫描版 PDF 入队并可检索。

### R19 Office（P2）

- Agent 工具：`office.xlsx_summary {path}`（工作表名、行列数、表头样例）、`office.xlsx_read {path, sheets, offset, limit}`（多个工作表共享 2 万字符预算，截断时返回剩余行数和续读 offset）。路径限工作区内。
- PPT：“AI 生成 PPT”先生成可编辑页纲（每页标题 + 要点），用户修改、增删、调整顺序后再生成；提供 3～4 个主题预设（配色与字体，中文字体有回退）。
- 不做：逐页编辑、截图预览、图表、复杂版式。
- 验收：单测覆盖分页与预算；合成页纲生成 PPTX 并用 JSZip 校验主题色写入。

### R20 邮件（P2）

- `mail.send`（Agent 与界面）增加 `cc`、`bcc`、`attachments:[{path}]`（工作区内文件），单个 ≤20MB、合计 ≤25MB。
- 移除账户时让用户选择“保留已导入的邮件笔记”或“一并移入回收站”。
- 失败分类提示：认证失败（提示更新应用专用密码）、无法连接服务器、TLS 错误、发件被拒。
- 发送失败的邮件保留在“发送失败”列表，可查看原因并手动重试；不自动重发，重试同样经过确认。
- 验收：单测覆盖附件限额与路径守卫、移除账户两种选项、失败记录与手动重试。

### R21 macOS 系统日历（P2，需 macOS）

- 新增 Swift 辅助程序（参照分享扩展的构建与签名方式），通过 EventKit 只读获取事件，以 JSON 输出给主进程。
- 只在用户点击“连接系统日历”时请求权限；显示已授权、未授权（引导到系统设置）、受限三种状态。
- 统一 `calendar.search` 语义：`query`、`start/end`（`YYYY-MM-DD`，左闭右开）、`calendarIds`、`sort:'startTime'|'relevance'`（有 query 时默认 relevance）、`limit` 默认 20、上限 100；省略时间范围时为当前时间前后各一年（ICS 原有的“过去 30 日”同步调整并记入契约）。结果标注来源（系统日历 / ICS）。
- 不做：创建、修改、删除事件。
- Linux 下隐藏入口。验收只能在 macOS 实机完成，属于 P0 用户条件类验收项。

### R22 手机配对（P3）

- 二维码显示倒计时，过期后覆盖“二维码已过期”和“刷新”按钮；配对成功推送 `pair.bound` 事件并提示“已绑定 设备名”；解绑需确认。
- Android 端仍按 TASKS-HANDOFF N1 独立立项。

## 四、默认决策（已按用户要求纳入本次开发计划）

当前采用以下五项默认方案，不将其作为开工前的确认阻塞。用户后续调整时同步修改契约与验收；采用默认方案不代表对应功能已经实现。

| 编号 | 问题 | 默认实现 |
|---|---|---|
| Q1 | 对话附件导入知识库，还是只作临时上下文 | 导入知识库（R2） |
| Q2 | 在线音视频下载器内置还是由用户指定 | 用户指定路径（R16） |
| Q3 | 引用只到“笔记 + 片段”是否可接受 | 可接受，不做语义检索（R3） |
| Q4 | Agent 不得改写导入/转写类笔记正文 | 启用该保护（R5） |
| Q5 | 系统日历桥接采用 Swift 辅助程序 | 采用（R21） |

## 五、文档同步清单

每完成一个任务，同步以下位置：
- `DEVELOPMENT.md`：§6（新增或修改的 action）、§7（Agent 循环、工具、提示词、记忆规则）、§5.2（新增表与列）、§10（界面规范）。
- `PROGRESS.md`：会话日志与 changelog（版本号顺延 v1.6 起）。
- `TASKS-HANDOFF.md`：在“二、任务清单”中加入 R 系列及状态。
- 测试台账：新增的自动检查纳入 `--smoke-test` 或单测；界面状态纳入 `check:ui` 截图。
