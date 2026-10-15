# WhyWork 开发任务交接清单

> 生成：2026-10-15。基线：main @ 45ce60e。状态权威源：`docs/PROGRESS.md`（逐次会话日志）、`docs/VISUAL-ACCEPTANCE.md`（视觉/人工验收台账）、`release/verification/*.json`（签名包检查证据）。
> **接手前必读**：`docs/DEVELOPMENT.md`（架构与契约单一事实来源）→ `docs/PROGRESS.md` 末三节 → 本清单。
> 自动台账基线：72 项 = 40 PASS / 0 FAIL / 10 BLOCKED / 15 MANUAL / 7 N/A（历史包）；源码侧 smoke 13 项与 66+ 单测须保持全绿。

## 一、当前完成度（不要重复开发）

| 模块 | 状态 | 证据 |
|---|---|---|
| 知识库/编辑器/Agent/rVault/记忆 | ✅ | 72 用例台账、冒烟、单测 |
| 供应商（DeepSeek/GLM/MiniMax/自定义/Codex OAuth） | ✅ 代码闭环 | 设置页 + `provider.chatgpt_candidates`；**真实账号推理未验证**（用户条件） |
| 采集（导入/ENEX/目录监控/剪藏+黑名单/URL scheme `whywork://`/全局快捷键 ⌥⌘Space·⌥⌘N） | ✅ | capture.ts、search 域、watch 域 |
| 媒体（录音暂停/继续/取消/重试/幂等保存、ASR、OCR 本地语言包） | ✅ 代码闭环 | RecordingControls/controller；**实机播放与权限拒绝项待条件** |
| 检索（FTS5 中文填充 + 本地逐词第二路线 + 未索引文件名候选） | ✅ | search.ts、NotesView 路线切换 |
| Office（XLSX 值/公式/格式写回、DOCX 导出/导入、PPTX 页纲生成） | ✅ 范围内 | office*.ts；复杂版式/图表/透视表明确不做 |
| 邮件/日历/动态网页/设备配对骨架 | ✅ | mail/calendar/browser/pair 域 + 工具竖栏 UI |
| 分享扩展（Swift/AppKit，编译+本地签名） | ✅ 构建 | build:share/check:share；系统菜单端到端待实机 |
| 打包（DMG ad-hoc 签名） | ✅ | release/WhyWork-0.1.0-arm64.dmg（最新 SHA 见 PROGRESS） |
| 讯飞办公本集成（登录/设备/云笔记导入/读写驿站推送） | ✅ 代码闭环 | iflytek 域；**真机链路待用户条件** |

## 二、任务清单

### P0 — 用户条件阻塞项（拿到条件即可执行，均为验收而非开发）

| ID | 任务 | 前置条件（向用户索取） | 验收标准 | 关联 |
|---|---|---|---|---|
| U1 | 真实模型推理验收 + BLOCKED 转绿 | 用户提供测试供应商/模型/Key 与调用预算 | `electron out/main/index.js --run-cases`：RAG-01~07 由 BLOCKED→PASS；答案符合 oracle（金额/日期容忍“万”与 ISO 表述） | case-runner.ts |
| U2 | ASR 转写验收 | 兼容 `/audio/transcriptions` 端点/模型 + 三段合成音频预算 | MEDIA-02 关键词≥3/5；MEDIA-03/04 不产出资料事实 | settings → 媒体 |
| U3 | 讯飞办公本真机链路 | 仅含合成内容的专用账号 + 实机设备；明确推送范围 | login→devices→import_note（文本落库）→send_file（办公本驿站可见） | iflytek 域 |
| U4 | 邮件真机收发 | 专用 IMAP/SMTP 账号；明确收件人/封数；不由会话索取密码 | 同步 N 封入库、发送 1 封收件方确认 | mail 域 |
| U5 | 权限拒绝行为验收 | 既有拒绝的麦克风/屏幕录制状态 + 受控合成音源；安全窗口由用户操作 | MEDIA-05/06、PRIV-08 明确提示、不隐式采集 | RecordingControls |
| U6 | Remio 逐屏对照收尾 | 不含个人资料的对照素材（安全空页截图/各目标状态参考图） | VISUAL-ACCEPTANCE 剩余对照行转结 | docs/VISUAL-ACCEPTANCE.md |
| U7 | ChatGPT 登录复验 | 真实 ChatGPT 账号在官方页完成授权 | 登录成功→`chatgpt_candidates` 返回账号目录→勾选生效→真实推理一条 | chatgpt.ts |

### P1 — 纯开发任务（无需用户条件，按序执行）

| ID | 任务 | 说明与做法 | 验收标准 |
|---|---|---|---|
| D1 | **绕开 ScreenCaptureKit -3811 的 UI 验收通道** | 用 Electron 窗口内 `webContents.capturePage()`（或 Playwright）截图替代系统 CUA；新脚本 `scripts/ui-capture.cjs`，输出到 `release/verification/ui/` | 亮/暗两主题各主要视图可截图留存；VISUAL-ACCEPTANCE 阻塞行解除 |
| D2 | 系统主题跟随验收（替代路径） | 应用内强制 `.dark` 切换 + capturePage 截图对比令牌生效（对比 `--ww-*` 计算值） | 两主题截图差异符合令牌定义，记录进验收表 |
| D3 | 单元测试补覆盖 | 新增：搜索第二路线（text 模式）、未索引文件名候选（search.ts 授权/映射逻辑）、录音状态机（controller 暂停/取消/幂等保存）、软删路径释放、CJK 填充 | `npm test` 新增 ≥12 用例且全绿 |
| D4 | GitHub Actions CI | macos runner：`npm ci` → typecheck → vitest → build → `--smoke-test`（无窗口可跑）→ `--run-cases` 的离线子集（凭据相关自动 BLOCKED 不算失败） | workflow 在 PR/main 触发且绿；缓存 electron/better-sqlite3 |
| D5 | DEVELOPMENT.md 与实现对齐 | 记录方案偏离：Office=自研（非 Univer）、检索双路线、录音状态机、菜单角色约束（剪贴板）、Codex OAuth=官方动态注册（非借用客户端） | 文档审阅通过，无“文档说 A 代码是 B”项 |
| D6 | 冒烟/核心检查防回归加固 | `--smoke-test` 现有 13 项 + `--core-check` 纳入 CI；新增菜单角色、搜索双路线、录音暂停 3 项断言 | CI 中任一失败即红 |
| D7 | 暗色链接修复随包发布 | PROGRESS 记录该修复已入源码但需随下一签名包出货；重打 DMG 并跑 `check:core` | 新包 SHA 记录进 PROGRESS；暗色链接截图复核 |

### P2 — 下一阶段产品（明确边界，独立立项）

| ID | 任务 | 前置 | 备注 |
|---|---|---|---|
| N1 | Android 端（初期目标之一） | 复用桌面 `pair` 域协议（二维码/一次性票据/局域网） | 已留骨架：pair.start/stop/devices；桌面侧无需大改 |
| N2 | 分享扩展实机激活 | 需用户机器安装签名包并触发系统菜单 | 已编译签名，属 U5 同类实机项 |
| N3 | 公证与分发（可选） | Apple Developer ID 证书 | 当前 ad-hoc 为本机验收；对外分发需公证+签名 |
| N4 | 自动更新（可选） | 更新源与签名策略 | 用户未要求，暂不做 |

## 三、明确不做（防止接手者扩范围）

账号/注册/会员/积分、云同步（hub/双端合并/CRDT）、插件市场/签名分发、复杂 Office 无损往返（图表/透视/宏）、移动端之外的付费服务、系统权限的隐式申请。

## 四、工程纪律（血泪经验，必须遵守）

1. **生效纪律**：`src/renderer/**` 改动 = 热更；`src/main/**`、`src/preload/**` 改动 = **立即重启**：`pkill -f "electron-vite dev"; pkill -f "user-data-dir=.*WhyWork"; sleep 3; (npm run dev &)`——只杀 dev 会留孤儿 Electron 主进程，新实例被单实例锁静默顶掉，表现为“改了没生效/UNKNOWN_ACTION”。
2. **剪贴板约束**：严禁 `Menu.setApplicationMenu(null)`；编辑角色菜单是 macOS ⌘C/V 的载体，`--smoke-test` 有守卫项。
3. **路径守卫**：所有文件访问走 `src/main/security/paths.ts`；relative 基准与 `realpath` 必须一致（`/var→/private/var` 曾致越界误报）。
4. **软删语义**：删除即 `relative_path=__deleted__/<id>` + 文件入墓碑；恢复按标题重分配路径。
5. **并行协作**：多个 agent 同工作区会互相盖文件/触发 rebase 竞争；建议 `git worktree` 分工，提交前 `git pull --rebase`，提交信息按模块前缀（feat/fix/check/docs）。
6. **凭据纪律**：任何 Key/令牌只进 safeStorage 加密字段，不入库明文、不进日志、不进 Git；测试仅用合成凭据。
7. **测试门槛**：每次 main 侧改动后跑 `npm run typecheck && npm test && npm run build && electron out/main/index.js --smoke-test`（应 13/13）。
8. **中文 UI**：所有界面文案中文；新增文案进 i18n/zh.ts；组件不硬编码（日志除外）。

## 五、关键入口速查

```bash
npm run dev                                  # 开发（热更；main 改动需按纪律①重启）
npm run typecheck && npm test                 # 类型 + 单测
npm run check:core / check:extended           # 签名包核心/扩展检查
npm run check:cases                           # 72 用例执行器 → tests/report.json
npm run check:browser / check:recovery / check:share
npm run pack:mac / dist:mac                   # 本地打包 / DMG
```
