# REMIO-R 验收测试计划

> 生成：2026-10-15。对象：`docs/CODEX-TASKS-REMIO.md` 的 R1～R22 开发任务。依据：任务书契约与交互规格、`docs/REMIO-COMPARISON.md` 中的 remio 行为证据。
> 用例清单的唯一来源是 `tests/acceptance/remio-r/cases.json`；本文第七、八节由它生成，修改用例请改 JSON 后重新生成。

## 一、目的与范围

在 Codex 完成 R 系列开发后，独立验证“交互方式与功能特点”是否按任务书落地。本测试集与现有测试互补，不替代它们：

| 现有测试 | 关注点 | 与本测试集的关系 |
|---|---|---|
| `npm test`（vitest 单测） | 内部函数 | 由开发者编写；本测试集不依赖任何内部函数 |
| `--smoke-test` / `--core-check` | 核心链路与打包 | 仍是每个任务的完成门槛（RT-X-04） |
| `--run-cases`（72 项） | remio 3.21.4 基础功能覆盖 | 不重复；R 系列只覆盖新增与改写部分 |
| `npm run check:ui` | 视图截图与主题 | 本测试集的界面用例只验证交互，不做视觉对比 |

共 158 条用例：114 条接口黑盒（AUTO-API）、33 条界面黑盒（AUTO-UI）、7 条人工（MANUAL）、4 条真实服务（REAL）。

## 二、测试方法

- **黑盒**：只通过 `window.whywork.sys` 调用接口、通过界面文案操作窗口，并核对伪造服务收到的请求。不 import 产品源码，因此 Codex 的内部重构不会影响用例。
- **隔离**：使用产品自带的 `--ui-check` 隔离实例（独立 userData 与临时工作区）。执行器还会：
  - 把 `HOME` 指向临时沙箱，涉及“主目录”“推荐目录”的用例不会接触真实用户目录；
  - 从 `out/` 的快照启动，运行期间其他 agent 重新构建不会影响结果；若快照被改动则中止，报告注明无效；
  - 默认让原生“打开文件”对话框直接返回取消，需要选文件的用例临时替换为合成文件；
  - 结束后删除隔离目录、沙箱、快照与临时文件。
- **无外部网络**：模型、ASR、MCP 全部指向本机伪造服务；RT-X-02 核对所有请求都发往 `127.0.0.1`。
- **合成数据**：`tests/fixtures/remio-r/`，由 `generate.cjs` 确定性生成并带 SHA-256 清单；`oracle/` 只供执行器读取，不得导入或监控。
- **密钥存储**：Linux 无桌面密钥库时 `safeStorage` 不可用，执行器在隔离实例内换上可逆的测试替身，报告中标注 `secretStoreStub: true`。真实加密由 macOS 上的 `--core-check` 另行验证。

### 伪造服务

| 组件 | 文件 | 说明 |
|---|---|---|
| 模型服务 | `fake-llm.cjs` | OpenAI 兼容流式（含 `reasoning_content`、工具调用、`usage`、错误码）、Anthropic 流式（含 `thinking_delta`）、`/audio/transcriptions`。用户消息中的 `⟦SCN:名称⟧` 选择执行器注册的脚本；模型 `bg-model` 代表后台任务模型，按摘要/标题/纪要/记忆任务返回可解析的内容 |
| MCP 服务 | `mcp-fixtures.cjs` | Streamable HTTP（3 个工具，token 认证）、stdio（45 个工具，用于阈值与搜索排序）、启动即退出的 stdio（失败隔离） |

Agent 工具在请求中的名称为把 `.` 换成 `__`（如 `notes__search`），伪造模型据此下发工具调用。

## 三、状态与通过标准

| 状态 | 含义 |
|---|---|
| PASS | 全部期望满足 |
| FAIL | 任一期望不满足 |
| NOT_IMPLEMENTED | 接口返回 `UNKNOWN_ACTION`、契约字段不被接受，或任务书规定的界面元素不存在。计为失败 |
| BLOCKED | 缺少平台或前置条件（非 macOS、需真实账号）。不计为通过 |
| MANUAL | 执行器只登记，需人工补结论 |

执行器退出码：`0` 全部自动用例通过；`1` 存在 FAIL 或 NOT_IMPLEMENTED；`2` 执行器或环境错误；`3` 运行期间构建快照被改动，结果无效。

**R 系列验收通过的条件**：
1. Linux 上全部 AUTO-API、AUTO-UI 用例为 PASS（`env=mac` 的为 BLOCKED 属正常）。
2. macOS 上再跑一次，`env=mac` 的自动用例 PASS，且报告中 `secretStoreStub` 为 `false`。
3. 第八节的 MANUAL 用例逐条执行并记录截图与结论。
4. REAL 用例按 `TASKS-HANDOFF.md` 的 U 系列条件（真实账号、预算、设备）另行执行；未执行时保持 BLOCKED，不得记为通过。
5. RT-X-04 工程门槛全绿。

## 四、运行方法

```bash
npm run build                                          # 先构建；执行器从 out/ 的快照启动
node tests/fixtures/remio-r/generate.cjs --verify      # 校验 fixtures（执行器也会自动校验）
xvfb-run -a node tests/acceptance/remio-r/run.cjs      # Linux 无显示器；macOS 去掉 xvfb-run -a
node tests/acceptance/remio-r/run.cjs --only=R1,R5     # 只跑指定任务
node tests/acceptance/remio-r/run.cjs --ids=RT-R3-01   # 只跑指定用例
node tests/acceptance/remio-r/run.cjs --level=AUTO-API # 只跑某一级别
node tests/acceptance/remio-r/run.cjs --list           # 打印清单
```

报告输出到 `release/verification/remio-r/<时间>/`：`report.json`（含构建文件哈希、逐条结果、伪造服务请求数、页面错误）、`summary.md`、失败用例截图。全量运行约 20～30 分钟（OCR 用例会等待后台队列）。

`--only` 与 `--ids` 同时给出时取交集。fixtures 需要更新时运行 `node tests/fixtures/remio-r/generate.cjs`，它会重写 `manifest.json`。

本测试集不在默认 `npm test` 中，不会影响 Codex 开发过程中的门槛；建议在 D4 的 CI 中增加一个可手动触发的任务运行它。

## 五、执行器约定的接口名

任务书没有规定以下名称或取值。执行器按下表调用，均已与 Codex 当前代码核对一致（2026-10-15）。若之后改名，请同时更新 `DEVELOPMENT.md` 与 `cases-impl.cjs` 中对应的调用。

| 用途 | 执行器调用 |
|---|---|
| 上级目录合并确认 | `watch.folders_add {dir, confirmMerge:true}`；未确认时返回 `{needsConfirm}` |
| 推荐目录 | `watch.suggested_folders` |
| MCP 测试连接 | `mcp.test_connection {serverId}` → `{toolCount}` |
| MCP 工具分页 | `mcp.list_tools {serverId, toolName?, limit, offset}` → `{tools,total}`；工具名带服务器前缀与稳定后缀，比对 `originalName` |
| 技能添加/移除 | `skills.add {dir}`、`skills.remove {name, confirmed:true}` |
| 回复语言取值 | 显示名（`English` 等）；执行器先试 `en-US` 再试显示名 |
| 确认卡覆盖字段 | `chat.confirm {id, chatId, approved, override}` |
| 修改时间筛选 | `notes.list.filter.modifiedFrom/modifiedTo`（毫秒时间戳） |
| 回滚确认 | `vault.rollback {chatId, all:true, confirm:true}` |
| 发信失败列表/重试 | `mail.failed_list`、`mail.retry {id, confirmed}`（未确认时报错） |
| 表格概览/读取 | `office.xlsx_summary {path}` → `sheets[{name,rows,columns,headers}]`；`office.xlsx_read {path, sheets(序号或名称), offset(从 1 起), limit}` → 顶层 `nextOffset`、`remainingRows` |
| PPT 主题 | `office.slide_themes`；`office.slides {outline, themeId: blue\|forest\|ink}` → `{path}` |
| 在线音视频 | `media.add_urls {urls}`、`media.jobs`；下载器路径设置键 `media.downloaderPath` |
| 待转写/纪要 | `media.pending_transcriptions`、`media.generate_minutes {recordingNoteId}` |

## 六、试跑记录（2026-10-15，对开发中的构建）

执行器在 Codex 开发过程中对当时的构建做过全量试跑，用来验证执行器本身。**结论不代表 R 系列的验收结果**，开发完成后须重新全量运行。

最近一次全量（构建快照 19:32）：通过 125，失败 16，未实现 6，人工 7，阻塞 4；运行期间构建无变化、无页面错误、无非本机请求。之后已把执行器与 Codex 实际确定的接口名对齐，相关用例单独复跑通过。

截至该快照，已确认属于产品侧（不是执行器问题）的未通过项：

| 用例 | 现象 | 对应规格 |
|---|---|---|
| RT-R2-06 | `@` 浮层按全文检索，输入“@北辰”时第一项是正文提到北辰的“南岭计划” | R2“实时检索标题” |
| RT-R4-01 | 删除笔记确认卡只显示笔记 ID，不显示标题 | R4“删除卡显示目标” |
| RT-R7-02/03/06 | 重复回滚没有跳过原因；新建目录回滚不要求确认；保险箱按钮无数量徽标 | R7（快照时尚未完成） |
| RT-R17-02 | 录音分段只记在内部表，第 2 段笔记看不到与第 1 段的关联 | R17“分段关联” |
| RT-R18-01 | 图片 OCR 已可检索，但命中片段未注明“图片文字” | R18 |
| RT-R18-03 | 扫描版 PDF 在 100 秒内未进入检索 | R18 扫描 PDF |
| RT-R19-04/05、RT-R20-02/03 | 快照中尚无 `office.slide_themes`、页纲编辑界面、`mail.failed_list`（源码随后已加入，待新构建复跑） | R19、R20 |
| （观察，无独立用例） | 用户消息气泡下的引用标签显示笔记 ID 前 8 位，而不是标题 | R2“显示本轮引用的标签” |

早先试跑发现、在 19:32 快照中已修复的：`file.read_document` 读 xlsx 报 `ExcelJS.Workbook is not a constructor`（RT-R5-20）、检索时间为 UTC `Z` 格式（RT-R5-14）、Agent 集合变更未进保险箱（RT-R5-18）。

试跑中曾出现一次全屏空白，原因是测试期间 `out/` 被重新构建，已加载页面引用的分块文件被替换。执行器现已改为从快照启动。另有一次因为早期构建没有拒绝把 `/` 和用户主目录登记为同步目录，触发全盘扫描导致窗口崩溃；执行器现已改为沙箱 HOME，并且不再向产品传入 `/`。

## 七、人工与真实服务用例

见下表（由 `cases.json` 生成）。执行时在报告 `report.json` 对应条目补写结论、截图路径与执行人，或单独记录到 `docs/VISUAL-ACCEPTANCE.md`。

| ID | 级别 | 平台 | 标题 | 步骤 | 期望 |
|---|---|---|---|---|---|
| RT-R11-12 | REAL | any | 三种搜索模式的真实引擎顺序与回退 | 1. 配置真实 Brave 或 Tavily Key<br>2. 分别在 basic/smart/hq_first 下执行 web.search | 1. 引擎顺序与回退符合任务书 R11 |
| RT-R2-09 | MANUAL | mac | 中文输入法下 @ 与 / 不误触发 | 1. 用系统拼音输入法输入含 @ 和 / 的中文句子<br>2. 确认上屏前后的浮层行为 | 1. 组合输入期间不弹浮层，上屏后符合 RT-R2-06/07 |
| RT-R3-08 | REAL | any | 真实模型引用问答 | 1. 按 U1 条件配置真实模型<br>2. 依次提问 oracle citation CQ01～CQ04 | 1. CQ01～CQ03 答案正确且来源指向期望文件<br>2. CQ04 说明无数据，不编造编号 |
| RT-R17-08 | MANUAL | mac | 实机麦克风长录音自动分段 | 1. 在 macOS 实机录制直到接近单段上限 | 1. 提示已自动保存第 1 段并继续录制 |
| RT-R15-03 | MANUAL | mac | 全局快捷键实机生效与占用回滚 | 1. 在 macOS 安装包中修改组合并在其他应用前台触发<br>2. 设置为已被其他应用占用的组合 | 1. 新组合唤起 WhyWork<br>2. 占用时提示并回滚旧值 |
| RT-R16-03 | REAL | any | 公开视频：字幕优先、产出三条笔记、合集提示、取消保留主笔记 | 1. 配置真实下载器与 ASR<br>2. 提交 1 个带字幕视频、1 个合集链接，并在处理中取消一个 | 1. 状态依次推进<br>2. 合集只处理一集并提示集数<br>3. 取消后主笔记保留 |
| RT-R20-04 | REAL | any | 移除账户两种选项与真实收发 | 1. 按 U4 条件使用专用测试邮箱同步后移除（分别选保留/移入回收站）<br>2. 发送带附件邮件 | 1. 笔记处理符合所选项<br>2. 收件方收到附件 |
| RT-R21-03 | MANUAL | mac | 系统日历授权三态与只读读取 | 1. 未授权时点击连接 → 拒绝 → 到系统设置授权后重试<br>2. 检索系统日历中的测试事件 | 1. 三种状态提示正确<br>2. 结果标注来源为系统日历，界面无创建/修改入口 |
| RT-R22-02 | MANUAL | any | 过期、绑定成功与解绑确认 | 1. 等待二维码过期后刷新<br>2. 用测试客户端完成配对后解绑 | 1. 过期覆盖层与刷新可用<br>2. 绑定成功提示设备名<br>3. 解绑需确认 |
| RT-X-03 | MANUAL | any | 旧工作区升级 | 1. 复制 2ba2a71 基线版本创建的工作区<br>2. 用新版本打开两次 | 1. 增量迁移成功且可重复，旧笔记、会话、模型选择完整 |
| RT-X-04 | MANUAL | any | 工程门槛 | 1. npm run typecheck && npm test && npm run build && electron out/main/index.js --smoke-test && npm run check:ui | 1. 全部通过 |

## 八、完整用例目录

| 任务 | 用例数 | 级别分布 |
|---|---|---|
| R1 | 10 | AUTO-UI 6，AUTO-API 4 |
| R11 | 12 | AUTO-API 11，REAL 1 |
| R5 | 21 | AUTO-API 21 |
| R2 | 10 | AUTO-API 5，AUTO-UI 4，MANUAL 1 |
| R3 | 8 | AUTO-API 4，AUTO-UI 3，REAL 1 |
| R4 | 10 | AUTO-UI 6，AUTO-API 4 |
| R6 | 7 | AUTO-UI 3，AUTO-API 4 |
| R7 | 6 | AUTO-API 5，AUTO-UI 1 |
| R8 | 6 | AUTO-API 5，AUTO-UI 1 |
| R9 | 8 | AUTO-API 5，AUTO-UI 3 |
| R10 | 5 | AUTO-API 4，AUTO-UI 1 |
| R14 | 8 | AUTO-API 8 |
| R17 | 8 | AUTO-API 6，AUTO-UI 1，MANUAL 1 |
| R12 | 7 | AUTO-API 7 |
| R13 | 4 | AUTO-API 3，AUTO-UI 1 |
| R15 | 3 | AUTO-API 2，MANUAL 1 |
| R16 | 3 | AUTO-API 2，REAL 1 |
| R18 | 4 | AUTO-API 4 |
| R19 | 5 | AUTO-API 4，AUTO-UI 1 |
| R20 | 4 | AUTO-API 3，REAL 1 |
| R21 | 3 | AUTO-API 1，AUTO-UI 1，MANUAL 1 |
| R22 | 2 | AUTO-UI 1，MANUAL 1 |
| X | 4 | AUTO-API 2，MANUAL 2 |

### R1

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R1-01 | AUTO-UI | any | 助手消息渲染表格、代码高亮、公式与双链 | 1. 消息区存在 table、高亮关键字、1 个 KaTeX 节点<br>2. 双链元素可点击并打开同名笔记 | S:copy; 任务书 R1 |
| RT-R1-02 | AUTO-UI | any | 回复内容的 XSS 净化 | 1. 消息区无 script 元素、无 onerror 属性、无 javascript: href<br>2. 页面未执行注入脚本（window.__rtXss 未定义） | DEVELOPMENT §9 XSS 净化 |
| RT-R1-03 | AUTO-UI | any | 不完整 Markdown 不导致白屏 | 1. 无 pageerror<br>2. 回复文字可见 | 任务书 R1 渲染失败回退 |
| RT-R1-04 | AUTO-API | any | OpenAI 兼容 reasoning_content 的流式事件与持久化 | 1. 收到 chat.reasoning 事件<br>2. chat.messages 中该助手消息 reasoning 与推送内容一致 | S:thinking-generating |
| RT-R1-05 | AUTO-API | any | Anthropic thinking_delta 解析 | 1. 助手消息 reasoning 非空且正文完整 | 任务书 R1 契约 |
| RT-R1-06 | AUTO-UI | any | 思考过程默认折叠并显示字数 | 1. 出现“已思考”字样与字数<br>2. 默认不显示推理全文，点击后显示 | S:thinking-done |
| RT-R1-07 | AUTO-API | any | 重新生成只替换最后一轮 | 1. 用户消息仍为 1 条<br>2. 助手消息为 1 条且内容变为回复 #2 | S:ai-regenerate |
| RT-R1-08 | AUTO-API | any | 运行中重新生成被拒绝 | 1. 返回错误，会话最终只有一轮回复 | S:error-4503 |
| RT-R1-09 | AUTO-UI | any | 复制按钮复制 Markdown 原文 | 1. 系统剪贴板文本与伪造模型返回的原文一致 | S:copy |
| RT-R1-10 | AUTO-UI | any | 上一轮有保险箱变更时重新生成先提示 | 1. 出现含“不会自动撤销”的确认提示，取消后不重跑 | 任务书 R1 |

### R11

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R11-01 | AUTO-API | any | 未设置后台任务模型时摘要明确报错 | 1. 错误信息含“后台任务模型”<br>2. 伪造服务没有收到任何请求 | 任务书 R11 不得静默回退 |
| RT-R11-02 | AUTO-API | any | 摘要路由到后台任务模型并回写 processed | 1. 伪造服务收到 model=bg-model 的请求<br>2. 笔记 summary/keywords 写入且 processed=1 | S:basic-generation-description |
| RT-R11-03 | AUTO-API | any | 后台模型指向未勾选模型时拒绝 | 1. 设置被拒绝或使用时报错<br>2. 不向其他模型发请求 | configured-only 契约 |
| RT-R11-04 | AUTO-API | any | 搜索模式默认 basic，无 Key 时不能切到高级模式 | 1. 默认为 basic<br>2. 设置失败或读取仍为 basic | S:mode-* |
| RT-R11-05 | AUTO-API | any | 未配置 Key 时验证按钮不发网络请求 | 1. 返回明确的“未配置”类错误 | S:verify-* |
| RT-R11-06 | AUTO-API | any | 模型错误分类：认证失败 | 1. chat.error 文案含“密钥” | 任务书 R11 |
| RT-R11-07 | AUTO-API | any | 模型错误分类：限流/过载 | 1. 文案含“繁忙”且说明与密钥无关 | S:llm-error-solution-model_overloaded |
| RT-R11-08 | AUTO-API | any | 模型错误分类：上下文过长 | 1. 文案含“过长” | 任务书 R11 |
| RT-R11-09 | AUTO-API | any | 模型错误分类：网络不可达 | 1. 文案含“网络”或“无法连接” | 任务书 R11 |
| RT-R11-10 | AUTO-API | any | 用量持久化 | 1. 助手消息 usage.input=123、usage.output=45、calls≥1 | S:detail |
| RT-R11-11 | AUTO-API | any | 对话不使用后台模型 | 1. 对话请求 model=scripted，没有 bg-model 的对话请求 | 显式选择契约 |
| RT-R11-12 | REAL | any | 三种搜索模式的真实引擎顺序与回退 | 1. 引擎顺序与回退符合任务书 R11 | S:mode-* |

### R5

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R5-01 | AUTO-API | any | edits 多处替换按原文匹配 | 1. 正文含两处新文本 | D:notes update_note |
| RT-R5-02 | AUTO-API | any | edits 原文出现多次 | 1. 报错含“多次”并指明第 1 条<br>2. 正文未改变 | D:notes update_note |
| RT-R5-03 | AUTO-API | any | edits 重叠 | 1. 报错含“重叠”并指明第 2 条<br>2. 正文未改变 | D:notes update_note |
| RT-R5-04 | AUTO-API | any | edits 找不到 | 1. 报错含“未找到”并指明第 2 条<br>2. 第 1 条也未生效（整体原子） | D:notes update_note |
| RT-R5-05 | AUTO-API | any | 首尾空白的模糊匹配 | 1. 替换成功 | D:notes update_note |
| RT-R5-06 | AUTO-API | any | edits 不逐条累积 | 1. EDIT-L003 与 EDIT-L003-B 各出现 1 次 | D:notes update_note |
| RT-R5-07 | AUTO-API | any | append 补空行，空串拒绝 | 1. 正文以“\n\nAPPEND-1”结尾（原正文不以换行结尾时）或空行分隔<br>2. 空串被拒绝 | D:notes update_note |
| RT-R5-08 | AUTO-API | any | body/edits/append 互斥 | 1. 被拒绝，正文未变 | D:notes update_note |
| RT-R5-09 | AUTO-API | any | 去除与标题重复的首行 H1 | 1. 保存的正文不以 '# RT标题' 开头 | D:notes create_note |
| RT-R5-10 | AUTO-API | any | Agent 不改写导入类笔记正文 | 1. 改正文的工具结果为错误并说明原因，正文未变<br>2. 改标题成功 | D:notes update_note；Q4 |
| RT-R5-11 | AUTO-API | any | 界面编辑不受来源保护影响 | 1. 正文更新成功 | 任务书 R5 第 3 点 |
| RT-R5-12 | AUTO-API | any | 检索过滤：状态、集合、时间半开区间 | 1. 过滤结果精确<br>2. timeTo=今天 不包含今天创建的笔记（左闭右开） | D:notes search_notes |
| RT-R5-13 | AUTO-API | any | 检索 limit 默认 20、上限 100、返回 total/showing | 1. 默认 showing=20，total≥105<br>2. limit=500 时 showing≤100 | D:notes search_notes |
| RT-R5-14 | AUTO-API | any | 检索返回字段完整 | 1. item 含 noteId/title/noteType/noteSource/preview/created/modified/collections/status<br>2. 时间为带时区偏移的 ISO 字符串 | D:notes search_notes |
| RT-R5-15 | AUTO-API | any | 分段读取与负 offset | 1. 返回 totalLines<br>2. 负 offset 返回最后 3 行 | D:notes read_note |
| RT-R5-16 | AUTO-API | any | set_status 只返回实际变化字段 | 1. applied 只含 pinned | D:notes set_note_status |
| RT-R5-17 | AUTO-API | any | 按标题加入集合自动创建 | 1. 第一次 createdCollection=true，第二次 false | D:notes add_note_to_collection |
| RT-R5-18 | AUTO-API | any | Agent 的集合变更进入保险箱并可回滚 | 1. 出现 note-collection 类条目<br>2. 回滚后笔记不在该集合 | D:vault |
| RT-R5-19 | AUTO-API | any | attach_image 拒绝工作区外路径 | 1. 被拒绝 | 任务书 R5 第 6 点 |
| RT-R5-20 | AUTO-API | any | file.read_document 读取工作区文档、拒绝工作区外 | 1. 返回 Markdown 含“订单号”<br>2. 工作区外被拒绝 | D:notes read_file |
| RT-R5-21 | AUTO-API | any | Agent 局部编辑可整体回滚 | 1. 正文恢复为编辑前 | D:rvault |

### R2

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R2-01 | AUTO-API | any | 引用笔记正文注入模型上下文 | 1. 伪造服务收到的消息中含 CITE-F01 原文 | S:ask-something |
| RT-R2-02 | AUTO-API | any | 引用数量上限 | 1. 均被拒绝 | 任务书 R2 |
| RT-R2-03 | AUTO-API | any | 单篇 8000、合计 24000 字预算与截断说明 | 1. 含 REF1-AT-0100、REF1-AT-7900<br>2. 不含 REF1-AT-8100、REF1-AT-9500<br>3. 注入总量不超过 24000 字并有截断说明 | oracle longRefBudget |
| RT-R2-04 | AUTO-API | any | 选中技能本轮强制注入 | 1. 请求的系统提示词含 SKILL-MARKER-ALPHA | S:ask-something |
| RT-R2-05 | AUTO-API | any | 引用持久化在用户消息上 | 1. 用户消息 refs 含所引用的 noteId | REA saveChatReferences |
| RT-R2-06 | AUTO-UI | any | @ 浮层检索并添加标签 | 1. 出现浮层且最多 8 项<br>2. 输入框上方出现笔记标签，正文不再含 '@北辰' | S:ask-something |
| RT-R2-07 | AUTO-UI | any | / 只在行首弹出技能 | 1. 行首弹出技能列表<br>2. 中间不弹出 | S:ask-something |
| RT-R2-08 | AUTO-UI | any | 标签单个移除与全部移除 | 1. 标签数依次为 2→1→0 | S:delete, clear |
| RT-R2-09 | MANUAL | mac | 中文输入法下 @ 与 / 不误触发 | 1. 组合输入期间不弹浮层，上屏后符合 RT-R2-06/07 | 任务书 R2 |
| RT-R2-10 | AUTO-UI | any | 添加网页受剪藏黑名单约束 | 1. 提示被黑名单拦截，不新增笔记 | 任务书 R2 |

### R3

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R3-01 | AUTO-API | any | 检索后回答带有效来源 | 1. chat.sources 事件与消息 sources 中 n=1 指向 cite-01 笔记 | D:execution rag |
| RT-R3-02 | AUTO-API | any | 丢弃未登记的编号 | 1. sources 只有 n=1 | 任务书 R3 |
| RT-R3-03 | AUTO-UI | any | 代码块中的 [n] 不渲染为角标 | 1. 角标数量为 1 | 任务书 R3 |
| RT-R3-04 | AUTO-API | any | 关闭“引用知识库”后不提供检索工具，@ 引用仍有效 | 1. 请求 tools 不含 notes__search/notes__get/notes__list<br>2. 消息中仍含 CITE-F01 | S:reference-knowledge-base |
| RT-R3-05 | AUTO-API | any | @ 引用的笔记登记为来源 | 1. sources n=1 指向 cite-02 | 任务书 R2/R3 |
| RT-R3-06 | AUTO-UI | any | 点击角标打开笔记并高亮片段 | 1. 打开北辰计划详情，页面存在高亮元素且含“周岚” | S:locate |
| RT-R3-07 | AUTO-UI | any | 复制（带引用） | 1. 剪贴板含“来源”与笔记标题“北辰计划” | S:copy-with-citation |
| RT-R3-08 | REAL | any | 真实模型引用问答 | 1. CQ01～CQ03 答案正确且来源指向期望文件<br>2. CQ04 说明无数据，不编造编号 | oracle citation |

### R4

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R4-01 | AUTO-UI | any | 删除笔记以对话内确认卡呈现 | 1. 对话流出现标题含“删除笔记”的卡片并显示笔记标题与“保险箱”说明<br>2. 不出现 ant-modal 确认框 | S:confirm-delete-* |
| RT-R4-02 | AUTO-UI | any | 拒绝后不执行 | 1. 笔记仍存在<br>2. 卡片变为“已拒绝” | 任务书 R4 |
| RT-R4-03 | AUTO-UI | any | 允许后执行 | 1. 笔记进入回收站<br>2. 卡片变为“已允许” | 任务书 R4 |
| RT-R4-04 | AUTO-UI | any | 停止后待确认请求被取消 | 1. 卡片显示“已取消”，笔记未删除 | 任务书 R4 |
| RT-R4-05 | AUTO-API | any | 文件写入卡的 preview | 1. chat.confirm 事件 preview.kind=file_write，fields 含路径，body 含新内容开头 | 任务书 R4 |
| RT-R4-06 | AUTO-API | any | 批量写入卡 | 1. 出现 preview.kind=bulk 或超过 5 次写入的确认，列出条数 | DEVELOPMENT §7.1 批量确认 |
| RT-R4-07 | AUTO-API | any | override 只允许可编辑字段 | 1. 前者被接受并重新校验<br>2. 后者被拒绝且不执行 | 任务书 R4 |
| RT-R4-08 | AUTO-UI | any | 单账户时不显示发件账户选择器 | 1. 发信卡显示收件人、主题、正文且可编辑<br>2. 不显示账户选择器 | D:mail send_mail |
| RT-R4-09 | AUTO-UI | any | 同一时间只有一张待确认卡 | 1. 提示先处理确认卡，未发出新请求 | 任务书 R4 |
| RT-R4-10 | AUTO-API | any | MCP 调用与网页脚本需要确认卡 | 1. chat.confirm preview.kind=browser_eval，含 URL 与脚本 | 任务书 R4 |

### R6

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R6-01 | AUTO-UI | any | 侧栏菜单删除会话 | 1. 会话从列表与 chat.list 中消失 | 任务书 R6（修复不可达入口） |
| RT-R6-02 | AUTO-API | any | 运行中的会话不能删除 | 1. 被拒绝 | 任务书 R6 |
| RT-R6-03 | AUTO-UI | any | 行内重命名：回车保存、Esc 取消 | 1. 第一次生效，第二次不变 | 任务书 R6 |
| RT-R6-04 | AUTO-API | any | chat.list 支持 query/limit/offset | 1. 过滤与分页正确 | 任务书 R6 |
| RT-R6-05 | AUTO-API | any | 首轮回复后 AI 命名 | 1. 标题变为伪造后台模型返回的“合成标题”<br>2. 命名请求发往 bg-model | S:basic-generation-description |
| RT-R6-06 | AUTO-API | any | 手动标题不被覆盖；关闭后不命名 | 1. 两种情况标题均未被 AI 改写 | 任务书 R6 |
| RT-R6-07 | AUTO-UI | any | 侧栏搜索过滤会话 | 1. 只显示匹配会话 | 任务书 R6 |

### R7

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R7-01 | AUTO-API | any | vault.list 补充 type/noteTitle | 1. 条目 type=note 且带 noteTitle | D:vault list |
| RT-R7-02 | AUTO-API | any | 回滚结果摘要与重复回滚跳过 | 1. 第一次 restored 含该条目<br>2. 第二次 skipped 含原因 | D:vault rollback |
| RT-R7-03 | AUTO-API | any | 新建目录含其他文件时需确认 | 1. 返回 needsConfirm 并列出 b.md<br>2. confirm=true 后执行 | D:vault needsConfirm |
| RT-R7-04 | AUTO-API | any | 新建文件回滚后原路径不存在 | 1. 原路径文件不存在（移到废纸篓） | D:vault rollback |
| RT-R7-05 | AUTO-API | any | 回滚不暴露给 Agent | 1. 请求 tools 不含 vault__rollback | DEVELOPMENT §7.5 |
| RT-R7-06 | AUTO-UI | any | 保险箱徽标与中文分组 | 1. 保险箱按钮显示数字 1<br>2. 抽屉出现“笔记”分组与“修改”字样，不出现 modify/note 原值 | S:changed-items |

### R8

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R8-01 | AUTO-API | any | 档案与自定义指令注入系统提示词 | 1. 对话请求系统提示词含 RT昵称 与 RT-INSTR-MARK | D:general get_settings |
| RT-R8-02 | AUTO-API | any | 自定义指令超长被拒绝 | 1. 被拒绝 | 任务书 R8 |
| RT-R8-03 | AUTO-API | any | 回复语言注入但不写入记忆 | 1. 系统提示词含回复语言<br>2. 工作区记忆文件不含 en-US 或“回复语言” | D:memory_flush_prompt |
| RT-R8-04 | AUTO-API | any | 记忆模式 off 不整理 | 1. 伪造服务没有收到记忆整理请求 | 任务书 R8 |
| RT-R8-05 | AUTO-API | any | quality 模式切换会话时整理，economy 不整理 | 1. quality 下出现一次记忆整理请求；economy 下没有 | REA flushSessionMemoryIfNeeded |
| RT-R8-06 | AUTO-UI | any | 清空长期记忆需二次确认 | 1. 出现确认，取消后记忆文件未变 | 任务书 R8 |

### R9

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R9-01 | AUTO-API | any | 来源与修改时间筛选 | 1. 只返回 PDF 笔记；时间区间外返回空 | D:notes search_notes |
| RT-R9-02 | AUTO-API | any | 批量状态部分失败 | 1. 返回成功 2、失败 1；有效项已更新 | S:bookmark-batch |
| RT-R9-03 | AUTO-API | any | 批量删除与恢复 | 1. 回收站计数 +3 后恢复 | 任务书 R9 |
| RT-R9-04 | AUTO-API | any | 批量加入集合按标题创建 | 1. 集合被创建且包含全部笔记 | 任务书 R9 |
| RT-R9-05 | AUTO-API | any | 批量上限 500 | 1. 被拒绝 | 任务书 R9 |
| RT-R9-06 | AUTO-UI | any | 多选模式与批量收藏 | 1. 显示“已选 2 项”<br>2. 两条均为收藏 | S:bookmark-batch |
| RT-R9-07 | AUTO-UI | any | 行“更多”菜单与最近集合 | 1. 菜单含 加入集合…/稍后/复制标题/在 Finder 中显示/导出 PDF<br>2. 选择器顶部列出最近使用的集合 | REA getRecentCollections |
| RT-R9-08 | AUTO-UI | any | 按来源分组 | 1. 出现分组标题与数量 | S:group-by-source |

### R10

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R10-01 | AUTO-API | any | 批量处理未处理笔记并汇总失败 | 1. 收到 summarize.progress 事件<br>2. 2 条 processed=1，1 条失败被汇总 | 任务书 R10 |
| RT-R10-02 | AUTO-API | any | 批量处理可取消 | 1. 后续请求停止，已完成数小于总数 | REA cancelNoteSummaryStream |
| RT-R10-03 | AUTO-API | any | 相关笔记排除自身与已删除 | 1. 结果含 rel-02，不含 rel-01 自身、不含已删除笔记，不含 rel-03 | REA getResourceRelatedNotes |
| RT-R10-04 | AUTO-API | any | 相关笔记 limit 上限 10 | 1. 被拒绝或返回≤10 | 任务书 R10 |
| RT-R10-05 | AUTO-UI | any | 详情页生成摘要入口与未设置提示 | 1. 提示“请先在设置中选择后台任务模型” | S:add-a-summary |

### R14

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R14-01 | AUTO-API | linux | 重复目录拒绝 | 1. 第二次返回可识别的冲突错误 | D:sync_folder add |
| RT-R14-02 | AUTO-API | linux | 子目录被上级覆盖 | 1. 提示已被上级目录覆盖 | D:sync_folder add |
| RT-R14-03 | AUTO-API | linux | 添加上级目录时合并 | 1. 只剩 parent 一条登记 | 任务书 R14 |
| RT-R14-04 | AUTO-API | linux | 符号链接按真实路径判重 | 1. 判为重复 | 任务书 R14 |
| RT-R14-05 | AUTO-API | linux | 拒绝工作区、主目录根与系统目录 | 1. 全部被拒绝 | 任务书 R14 |
| RT-R14-06 | AUTO-API | linux | 结构化状态与计数 | 1. folders_list 含 state、imported=2、failed=0、last_scan_at | D:sync_folder list |
| RT-R14-07 | AUTO-API | linux | 权限错误提示 | 1. state=出错，提示含“权限” | S:folder-permission-tip |
| RT-R14-08 | AUTO-API | any | 推荐目录只返回存在的目录 | 1. 每个返回路径都存在 | S:suggested-folders |

### R17

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R17-01 | AUTO-API | any | 要点随录音保存 | 1. 录音笔记正文含 RT-KEYPOINT | S:key-points |
| RT-R17-02 | AUTO-API | any | 分段关联与幂等 | 1. 两段关联到同一录音会话<br>2. 重复保存不新增笔记 | 任务书 R17 |
| RT-R17-03 | AUTO-API | any | 待转写计数 | 1. 计数≥2 | S:description-with-pending |
| RT-R17-04 | AUTO-API | any | 转写稿生成并携带词典 | 1. 生成 note_source=meeting_transcript 的笔记并与录音互链<br>2. 伪造 ASR 收到的 prompt 含“北辰计划” | S:dictionary-desc |
| RT-R17-05 | AUTO-API | any | 纪要由后台模型生成并三方关联 | 1. 请求发往 bg-model 且含要点与词典词<br>2. 生成 meeting_overview 笔记，与录音、转写稿互链 | S:recording_minutes |
| RT-R17-06 | AUTO-API | any | 纪要失败可重试且不影响已有笔记 | 1. 第一次失败后录音与转写稿仍在<br>2. 重试成功生成纪要 | REA retryMeetingProcess |
| RT-R17-07 | AUTO-UI | any | 录音界面：语言选择、要点框、保存后转写提示 | 1. 开始前可选语言<br>2. 录音中出现“要点”输入框<br>3. 保存后出现“是否转写”提示并显示待转写数量 | S:language-selection-dialog-title |
| RT-R17-08 | MANUAL | mac | 实机麦克风长录音自动分段 | 1. 提示已自动保存第 1 段并继续录制 | S:recording-timeout |

### R12

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R12-01 | AUTO-API | any | HTTP MCP 保存且 token 不回显 | 1. mcp.servers_list 不含 RT-SECRET 明文 | D:mcp connect |
| RT-R12-02 | AUTO-API | any | HTTP MCP 测试连接返回工具数 | 1. 返回工具数=3 | 任务书 R12 |
| RT-R12-03 | AUTO-API | any | 错误 token 归类为认证失败 | 1. 错误类别为认证失败 | S:mcp-validation-failed |
| RT-R12-04 | AUTO-API | any | 超过 40 个工具改用元工具 | 1. 请求 tools 不含逐个 mcp__ 工具，含 mcp 搜索/取定义/调用元工具<br>2. 系统提示词含该服务器名称 | D:mcp |
| RT-R12-05 | AUTO-API | any | 工具搜索排序与失败隔离 | 1. 顺序为 export、export_csv、bulk_export_jobs、archive_records<br>2. 失败服务器出现在 errors，结果仍返回 | D:mcp search_tools |
| RT-R12-06 | AUTO-API | any | list_tools 分页与完整 schema | 1. 第二页返回 5 个<br>2. 单工具返回 inputSchema | D:mcp list_tools |
| RT-R12-07 | AUTO-API | any | 不超过阈值时仍直接注入 | 1. 请求 tools 含 3 个 mcp__ 工具 | 任务书 R12 |

### R13

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R13-01 | AUTO-API | any | 从文件夹添加有效技能 | 1. 技能列表出现 rt-skill-beta，来源为工作区 | S:mine |
| RT-R13-02 | AUTO-API | any | 拒绝无 frontmatter 与重名技能 | 1. 均被拒绝且不写入技能目录 | 任务书 R13 |
| RT-R13-03 | AUTO-API | any | 移除技能 | 1. 列表中消失，工作区技能目录中不再存在 | S:uninstall-confirm-* |
| RT-R13-04 | AUTO-UI | any | 技能库搜索与详情 | 1. 只显示匹配项，详情渲染 SKILL-MARKER-ALPHA | S:instructions |

### R15

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R15-01 | AUTO-API | any | 快捷键校验 | 1. 无修饰键被拒绝<br>2. 重复被拒绝<br>3. 系统组合给出冲突警告 | S:hotkey-* |
| RT-R15-02 | AUTO-API | any | 恢复默认 | 1. 读回默认组合 | REA resetShortcutBinding |
| RT-R15-03 | MANUAL | mac | 全局快捷键实机生效与占用回滚 | 1. 新组合唤起 WhyWork<br>2. 占用时提示并回滚旧值 | 任务书 R15 |

### R16

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R16-01 | AUTO-API | any | 链接数量上限 | 1. 被拒绝 | 任务书 R16 |
| RT-R16-02 | AUTO-API | any | 未配置下载器时给出说明且不联网 | 1. 任务失败或拒绝，提示配置下载器 | Q2 |
| RT-R16-03 | REAL | any | 公开视频：字幕优先、产出三条笔记、合集提示、取消保留主笔记 | 1. 状态依次推进<br>2. 合集只处理一集并提示集数<br>3. 取消后主笔记保留 | D:media add_podcast |

### R18

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R18-01 | AUTO-API | any | 图片 OCR 进入检索 | 1. 命中该笔记且标注图片文字来源 | D:media ocr_image |
| RT-R18-02 | AUTO-API | any | Agent 读取笔记附带图片文字 | 1. images[].ocrText 含 ORION-17 | D:notes read_note noteImages |
| RT-R18-03 | AUTO-API | any | 扫描版 PDF OCR | 1. 检索 OCR_MARKER_742 命中该 PDF 笔记 | REA queueBackgroundPdfOcr |
| RT-R18-04 | AUTO-API | any | 删除后移出索引 | 1. 不再命中 | 任务书 R18 |

### R19

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R19-01 | AUTO-API | any | xlsx_summary | 1. 两个工作表，行列数与 oracle 一致，含表头样例 | D:office xls summary |
| RT-R19-02 | AUTO-API | any | xlsx_read 共享字符预算与续读 | 1. 总字符≤20000<br>2. 返回剩余行数与续读 offset，按该 offset 可继续读取 | D:office xls read |
| RT-R19-03 | AUTO-API | any | 表格工具拒绝工作区外路径 | 1. 被拒绝 | 任务书 R19 |
| RT-R19-04 | AUTO-API | any | 按页纲与主题生成 PPTX | 1. 生成 3 页<br>2. PPTX 主题或幻灯片 XML 中出现该主题主色 | D:office ppt build_design_spec |
| RT-R19-05 | AUTO-UI | any | 页纲编辑界面 | 1. 先出现可编辑页纲（可增删、调整顺序），确认后才生成 | 任务书 R19 |

### R20

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R20-01 | AUTO-API | any | 附件限额与路径守卫 | 1. 单个超限、合计超限、工作区外均被拒绝且不发起连接 | S:attachment-limits |
| RT-R20-02 | AUTO-API | any | 连接失败分类并进入失败列表 | 1. 错误为“无法连接服务器”类<br>2. 失败列表含该邮件与原因 | REA sendMailQueued/retryMailSendTask |
| RT-R20-03 | AUTO-API | any | 失败邮件重试需再次确认 | 1. 出现确认，未确认前不发起连接 | 任务书 R20 |
| RT-R20-04 | REAL | any | 移除账户两种选项与真实收发 | 1. 笔记处理符合所选项<br>2. 收件方收到附件 | S:disconnect-mail-tip2 |

### R21

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R21-01 | AUTO-API | any | ICS 搜索语义统一 | 1. 默认范围为前后一年：含 11 个月后，不含 13 个月后与 1 年零 1 天前<br>2. 左闭右开：end=明天 不含明天<br>3. 有 query 时按相关度排序<br>4. limit 默认 20、上限 100 | D:calendar search_events |
| RT-R21-02 | AUTO-UI | linux | Linux 下隐藏系统日历入口 | 1. 不出现“连接系统日历” | 任务书 R21 |
| RT-R21-03 | MANUAL | mac | 系统日历授权三态与只读读取 | 1. 三种状态提示正确<br>2. 结果标注来源为系统日历，界面无创建/修改入口 | REA calendar.checkOSCalendarAccess |

### R22

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-R22-01 | AUTO-UI | any | 配对二维码倒计时 | 1. 显示倒计时 | S:mobile-scan-to-bind |
| RT-R22-02 | MANUAL | any | 过期、绑定成功与解绑确认 | 1. 过期覆盖层与刷新可用<br>2. 绑定成功提示设备名<br>3. 解绑需确认 | S:expired, mobile-bound-success |

### X

| ID | 级别 | 平台 | 标题 | 期望 | 依据 |
|---|---|---|---|---|---|
| RT-X-01 | AUTO-API | any | 清洁室：仓库不含 remio 提取文件 | 1. 没有任何文件哈希相同 | 任务书 一.3 |
| RT-X-02 | AUTO-API | any | 测试期间模型请求只发往本地伪造服务 | 1. 所有模型、ASR、MCP 请求的地址均为 127.0.0.1 | TASKS-HANDOFF 凭据纪律 |
| RT-X-03 | MANUAL | any | 旧工作区升级 | 1. 增量迁移成功且可重复，旧笔记、会话、模型选择完整 | 任务书 一.6 |
| RT-X-04 | MANUAL | any | 工程门槛 | 1. 全部通过 | 任务书 一.5 |
