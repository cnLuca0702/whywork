# WhyWork

Mac 上本地优先的知识库和 AI 工作工具。保留 WhyWork 品牌及原创蓝色八爪章鱼。

当前为开发验收版本。后端与合成链路已验证，真实供应商/账号及实际界面视觉验收尚未完成。状态以 [PROGRESS](docs/PROGRESS.md) 为准。

## 开发

使用 Node 22 或以上，在 macOS 中执行：

```sh
npm ci --legacy-peer-deps
npm run typecheck
npm test
npm run build
npm run dev
```

安装后自动为 Electron 重建 better-sqlite3。OCR 需要 `resources/tessdata/eng.traineddata.gz` 和 `chi_sim.traineddata.gz`，本机交付包已包含；模型资源不纳入源仓库，源码重建需准备合法的公开 Tesseract 语言数据。

## 隔离检查

```sh
npm run check:core
# 构建后的实际模型路由合成检查
./node_modules/.bin/electron out/main/index.js --model-check
npm run check:extended
npm run check:cases
npm run check:browser
npm run check:recovery
npm run check:share
```

测试入口隔离配置、工作区和全局技能。浏览器首次运行下载 Chromium。`check:cases` 需要项目合成 fixtures；报告输出 `tests/report.json`，不等同完整界面验收。

## Mac 打包

安装 Xcode 命令行工具（原生分享扩展使用 Swift/AppKit）。先构建，再执行 `npm run dist:mac`。产物位于 `release/`，本机 ad-hoc 签名，不含开发者公证或公开发布。

也可在 GitHub Actions 手动运行 **Build macOS DMG**，使用当前所选分支构建 Apple Silicon（arm64）安装包。流程准备 OCR 语言包、运行类型检查和单测、编译 Swift 组件，并验证打包后的签名、架构、冒烟与核心检查。成功后从该次运行的 Artifacts 下载 DMG、`BUILD-INFO.txt` 和 `SHA256SUMS.txt`（保留 30 天）。此流程不创建 GitHub Release；完整回归 CI 与人工验收状态另行记录在 `docs/PROGRESS.md`。

默认个人工作区 `~/Documents/WhyWork`；工作区配置、运行数据库、密钥、模型、缓存、依赖和测试运行产物均不应上传 Git。供应商密钥由用户在设置页自行填写，真实邮箱发送需要再次确认。

Office 支持工作区 XLSX 副本的值、公式、常用格式、合并和行列尺寸写回；DOCX 基本 Markdown 结构与工作区图片导出/导入；PPTX 按页纲生成。复杂分页、图表、透视表、宏和任意 Office 文件无损往返不在当前兼容承诺内。Android和局域网配对是后续项目。

WhyWork 隔离界面已取得实际截图并开始交互验收；Remio 的逐屏对照仍受窗口捕获错误阻塞，见 [视觉验收记录](docs/VISUAL-ACCEPTANCE.md)。

macOS 文本/链接分享扩展及本地收件箱使用方式见 [分享扩展](docs/SHARE-EXTENSION.md)。扩展已编译和本地签名，系统分享菜单激活与宿主端到端流程仍待实机验收。

## 2026-10-15 源码检查点

模型设置包含 Codex（ChatGPT 账号授权）、已知供应商的自定义 API 密钥、OpenAI 兼容自定义供应商。聊天按供应商和具体模型选择并随会话保存，不再以“快速/专家”替代真实模型。Codex 为本项目设置入口标签；OAuth 使用 WhyWork 自身动态注册，不使用官方 Codex 客户端身份。

当前通过 strict typecheck、81 项单元测试、生产构建、签名包核心检查及 loopback HTTP 模型路由检查。模型目录读取不执行推理，目录返回也不代表账号推理权限已验证。真实供应商推理本轮未执行；原生界面自动化受 ScreenCaptureKit -3811 阻塞，三类设置入口点击、键盘选择和窄布局仍待验收。本检查点不是已全面验收的正式发布。

本仓库只包含源码、构建配置、原创图标和合成测试样本。运行知识库、录音、凭据、提取的闭源资料、截图、缓存、依赖和 DMG 不纳入源码提交；不在本轮创建 GitHub Release。
