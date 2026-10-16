# WhyWork 开发文档（单一事实来源）

> 版本：2.0（本次接手修订）。本文档是 WhyWork 项目的权威开发规范，供本人及其他 agent 检查、接手、继续开发使用。
> 逆向研究依据：`../analysis/REMIO-RESEARCH.md`（remio 3.21.4/3.22.4 静态分析）。
> 进度追踪：`./PROGRESS.md`（每个里程碑完成后必须更新）。
> **规则：任何代码改动若与本文档冲突，先改文档再改代码；接手者从 PROGRESS.md 开始读。**

---

## 接手修订（2026-10-15）

- 品牌为 WhyWork，工作区 `.whywork`、preload `window.whywork`；旧协议仅兼容。
- 核心存储使用 better-sqlite3 原生 SQL，无 Drizzle。
- 测试启动在创建工作区之前隔离 userData/sessionData；不得访问默认个人工作区。
- Agent 通过每次调用上下文关联会话；文件写入、删除、移动及 MCP 工具须执行层确认。
- rVault 同时保存笔记元数据、集合与资源关联，回滚同步恢复索引与链接；冲突或缺快照明确失败。
- Office 保留 Univer 表格界面；xlsx 文件读写采用 ExcelJS 维护原工作簿，docx 导出和 pptx 生成分别使用 docx/PptxGenJS。格式转换损失须明确说明，不宣称任意格式无损。
- 浏览器使用独立无用户 cookie 的 Playwright context；邮件发送必须由用户确认；手机配对仅提供本地骨架，不实现云同步。
- 本地实现、自动化测试、真实供应商/账号验证、发布分别标注，未经运行不记通过。

## 1. 项目概述

WhyWork 是 remio（AI 第二大脑：本地知识库 + Agent）的 Mac 端复刻，**纯本地运行**。与原作的差异只有三处（用户指定，不可违反）：

1. **去掉所有会员登录**：无账号体系、无注册/JWT/扫码登录，启动即用；为未来"手机 app 绑定"预留本地配对协议与数据表（本期只留占位）。
2. **去掉会员付费/积分**：彻底 BYOK（Bring Your Own Key）。支持 DeepSeek、GLM（智谱）、MiniMax、任意 OpenAI 兼容端点、Anthropic，以及 **ChatGPT 账号登录接入**（Codex OAuth 流程，实验性）。
3. **去掉跨端同步与智能体应用（aApp）**：不实现云同步、hub、aApp 插件运行时；**保留** MCP、Skill、Agent 工具、rVault、记忆体系。

其余功能对齐原作（分期实现，见 §11 里程碑）。

### 1.1 明确不做清单（Forbidden List）

- 任何产品会员登录/注册/账号 UI 与网络调用（ChatGPT BYOK OAuth为已批准例外；`auth`、JWT、refresh token、用户资料）
- 任何付费/积分/订阅/额度 UI 与逻辑
- 云同步（上传/下载队列、hub、bisync）、多设备账号态
- aApp 插件运行时（manifest/service/市场/签名）
- **动态 IPC 通道**（字符串拼接的 channel 名）——原作 300 个动态通道无法审计，是反面教材
- Agent 未经 rVault 快照直接写用户文件/笔记
- 明文存储 API Key（必须走 Electron safeStorage）

## 2. 架构总览

```
┌─────────────── Renderer (React) ───────────────┐
│ 视图: 笔记列表/编辑器/对话/设置/Office            │
└───────▲───────────────────────────▲─────────────┘
   contextBridge(whywork API)   sys:event(事件流, main→renderer)
┌───────┴───────────────────────────┴─────────────┐
│ Preload: window.whywork.sys(action,payload)     │
└───────▲─────────────────────────────────────────┘
        ipcRenderer.invoke('sys:invoke', {action,payload,requestId})
┌───────┴─────────────────────────────────────────┐
│ Main Process                                     │
│  sysRouter: 单入口 syscall 网关（zod 契约校验）    │
│   ├─ domains/notes|file|web|chart|llm|chat|mcp|  │
│   │   skills|settings|vault|provider|app|…       │
│  agent/: agent loop + 工具注册 + 记忆 + rVault    │
│  providers/: BYOK 供应商适配（统一流式接口）       │
│  db/: better-sqlite3 原生 SQL + FTS5            │
│  services/: clipper/search/office/media/mail/…   │
└──────────────────────────────────────────────────┘
磁盘: <workspace>/*.md + <workspace>/.whywork/{db,memory,skills,vault,resources}
```

### 2.1 IPC 契约（全项目只有 3 个通道）

| 通道 | 方向 | 用途 |
|---|---|---|
| `sys:invoke` | renderer→main | `ipcRenderer.invoke`，请求 `{action:string, payload:unknown, requestId:string}`，响应 `{ok:true,data}` \| `{ok:false,error:{code,message}}`（错误码见 §6.3） |
| `sys:event` | main→renderer | `webContents.send`，`{topic:string, payload}`。topic 规范：`chat.delta` / `chat.tool` / `chat.done` / `chat.error` / `agent.progress` / `vault.changed` / `notes.changed` / `mcp.status` |
| `sys:stream` | renderer→main | 取消流（`ipcRenderer.send('sys:stream',{op:'abort',chatId})`），唯一允许的 fire-and-forget |

**约定**：新增能力 = 新增 action，不新增通道。action 命名 `域.动作`（如 `notes.search`）。所有 payload/result 用 zod schema 定义并注册（`src/main/syscalls/registry.ts`），未注册 action 返回 `UNKNOWN_ACTION`。

### 2.2 syscall 网关（继承 remio 的核心设计）

单一入口、分域文档化、契约校验、`{ok,data|error}` 协议。与原作差异：通道类型化（zod）、域文档即代码注释、错误带 code。

## 3. 技术栈与依赖基线

| 层 | 选型 | 版本策略 | 引入时机 |
|---|---|---|---|
| 运行时 | Electron | ^39 稳定线 | M0 |
| 构建 | electron-vite + vite | ^4 / ^7 | M0 |
| UI | React 18.3 + antd 5 + @ant-design/icons | antd5 官方兼容线（不用 React 19，避免 patch 包） | M0 |
| 样式 | tailwindcss 4（**只引 utilities**，避免 preflight 与 antd 冲突） | ^4 | M0 |
| 语言 | TypeScript strict（`noUncheckedIndexedAccess`） | ^5.9 | M0 |
| 校验 | zod | ^4 | M0 |
| DB | better-sqlite3（WAL）+ 手写 DDL/仓储层（**不引 ORM**：动态过滤与 FTS 联查用原生 prepared statement 更直接） | ^13 | M1（需 `@electron/rebuild`，见 §12） |
| 编辑器 | prosemirror-{model,state,view,transform,markdown} + markdown-it | ^1 | M2 |
| 代码块 | @codemirror/{state,view,language,basic-setup} + @lezer/highlight | 6.x | M2 |
| 数学 | katex | ^0.19 | M2 |
| 图表 | vega-lite + vega（服务端渲染 SVG，不走 canvas） | ^6 / ^6 | M3 |
| 网页解析 | @mozilla/readability + linkedom + turndown | 最新 | M3/M6 |
| MCP | @modelcontextprotocol/sdk | ^1.30 | M5 |
| Office 读 | mammoth(docx) + ExcelJS(xlsx) + JSZip(测试结构核验) | 最新 | M1(导入)/M7(编辑) |
| Office 编辑 | @univerjs/*（sheets 优先，懒加载独立窗口） | 1.0.4 同版 OSS 包 | M7 |
| 邮件 | imapflow + mailparser + nodemailer | 最新 | M9 |
| OCR | tesseract.js（离线） | ^6 | M10 |
| 打包 | electron-builder + electron-updater | ^26 / ^6 | M11 |
| 测试 | vitest | ^3 | M1 起 |

**国内镜像 fallback**（写进 `.npmrc`）：
```
electron_mirror=https://npmmirror.com/mirrors/electron/
```
Playwright 浏览器（M8）用 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/`，且首次使用时才安装。

不要全局设置 `disturl` 为 Electron 镜像：安装依赖时 node-gyp 先需要当前 Node
头文件，这会错误请求 Electron 镜像中的 Node 版本并返回 404。Electron ABI
由 postinstall 的 `electron-rebuild` 单独处理。

## 4. 目录结构（文件级职责）

```
WhyWork/
├─ docs/                      # 本文档 + PROGRESS.md
├─ package.json  electron.vite.config.ts  tsconfig*.json  .npmrc
├─ resources/icon.icns        # 应用图标（M0 用临时图标占位，M11 替换）
├─ src/
│  ├─ main/
│  │  ├─ index.ts             # app 生命周期、窗口创建、workspace 初始化、URL scheme 注册
│  │  ├─ ipc.ts               # 3 通道接线、sysRouter 装配、全局错误兜底
│  │  ├─ workspace.ts         # 工作区（默认 ~/Documents/WhyWork）：路径解析、首建、校验
│  │  ├─ db/                  # M1
│  │  │  ├─ client.ts         # better-sqlite3 单例（WAL）、DDL bootstrap
│  │  │  ├─ ddl.ts            # §5.2 的 DDL 真身（含 FTS5 触发器）
│  │  │  └─ repos/            # 类型化仓储（notes/collections/links/…）
│  │  ├─ syscalls/
│  │  │  ├─ registry.ts       # action→{schema,handler} 注册表 + 调用器
│  │  │  ├─ notes.ts file.ts web.ts chart.ts llm.ts chat.ts
│  │  │  ├─ mcp.ts skills.ts settings.ts vault.ts provider.ts app.ts
│  │  │  └─ (M6+) clip.ts media.ts mail.ts calendar.ts office.ts
│  │  ├─ agent/
│  │  │  ├─ loop.ts           # agent loop（§7.1）
│  │  │  ├─ tools.ts          # 工具注册表：syscall 包装为 LLM tool 定义
│  │  │  ├─ prompts.ts        # 系统提示词（含技能注入、记忆注入）
│  │  │  ├─ memory.ts         # MEMORY.md/MEM-YYYYMMDD.md/技能记忆读写 + flush 触发
│  │  │  └─ vault.ts          # rVault：BOW 快照、变更日志、回滚（§7.3）
│  │  ├─ providers/
│  │  │  ├─ types.ts          # ChatProvider 接口与 StreamEvent（§8.1）
│  │  │  ├─ openai-compat.ts  # DeepSeek/GLM/MiniMax/自定义 共用实现
│  │  │  ├─ anthropic.ts  chatgpt.ts（OAuth，§8.3）
│  │  │  ├─ store.ts          # providers 表 CRUD + safeStorage 加解密
│  │  │  └─ index.ts          # getProvider(id) 工厂
│  │  ├─ mcp/                 # M5：客户端管理、工具桥接（mcp__<server>__<tool>）
│  │  └─ services/            # M6+：clipper/search/media/mail/calendar/office
│  ├─ preload/index.ts        # contextBridge 暴露 myremio.{sys,onEvent,offEvent,abort}
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx  App.tsx
│        ├─ api.ts             # window.whywork 封装 + 事件订阅 hook
│        ├─ i18n/zh.ts         # 中文字典（结构即 en.ts 未来蓝本）
│        ├─ store/             # zustand：notes/chat/settings/ui
│        ├─ views/ NotesView EditorView ChatView SettingsView (OfficeView M7)
│        └─ components/        # Sidebar/NoteCard/ChatPanel/VaultPanel/ModelBadge…
```

## 5. 数据模型

### 5.1 磁盘布局（工作区 = 数据本体）

```
<workspace>/                    # 默认 ~/Documents/WhyWork，设置中可改（app.set_workspace）
├─ notes/…​.md                  # 笔记正文 markdown（DB 存 relative_path）
├─ resources/<note_id>/<file>   # 笔记资源（图片/附件）
└─ .whywork/
   ├─ whywork.db               # SQLite（WAL）——工作区自带，方便整体迁移/备份/手机同步
   ├─ memory/                  # MEMORY.md + MEM-YYYYMMDD.md + skills/<skill>-mem.md
   ├─ skills/                  # 工作区级技能（SKILL.md 目录）；另有全局 ~/.whywork/skills/
   ├─ vault/                   # rVault 快照（snapshots/ + tombstones/）+ journal.jsonl
   └─ tmp/
```

应用级配置（窗口状态、workspace 路径指针）：`app.getPath('userData')/config.json`。**不放任何用户内容**。

### 5.2 表 DDL（Drizzle schema 真身，M1 落地）

```sql
-- 枚举（TEXT + CHECK，沿用逆向结果）
-- note_type:  normal_note|collection|file|folder|mail|meeting|parsed_content|slack
-- note_source: manual|text|journal|page|image|audio|video|pdf|word|ppt|ppl|
--              mail_message|mail_session|meeting_recording|meeting_transcript|
--              meeting_overview|slack_message|slack_channel|slack_workspace|
--              organization|pre_defined_prompt|chat   ← 新增 chat（AI 生成笔记）

CREATE TABLE notes (
  note_id        TEXT PRIMARY KEY,            -- crypto.randomUUID()
  title          TEXT NOT NULL DEFAULT '',
  parsed_title   TEXT,                        -- AI 解析标题（可空）
  summary        TEXT,                        -- AI 摘要
  keywords       TEXT,                        -- JSON array
  topic          TEXT, author TEXT,
  note_type      TEXT NOT NULL DEFAULT 'normal_note',
  note_source    TEXT NOT NULL DEFAULT 'manual',
  relative_path  TEXT NOT NULL UNIQUE,        -- 相对 workspace，如 notes/2026/foo.md
  resource_dir   TEXT,                        -- 相对路径 resources/<note_id>/（可空）
  favorite       INTEGER NOT NULL DEFAULT 0,  -- 0/1（对齐原作 favoriteId 语义，简化为布尔）
  pinned         INTEGER NOT NULL DEFAULT 0,
  later          INTEGER NOT NULL DEFAULT 0,  -- 稍后读
  processed      INTEGER NOT NULL DEFAULT 0,  -- AI 是否已处理（摘要/关键词）
  restrictions   TEXT,                        -- JSON：未来访问限制（本期恒空）
  content_hash   TEXT,                        -- sha256(body)，变更检测
  created_at INTEGER NOT NULL, modified_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL,
  deleted_at INTEGER                           -- 软删（回收站）
);
CREATE TABLE collections (
  id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, icon TEXT, sort INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE note_collections (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  sort INTEGER DEFAULT 0, added_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, collection_id)
);
CREATE TABLE links (                          -- 双向链接（合并原作 inner/sublink）
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(note_id) ON DELETE CASCADE,  -- NULL=未解析
  target_text TEXT NOT NULL,                  -- [[显示文本]]，解析时按 title/note_id 匹配
  ext TEXT,                                   -- JSON 扩展（上下文片段等）
  created_at INTEGER NOT NULL,
  UNIQUE (source_note_id, target_text)
);
CREATE TABLE resources (
  resource_id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL, mime TEXT, size INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE chats (
  chat_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新对话',
  note_id TEXT REFERENCES notes(note_id) ON DELETE SET NULL,   -- 绑定笔记上下文（可空）
  model_role TEXT NOT NULL DEFAULT 'fast',    -- fast|expert
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  role TEXT NOT NULL,                         -- user|assistant|tool
  content TEXT, tool_calls TEXT, tool_result TEXT,   -- JSON
  created_at INTEGER NOT NULL
);
CREATE TABLE providers (
  id TEXT PRIMARY KEY,                        # deepseek|glm|minimax|openai-compat:<id>|anthropic|chatgpt
  kind TEXT NOT NULL,                         -- openai-compat|anthropic|chatgpt
  name TEXT NOT NULL, base_url TEXT,
  api_key_enc BLOB,                           -- safeStorage 加密
  models TEXT,                                -- JSON: {fast:[], expert:[], defaultFast, defaultExpert}
  enabled INTEGER DEFAULT 1, extra TEXT       -- JSON（chatgpt: tokens/account_id；搜索源 key 等）
);
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, command TEXT, args TEXT/*JSON*/,
  env TEXT/*JSON，值同样 safeStorage 加密*/, enabled INTEGER DEFAULT 1,
  tools_cache TEXT/*JSON*/, status TEXT
);
CREATE TABLE skills (
  name TEXT PRIMARY KEY, path TEXT NOT NULL, source TEXT NOT NULL,  -- workspace|global
  description TEXT, enabled INTEGER DEFAULT 1
);
CREATE TABLE vault_changes (
  change_id TEXT PRIMARY KEY, chat_id TEXT, ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                         -- file|note
  op TEXT NOT NULL,                           -- create|modify|delete|rename
  path TEXT NOT NULL, snapshot_path TEXT,     -- .whywork/vault/ 下相对路径；delete→tombstone
  detail TEXT/*JSON：note 快照 JSON 或 rename 的旧/新路径*/, rolled_back INTEGER DEFAULT 0
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT/*JSON*/);
CREATE TABLE devices (                        -- 手机绑定预留（M11 只建表不实现）
  device_id TEXT PRIMARY KEY, name TEXT, platform TEXT, pubkey TEXT,
  paired_at INTEGER, last_seen INTEGER
);
-- FTS5（contentless 外部内容表 + 触发器同步 title/summary/keywords/正文）
CREATE VIRTUAL TABLE notes_fts USING fts5(title, summary, keywords, body, content='');
-- 触发器：notes 插入/更新/软删时维护 rowid=notes.rowd 的文档（body 读文件正文）
```

**不变式**：`notes.relative_path` 指向的 md 文件是正文唯一真身；DB 字段（title 等）是索引，可由文件重建（`app.rebuild_index` 动作提供）。frontmatter（`title:/source:/tags:`）写入 md 头部，DB 与 frontmatter 双写，冲突以文件为准。

## 6. syscall 契约（v1 全集）

请求/响应见 §2.1。以下为 action 清单（⚠=M3 起有、◆=M5 起有、☆=M6+ 占位）。**每个 action 的 zod schema 必须先写进对应域文件并注册后才可调用。**

### 6.1 notes 域
```
notes.list        {filter?:{favorite?,pinned?,later?,unprocessed?,collectionId?,type?,source?},
                   query?, limit?, offset?, sort?:'modified'|'created'|'accessed'|'title'}
                  → {items:[{noteId,title,summary,noteType,noteSource,favorite,pinned,later,
                             processed,modifiedAt,relativePath}], total}
notes.get         {noteId} → {note(全字段), body(正文 markdown), links:{out:[…],in:[…]},
                             collections:[…], resources:[…]}
notes.create      {title?, body?, source?, type?, collectionTitles?:[string]} → {noteId}
notes.update      {noteId, title?, body?} → {ok}      # body 变更走 vault BOW
notes.delete      {noteId} → {ok}                       # 软删 + 文件移入 tombstone
notes.set_status  {noteId, favorite?, pinned?, later?} → {ok}   # 幂等
notes.search      {query, limit?} → {items:[{noteId,title,snippet,bm25}]}   # FTS5
notes.summarize   {noteId} → {summary,keywords,topic}   # AI 处理并回写 processed=1 ⚠
collections.list / create {title,icon?} / rename / delete {collectionId}
collections.add_note    {noteId, collectionId|collectionTitle}   # title 不存在则建
collections.remove_note {noteId, collectionId}
links.list   {noteId} → {out,in}          # in = 反向（他链我）
links.resolve {sourceNoteId, targetText} → {targetNoteId|null}   # 编辑器保存时调用
```

### 6.2 file 域（全部 BOW）
```
file.read   {path(工作区相对)} → {content, stat}
file.write  {path, content} → {ok}          # 快照后写
file.move   {from,to} → {ok}                # 含 rename
file.delete {path} → {ok}                   # → tombstone
file.list   {path?} → {entries:[{path,dir,size,mtime}]}
```

### 6.3 web 域 ⚠
```
web.search {query, count?, freshness?} → {engine, items:[{title,url,snippet}]}
   # 引擎优先级：Brave(key)>Tavily(key)>DuckDuckGo(免费兜底,HTML 解析)
web.get    {url, timeout?} → {title, markdown, siteName}   # readability+turndown
web.get_media {url} ☆ → {markdown(含转写)}                 # M6
```
**错误码**：`UNKNOWN_ACTION|BAD_PAYLOAD|NOT_FOUND|IO_ERROR|PROVIDER_ERROR|NETWORK_ERROR|NO_PROVIDER|ABORTED|INTERNAL`

### 6.4 chart 域 ⚠：`chart.generate {spec(vega-lite JSON)} → {svg}`

### 6.5 llm 域 ⚠：`llm.complete {prompt|messages, modelRole?} → {text}`、`llm.decide {question} → {yes, confidence}`（供摘要/flush 等内部用）

### 6.6 chat 域 ⚠
```
chat.create {noteId?} → {chatId}
chat.list → {items}
chat.messages {chatId, limit?} → {messages}
chat.send {chatId, text} → {ok}            # 流式经 sys:event chat.* 推送；agent loop 内部起
chat.stop  {chatId} → {ok}
chat.delete / chat.rename {chatId,title}
```

### 6.7 mcp 域 ◆：`mcp.servers_list / servers_save {id?,name,command,args,env} / servers_delete / enable {id,enabled} / tools {serverId?} / call {serverId?|toolName, args} / search_tools {query}`（agent 内工具名 `mcp__<server>__<tool>`）

### 6.8 skills 域 ◆：`skills.list / toggle {name,enabled} / reload`

### 6.9 settings 域：`settings.get {keys?} / set {settings}`（白名单键：workspacePath、search.braveKey、search.tavilyKey、ui.language、agent.maxTurns、agent.confirmDestructive…）

### 6.10 vault 域 ⚠：`vault.list {chatId?} → {changes}`、`vault.rollback {changeId | chatId+all:true} → {ok}`

### 6.11 provider 域 ⚠：`provider.list → {items(脱敏)} / save {id,kind,…} / delete / test {id} / chatgpt_login →(OAuth 流,§8.3) / chatgpt_status / chatgpt_logout`

### 6.12 app 域：`app.ping → {pong,version}`、`app.get_workspace / set_workspace {path} / pick_folder / open_path {path} / rebuild_index / reveal_in_finder {path}`、`app.import {paths[]} → {noteIds}`（拖拽导入：md 原样、pdf/docx/pptx→md 转换）

### 6.13 M6+ 占位（命名先定，防止不一致）：`clip.save_url {url}`、`media.transcribe {path}`、`media.ocr {path,regions?}`、`mail.accounts_* / send / sync`、`calendar.accounts_* / search_events`、`office.ppt_* / xls_*`。

## 7. Agent 系统设计

### 7.1 agent loop（`agent/loop.ts`）
```
run(chat, userText):
  1. 组装 messages：system(§7.2) + 记忆摘要 + (chat.noteId ? 笔记上下文) + 历史 + user
  2. provider.stream(messages, tools)
  3. 流式转发 chat.delta；收到 tool_call → 执行 syscall（经 registry，同样校验）→
     结果回填 messages(role=tool) → 继续步骤 2（上限 settings.agent.maxTurns 默认 12）
  4. 结束：chat.done；若产生 vault 变更 → vault.changed
  5. 异步触发 memory.flush(chatId)（防抖 30s，会话静默后）
```
**确认策略**：`file.delete`、`notes.delete`、批量(>5)写操作 → 对话流内显示可读确认卡（对应原作 automation 确认策略的反面：交互场景必须确认）。abort：chat.stop 设置 AbortController。

### 7.2 系统提示词要点（`prompts.ts`，中文）
身份（WhyWork 本地知识库助手）+ 工具使用规范（引用 syscall 文档语义）+ 写文件/笔记必须经工具（禁止编造路径）+ 回答语言跟随用户 + 记忆规则引用（§7.4）。

### 7.3 rVault（`vault.ts`，复刻 BOW）
- `snapshot(kind, op, path)`：写前调用。文件→复制到 `.whywork/vault/snapshots/<changeId>`；笔记→完整 JSON（含 body）。删除→移入 `tombstones/`。写 `vault_changes` 行。
- 回滚：单条或整会话，按逆序逐条校验与执行；返回成功/跳过/失败/需确认结果，不承诺整批文件系统原子性。`rolled_back=1` 幂等；新建文件优先移入系统废纸篓，目录需明确确认。
- 渲染层 VaultPanel 列出本次会话变更 + 一键回滚。

### 7.4 记忆体系（复刻）
`.whywork/memory/`：`MEMORY.md`（写入保留末尾≤12000字；仅 4 类：身份偏好/用户规则/战略决定/教训）、`MEM-YYYYMMDD.md`（当日工作日志，追加式）、`skills/<name>-mem.md`（技能偏好/教训）。flush agent：使用会话显式选择的模型对近期对话提取，quality在离开会话时整理，economy静默30秒后整理，off关闭，遵循原作 skip 规则（无事可记则不写占位）。记忆位于内部目录，通过专门的用户界面读取与编辑。

### 7.5 工具暴露（`tools.ts`）
LLM tools = notes 域(读写) + file 域 + web.* + chart.generate + `llm.decide` + mcp 工具（动态注入）。每个工具 description 来自本文档 §6 的语义行。**不暴露**：provider/settings/vault.rollback（回滚是用户操作）。

## 8. 供应商适配层

### 8.1 接口
```ts
interface ChatProvider {
  id: string; name: string;
  listModels(): Promise<string[]>;
  stream(req: {model:string; messages:Msg[]; tools?:ToolDef[]; signal:AbortSignal},
          emit: (e:StreamEvent)=>void): Promise<{finishReason:'stop'|'tool_use'|'length'}>;
}
type StreamEvent = {type:'text';delta:string}
  | {type:'tool_call'; id:string; name:string; argsJson:string}
  | {type:'usage'; input:number; output:number};
```

### 8.2 openai-compat 实现（DeepSeek/GLM/MiniMax/自定义共用）
默认端点：DeepSeek `https://api.deepseek.com`（模型 deepseek-chat/deepseek-reasoner）；GLM `https://open.bigmodel.cn/api/paas/v4`（glm-4.x）；MiniMax `https://api.minimaxi.com/v1`（abab/MiniMax-Text）。SSE 解析统一；工具调用按 OpenAI `tool_calls` 协议。Anthropic：messages API + `input_json_delta` 流式工具协议。

### 8.3 ChatGPT 登录（官方本地应用动态注册）
依据 2026-10-15 核对的官方文档：
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions

首次以 WhyWork 实际名称和稳定主机UUID进行 `dynamic_agent_client` 注册，不再借用Codex客户端ID。监听127.0.0.1随机端口的固定 `/auth/callback`，每次生成独立state、nonce、PKCE；授权和换码使用完全一致的redirect_uri。官方端点为 `/api/accounts/authorize` 和 `/api/accounts/oauth/token`，令牌请求使用form编码和明确resource。

回调必须提供已签发client_id，返回账号不得替换另一个注册的身份；验证官方JWKS签名、issuer/audience/expiry/nonce和subject后才激活。保存单个当前账号的加密凭据与注册；连接其他账号需单独按钮，验证完成前保留当前账号。套餐权限与身份登录分开显示，缺权限时不推理、不切换计费。模型从账号目录读取，不硬编码过期模型；推理只走公开 `https://api.openai.com/v1/responses`。

取消、超时、重复回调、过期状态均停止当前尝试；旧页面不得复用。刷新按同一会话串行，轮换令牌一并加密保存，invalid_grant要求重新登录。退出调用官方发现文档的撤销端点，远端撤销失败时明确提示用户到ChatGPT设置断开。旧版借用客户端的令牌不自动复用。授权URL、令牌、verifier与原始错误响应不得打印到日志。

验证参数与签名校验不等于实际登录成功；真实账号授权、套餐资格与推理仍须由用户在官方页面和受控预算下验收。

密钥安全：所有 key/token 经 `safeStorage.encryptString` 入库（BLOB），内存中解密使用，日志一律脱敏。

## 9. 编辑器设计（M2）

- **schema**（prosemirror）：doc, paragraph, heading(1-6), blockquote, code_block(lang→CodeMirror6), bullet/ordered_list+list_item, table(GFM), horizontal_rule, image(src 支持 `myremio-res://<noteId>/<file>` 虚拟协议，由 file 协议拦截读资源目录), inline: link, em, strong, code, wikilink(`[[text]]`, attrs{target}), math_inline(`$…$`), math_block(`$$…$$`)。
- **markdown 双向**：prosemirror-markdown + 自定义 markdown-it 插件（wikilink/math token）；保存时序列化回 md 文件（frontmatter 保留）。
- **[[链接]]**：输入 `[[` 触发自定义补全（notes.list 标题索引）；保存时 `links.resolve` 重建 links 表（源笔记全部出链 diff 更新）；未解析链接 target_note_id=NULL，目标笔记创建后自动回填（`notes.create` 后触发 resolve 扫描）。
- 工具栏：加粗/斜体/标题/列表/引用/代码/行内代码/链接/[[链接]]/数学/图片；⌘S 保存（自动保存 800ms 防抖）；阅读/编辑双模式。

## 10. UI 规范（中文优先）

- **布局**：三栏。左 Sidebar(260px)：搜索框、过滤器（全部/收藏/置顶/稍后/未处理）、集合列表、底部设置入口+工作区徽标。中 Content：NotesView(列表+卡片) / EditorView / SettingsView。右 ChatPanel(380px, 可收起)：会话 tab、消息流（含工具调用卡片/确认卡/图表卡片）、输入框+模型档切换。
- **视图**：NotesView（网格/列表切换）、EditorView、ChatView（独立窗口时复用）、SettingsView（Tab：模型供应商/搜索/MCP/技能/工作区/关于）、VaultPanel（ChatPanel 内抽屉）。
- **i18n**：`i18n/zh.ts` 导出 `Record<string,string>` 扁平键（`notes.title` 风格）+ `t()`；组件禁止硬编码文案（日志除外）。
- 状态管理 zustand；暗色模式跟随系统（antd theme algorithm）。

## 11. 里程碑与验收标准

| # | 内容 | 验收（全部可勾选才算完成） |
|---|---|---|
| M0 | 脚手架 | `npm run dev` 打开中文三栏窗口；app.ping 往返；tsc 零错误 |
| M1 | 知识库 | 拖入 md/pdf/docx 生成笔记并入库；FTS 搜索命中；收藏/置顶/集合/双链 CRUD 正确；软删+恢复；rebuild_index 可重建 DB |
| M2 | 编辑器 | 打开/编辑/保存 md 往返无损；[[补全+落库；KaTeX/CodeMirror 渲染；粘贴图片入资源目录并可显示 |
| M3 | Agent | 配置任一 provider 后 chat 流式输出；Agent 经工具创建笔记（vault 面板可见+可回滚）；web.search 兜底可用；会话静默后 memory 文件更新 |
| M4 | 供应商 | 五类 provider 设置+test 通过；ChatGPT 登录→对话成功；仅用户勾选的显式模型可发送；后台任务模型独立指定 |
| M5 | MCP+Skills | 添加 filesystem MCP→agent 能列目录；SKILL.md 出现在技能列表并注入提示词 |
| M6 | 采集 | 剪藏按钮存网页为笔记；全局快捷键唤起；`myremio://import?url=` 可用 |
| M7 | Office | xlsx 在 Univer 窗口查看/编辑保存；docx 双向；pptx AI 生成 |
| M8 | 浏览器 | headless fetch/eval 工具可用（首次自动装浏览器） |
| M9 | 邮件日历 | IMAP 账户同步为笔记；agent 可 send_mail；ICS 日历可搜索 |
| M10 | 媒体 | 本地图片 OCR 入笔记；音视频转写为笔记 |
| M11 | 打包 | dmg 构建签名（ad-hoc）；手机绑定服务骨架（QR 显示+devices 表） |

### 11.1 开发范围与执行计划：R1–R22（2026-10-15）

在 M0～M11 和交接 P2 的既有范围内，按 [CODEX-TASKS-REMIO.md](CODEX-TASKS-REMIO.md) 的22项任务及验收继续开发；[REMIO-COMPARISON.md](REMIO-COMPARISON.md) 提供静态行为依据，[TASKS-HANDOFF.md](TASKS-HANDOFF.md) 维护状态。R 系列代码已接入，当前接口增量见文末 R 契约；验收结果与平台限制分别记录，不将代码存在视为实机通过。

执行顺序：复核已有 D3 成果，先 D4 CI并接入 D6核心检查；A：R1 → R11后台模型 → R5 → R2 → R3 → R4 → R6；B：R7 → R9 → R10 → R8 → R11其余P1内容；C：R14 → R17 → R15 → R18 → R16；D：R12 → R13 → R19 → R20 → R21 → R22。D5随任务更新，D7需macOS交付环境。

采用的默认方案：附件仅导入所选文件到知识库；下载器由用户配置路径；引用精度为笔记与命中片段，不增加语义检索；Agent禁止改写非 manual/text/journal/chat 来源正文，界面编辑保留；系统日历采用Swift/EventKit只读辅助程序，Linux隐藏连接入口。

契约落地顺序：每项实现前更新本文件 §5.2/§6/§7/§10 相应内容，包括 schema、事件、设置白名单和幂等增量迁移，再改代码。R1/R2/R3/R11 已增量迁移 messages.reasoning/refs/sources/usage；R11显式后台模型替代摘要等旧fast角色路由；R5包含局部写入、来源保护与检索/读取增强；R4由主进程生成的可读确认预览及严格白名单override。其余增量契约已按任务书落地，参见文末逐项记录。

本轮不扩展账号会员/积分、云同步与公开云分享、aApp/市场、自动化、结构化数据表、声纹、全局语音输入、第三方办公连接器、复用个人浏览器登录态或Agent shell执行。保留既有ChatGPT供应商授权、本机原生分享扩展和本地录音能力；Android仍独立立项。

remio材料仅用于理解行为：本次依据为静态文档、界面文案和部分REA结果，未证明运行行为，原生模块未核实。不得复制闭源代码、原始提示词、素材或用户数据。每任务跑typecheck、单测、build、smoke；界面任务增补亮暗截图，旧工作区迁移需回归。真实服务、macOS权限和签名包另行验收，原U项条件继续适用。

## 12. 本地开发指南

隔离界面验收：先 `npm run build`，再 `npm run check:ui`（Linux 无显示器时用
`xvfb-run -a npm run check:ui`）。脚本通过 Playwright 启动带 `--ui-check` 的
Electron，仅访问临时工作区；使用 `webContents.capturePage()` 保存各主要视图的
亮/暗截图到 `release/verification/ui/<本次时间>/`，同时记录构建哈希和计算后的颜色令牌。
通过 Electron `nativeTheme.themeSource` 在同一窗口切换主题，验证媒体查询、`.dark`
和 Ant Design 更新；不操作系统设置，不代表 macOS 原生权限或 Remio 逐屏对照通过。

```bash
npm install            # 首次；better-sqlite3 会触发 electron-rebuild（M1 起）
npm run dev            # electron-vite dev（主进程改动自动重启，渲染热更）
npm run typecheck      # tsc -b 三段
npm run build          # 产出 out/
npm test               # vitest run
```
常见问题：原生模块报 ABI 不匹配 → `npx @electron/rebuild -f -w better-sqlite3`；Electron 下载慢 → 确认 `.npmrc` 镜像后 `rm -rf node_modules && npm install`；端口占用（ChatGPT 回调）自动换端口。

## 13. 测试策略

- 单元（vitest，node 环境）：db（建库/触发器/FTS）、syscalls（registry 校验+notes/file 域全 action）、vault（快照/回滚/抵消）、providers（SSE 解析用录制 fixture，不打网络）。
- 集成：agent loop 用 FakeProvider（脚本化 tool_call 序列）验证工具执行与事件流。
- 手动：每个里程碑按 §11 验收清单走查，结果记入 PROGRESS.md。

## 14. 交接须知

- **代码约定**：TS strict；文件 kebab-case；syscall 域文件只导出 `register(domain)`；所有 IPC 载荷必须有 zod schema；禁止 `any` 出现在契约边界。
- **禁止行为**：见 §1.1 Forbidden List；另：不引入登录类依赖（firebase/supabase auth 等）、不做云函数、不为绕过确认策略修改 agent 提示词。
- **生效纪律**：每次修复后判断——`src/renderer/**` 走 HMR 热更；`src/main/**`/`src/preload/**` 改动**直接重启 dev**（pkill electron-vite dev → npm run dev → pgrep 确认），不询问不等确认（用户要求，2026-10-15）。
- **进度纪律**：每完成一个里程碑 → 更新 `docs/PROGRESS.md`（状态、提交说明、遗留、下次入口）；改动架构/契约 → 同步改本文档并在 PROGRESS.md 记 changelog。
- **接手入口顺序**：PROGRESS.md → 本文档 §2/§5/§6（架构与契约）→ 对应里程碑的域代码。

## 本次新增执行契约

- 测试入口 --core-check / --extended-check / --browser-check / --run-cases / --ui-check 在读取配置和创建工作区之前隔离 userData/sessionData。测试只扫描工作区技能。
- --run-cases 仅对72个唯一ID做覆盖登记；MANUAL/BLOCKED不能替代PASS；无真实供应商凭据时不执行真实模型用例。
- notes.list 查询/过滤/排序/计数/分页在SQL层组合；CJK全文匹配不足时提供注明来源的正文子串检索。
- file 域禁止写 notes/，禁止读写 .whywork/.whywork；检查实际符号链接目标。资源协议仅可读取资源或临时图表，不能通过内部别名访问元数据。
- Agent 每次调用独立会话上下文；破坏操作、文件写入、MCP、网页eval、邮件发送及超过5次的写操作须确认；取消会撤销待确认请求。
- MCP独立服务器工具名含稳定唯一哈希和原始工具名后缀；工作区切换关闭连接；环境凭据加密，不继承任意环境密钥。MCP外部操作不能由本地rVault统一撤销，执行前须单独确认。
- Office开文件先复制到 resources/office；保存检测输入版本冲突。XLSX支持值/公式、字体颜色、对齐、数字格式、边框、合并和行列尺寸写回；保留未修改日期/超链接。禁止增删/重排工作表；图表/透视表/宏兼容不承诺。DOCX保留基本Markdown结构和工作区图片，拒绝自动获取远程图片；PPTX以结构化页纲生成。
- mail账户密码系统加密；IMAP/SMTP仅在用户配置后执行，发送展示收件人/主题/正文并确认。
- calendar导入ICS，查询过去30日至未来一年，保留重复事件及例外；拒绝秒/分钟重复避免展开过量。
- 本机配对服务仅127.0.0.1，5分钟令牌单次有效；不提供云同步或Android实现。
- Mac本地交付使用ad-hoc签名，无开发者账号、公证或公开发布。
- 实际视觉对照是独立必需验收，当前工具捕获失败未完成，详见 VISUAL-ACCEPTANCE.md。

官方接口参考：[Univer OSS](https://github.com/dream-num/univer)、[Playwright](https://playwright.dev/docs/api/class-browsertype)、[ImapFlow](https://imapflow.com/docs/)、[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)。

### 2026-10-15 后续修复
- 真实空窗口截图修复根容器高度、暗色文本继承和原生按钮外观；详情删除加入确认，搜索框保持可见条件，导航筛选清空旧查询；事件回调使用当前状态，列表拒绝过期请求覆盖。
- Office表格离开页面/关闭窗口前检查未保存修改；保存中阻止离开。原生分享扩展使用用户选择目录的安全书签，无App Group或网络权限；采集页配置同一目录并持久恢复监控/暂停状态。
- DOCX的Document与Packer使用同一模块实例，避免跨CJS/ESM类身份造成外部链接关系丢失；嵌入图片入库前先校验格式和容量。
- `check:recovery`启动独立Electron进程并执行正常退出/SIGKILL/冷启动检查，仅覆盖已提交数据，不代表断电/未保存缓冲或所有写入中断边界。

### 2026-10-15 检索与录音补全契约
- `notes.list` 可显式指定 `searchMode: fts | text`。FTS5 为索引短语匹配；text 独立读取已入库笔记的本地文件，全部词匹配，支持中文子串，不调用语义模型。保留筛选，标注结果来源/摘要；最多检查最近5000篇、单篇1MB、合计20MB，截断/不可读提示可见。
- `search.choose_folder` 仅接受用户窗口操作，以临时、窗口/工作区绑定的授权标识控制候选查询。候选仅遍历所选目录的文件名和元数据，跳过隐藏目录/符号链接；上限深度12、10000项、1.5秒、50候选。离开候选组件会撤销范围，需重新选择。
- `search.import_candidate` 必须显式触发，重新验证授权与路径后走真实导入；保存来源映射，重复/并发导入去重。候选不是全文或语义索引结果；未点击导入不读取候选正文，不自动索引或调用外部服务。
- 录音状态包含请求设备、录制、暂停、结束、待保存、保存中、已保存和失败；暂停时冻结有效时长，恢复继续累计。取消释放全部轨道，不落盘；保存失败保留内存音频供重试，保存中禁止取消/重复操作。窗口关闭前提示未保存内容。
- `media.save_recording` 仅用户来源，校验MIME、容器头、大小（50MB）与ID，写本地音频并事务生成笔记；同ID同内容幂等，不同内容拒绝。录音保存与付费ASR分离，转写必须单独点击且配置服务。
- `--ui-check` 独立工作区提供真实WebAudio合成源，通过实际MediaRecorder链路验收；正常产品界面不显示合成按钮。`--feature-check` 在隔离工作区验证检索/授权边界，可通过 `WHYWORK_FEATURE_AUDIO_FIXTURE` 指定本轮真实录制的测试WebM，验证保存幂等与读回。合成验证不能替代麦克风/系统音频的设备权限验收。
- 渲染CSP仅为本地媒体增加 `blob:` 和既有资源协议支持，允许录音预览；不允许远程媒体自动加载。暗色编辑链接颜色修复纳入同次构建。


## 2026-10-15：具体模型选择与三类提供商设置（当前契约）

- 模型设置参照用户 Library 截图 `libfile_f8d7ca1f1e0c8191bee121e4f5d2343b` 的像素：标题、横向三项入口、说明条、提供商行、配置/更多操作、添加按钮。原 remio 入口改为 Codex，承接 WhyWork 自身动态注册的 ChatGPT 授权；自定义 API 密钥选择现有已知供应商预设；自定义供应商使用 OpenAI 兼容协议，允许名称、Base URL、模型 ID 和用户密钥。行首开关表示启用/停用；实际聊天模型在聊天区选择，不伪装全局单选供应商。
- `provider.models {refresh?:boolean}` 返回按供应商分组的目录：`id/name/enabled/ready/status/models[{id,label,source}]/checkedAt`。仅读取目录，不执行推理。内存缓存五分钟，按工作区与配置隔离；设置变化和手动刷新重新读取。无密钥、停用、未授权项目不可选。失败返回通用状态，避免回显供应商返回的敏感信息。
- OpenAI 兼容与 Anthropic 从 `/models` 读取实际 ID；既有 fast/expert/default 配置兼容汇总，对话可选目录仅来自用户配置的模型 ID（兼容 fast/expert/default 字段），全部标记 configured；在线发现不自动增加或移除勾选项。未勾选的模型即使在线发现也不可发送。ChatGPT 候选按 `models[].slug/display_name/visibility` 解析，保序、仅 list 可见；请求发送 slug。候选目录返回不等于推理权限已通过。
- 新增幂等 `chat_models(chat_id,provider_id,model)` 表，保留旧 chats/model_role 和所有 providers 配置。旧会话没有显式选择时提示重新选择，不自动迁移到其他供应商。目录刷新、OAuth 令牌轮换/重新授权不覆盖已有模型设置；未填新密钥时保留原加密密钥；已有自定义提供商保持原 ID，修改 URL 不生成重复记录。
- `chat.create` 可携带 selection；`chat.set_model` 必须携带 `{chatId,selection:{providerId,model}}`；`chat.send` 同样携带 selection，并与持久化会话选择比对、验证启用与目录状态。Agent 接收显式 providerId/model，禁止角色覆盖/备用供应商回退。回复期间主进程与 UI 均阻止切换。自动记忆整理沿用该会话选择；切换模型清除旧整理计时器。
- 渲染层选择草稿不会创建空会话；打开旧会话恢复其选择；同名供应商用 ID 区分。异步目录、会话历史加载丢弃过期结果；切换会话后原待发送内容不会发送到另一会话。模型失效、空目录、刷新失败均显示提示。
- 官方目录依据：https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference 。Codex 是用户要求的设置标签，不使用官方 Codex OAuth client，也不表示官方背书。
- 验证入口：`--model-check` 仅在独立临时 profile/workspace 中运行 loopback HTTP 目录与聊天请求；`--ui-check --model-ui-fixture` 加载三个合成供应商用于安全界面验收。所有真实账户/推理验收另行执行。

## R 系列实施契约（2026-10-15，实施中）

- D4/D6：PR/main 的 macOS CI 使用隔离工作区跑 typecheck、单测、build、smoke、core/model检查、72项离线登记与UI截图。Node单测和Electron运行前分别重编译SQLite ABI。无凭据项目保留BLOCKED；FAIL或进程非零使CI失败。CI落盘不等于远端已运行通过。
- R1：messages 增量增加 reasoning TEXT；每个助手响应落盘推理文本并发送 chat.reasoning。兼容供应商解析 reasoning_content，Anthropic解析thinking_delta。界面只展示供应商实际返回内容。共享markdown-it/KaTeX/DOMPurify渲染笔记和回复，失败回退纯文本，代码块高亮；复制返回Markdown原文。
- chat.regenerate {chatId,selection,acknowledgeChanges?:boolean}：仅用户可调用；运行中拒绝；选择必须与会话一致并有效。删除最后一条用户消息后的助手/工具记录，复用该用户记录重跑，不重复新增用户消息。有未回滚快照时必须先明确确认 acknowledgeChanges；不自动撤销笔记/文件。删除历史和启动之间不允许异步间隙引入重复生成。
- R11后台模型：settings 的 ai.backgroundModel 保存 JSON 字符串 {providerId,model}（null表示未设置），沿用现有字符串设置传输；写入及每次执行均校验显式模型。oneShot/llm.complete/llm.decide/notes.summarize 使用此配置，旧modelRole参数仅兼容接收而不再选模；llm.summarize作为notes.summarize的兼容入口。未设置不隐式回退。对话记忆仍沿用其会话显式选择。

### R5 笔记工具契约（代码已接入）
- notes.update 增加 edits[{oldText,newText}] / append，与body互斥；定位全部基于同一原文，唯一且不重叠，精确失败后只容许逐行首尾空白归一化匹配。错误标识条目序号，整组先验证再写入一次快照。append空白拒绝，段落空行分隔。创建/整体替换剥离与标题相同的首行H1。
- 来源保护在syscall执行层检查ctx.source，Agent只能改manual/text/journal/chat正文；用户界面不受此限制。notes.get新增offset/limit按行分页，offset从1起，负数倒数，返回totalLines；不提供分页参数时保留完整正文兼容编辑器。
- notes.search新增timeFrom/timeTo（有效YYYY-MM-DD，本地午夜半开修改时间区间）、types/sources/status/collection/sort；默认20上限100，返回total/showing及类型来源、片段、时间、集合状态，保留旧snippet/source字段。notes.list同步支持多来源/类型与修改时间范围供R9复用。
- notes.set_status返回applied；collections.add_note/remove_note兼容转发现有集合域，新增集合时返回createdCollection；所有关系/状态变更保留笔记元数据快照。notes.attach_image允许工作区path或界面dataUrl二选一，Agent只能path；资源复制也留快照。
- file.read_document仅工作区PDF/DOCX/PPTX/XLSX，复用导入器的只读转换，缓存键包含规范路径、mtime、size；缓存放.whywork/tmp，输出有字符预算和截断提示，不自动导入、不改外部文件。

### R2/R3 对话上下文与来源（代码已接入）
- chat.send增加refs:{noteIds≤10,skills≤3}及useKnowledge默认true；messages增量加refs/sources TEXT。发送前校验笔记存在且未删除、技能已启用；笔记单篇8000字符/总24000，显式截断提示；指定技能优先注入，单技能8000字符。再生成沿用最后用户消息refs与useKnowledge（后者存入refs对象以兼容迁移）。
- app.pick_files仅用户窗口可调用，原生多选，返回paths/canceled；附件经现有app.import入库，仅所选文件。网页经clip.save_url黑名单入口，导入结果作为显式引用。
- 每轮SourceRegistry对refs及notes.search/get/list结果去重编号，工具结果前加来源说明；仅保存真实工具返回的noteId/title/snippet。助手消息保存sources并发chat.sources{chatId,msgId,sources}。模型提示只标注已登记编号。关闭知识库时不暴露也拒绝检索/读取类工具，显式refs仍注入。
- Markdown引用规则只处理普通行内文本，不处理代码块/行内代码；只为登记编号生成可点击角标，忽略无效编号。点击在详情显示并标记命中段落，片段未能定位时仍打开笔记并展示引用片段，不宣称语义逐句定位。

### R4 确认卡
- 主进程按操作生成preview{kind,title,fields,body?,warnings?,editable?}，邮件允许to/cc/bcc/subject/text/accountId，映射账户id后按原mail.send schema重新校验；其他操作不接受override。确认与会话ID绑定、同会话只保留一个待确认请求；拒绝、超时、停止均不会执行工具。
- chat.confirm action新增override；chat.confirm_resolved事件携带id/chatId/state/preview，state为allowed/denied/cancelled。chat_confirmations表保存预览及决定（不保存凭据）；chat.confirmations{chatId}恢复历史卡片。发送邮件新增cc/bcc邮箱列表，仍须显式确认；工作工具复用MailPreview组件。

### R6 会话管理（代码已接入）
- chat.list{query?,limit:1..500=100,offset≥0=0}返回items/total，按标题字面包含搜索；chat.delete在会话运行中拒绝，不再以删除隐式停止。chat.rename将chats.auto_title置0，保护用户命名。
- chats增量加auto_title INTEGER DEFAULT 1，显式创建标题及重命名为0。首轮成功且chat.autoTitle!='false'时尝试后台模型生成≤16字标题；后台未配置/失败保留原自动截取标题。写回检查工作区、原题和auto_title未变，成功发chat.renamed。侧栏提供搜索、更多分页、行内重命名与可见删除确认入口。

### R7/R9/R10/R8 批次B契约（代码已接入）
- vault.list补充type/noteTitle/originalPath/activeCount；vault.rollback返回rolledBack兼容字段及restored/skipped/remaining。新增目录若含子项先返回needsConfirm，confirm后执行。新建项回滚经系统废纸篓；单项失败保留日志并报告原因，会话批量按逆序逐项执行，不宣称跨文件全局原子。回滚仅用户操作。
- notes.list多类型/来源/修改时间与排序可组合。notes.batch_set_status/batch_delete/batch_restore、collections.batch_add最多500项，返回逐项success/failed；SQLite批量元数据操作事务提交，涉及文件的删除/恢复逐项使用既有快照与补偿，不把文件系统宣称为SQL事务。
- llm.summarize改为可取消的后台任务，当前工作区内同笔记防重复；notes.related关键词FTS，排除自身/软删，默认5上限10。summarize_batch_start返回batchId并串行执行，summarize.progress发进度/失败列表，取消不撤销已完成条目。
- 个性化设置profile.nickname/role/instructions（≤2000）、ai.responseLanguage、memory.mode（quality/economy/off）。明确语言进入提示词而不主动写入记忆；quality离开会话时仅整理未处理消息，economy只静默整理，off禁用。memory.read/update/clear仅用户，固定长期/当日日志，不接受任意路径；界面提供文本编辑，清空需确认。记忆提示排除运行时可查询状态；迁移技能记忆先写成功再删源。

### R11 剩余契约（代码已接入）
- search.mode 为 basic/smart/hq_first，默认 basic。basic 只用 DuckDuckGo；smart 不足3条才补配置引擎；hq_first 配置引擎无结果或失败再回退。无Key设置增强模式拒绝并保留普通模式。web.verify_key仅用户主动触发一次查询，使用已保存密钥，不返回密钥。
- 助手消息 usage 保存本次模型调用输入/输出 token；未知用量不伪造。模型错误分类覆盖认证、限流/过载、网络、上下文长度，并保留取消语义。
- memory_flush 增量表记录各会话已整理消息 rowid；chat.leave 仅quality模式触发，off在请求前及写回前检查。memory.update须传previous进行乐观并发校验。

### R14 目录同步（代码已接入）
- watch_folders增量增加state/imported/failed/last_scan_at；state为scanning/importing/watching/paused/error，watch.changed推送结构化状态。status保留中文说明。
- folders_add规范化realpath；重复与子目录返回WATCH_DUPLICATE/WATCH_COVERED错误。上级目录返回needsConfirm含children，confirmMerge=true后停止子监控、等待在途扫描并迁移watch_items，防止重复导入。拒绝工作区相关目录、主目录根与系统目录。
- watch.suggested_folders仅读取存在的下载/文稿/桌面路径；添加后才扫描。EACCES/EPERM附系统隐私权限指引。

### R15 全局快捷键（代码已接入）
- shortcuts.focusChat/newNote使用Electron accelerator字符串；必须含Command/Control/Alt（含CommandOrControl别名），两项不能相同；系统常见组合拒绝并给出冲突说明。
- settings.set先验证并尝试注册候选组合，失败恢复旧注册且不写设置；成功后写库。测试模式只验证配置，不注册系统快捷键；macOS实际占用、权限与唤起需实机验收。

### R17 录音与转写（代码已接入）
- media.transcriptionLanguage（zh-CN/en-US/auto）、media.dictionary（每行词语≤10000字符）；词典作为兼容ASR prompt，纪要也注入词典与要点。save_recording增加keyPoints/segmentOf/segmentIndex/language；短于1秒拒绝；同ID内容/元数据一致幂等。
- saved_recordings增量增加key_points/language/segment_of/segment_index/transcript_note_id/minutes_note_id。media.pending_transcriptions返回存在且未转写的录音。转写单独触发、同录音防并发，成功立即创建meeting_transcript并通过links关联；纪要单独使用后台模型生成，可失败重试，不回滚音频或转写。
- media.generate_minutes{recordingNoteId,template:general/interview/lecture}流式发送media.minutes{recordingNoteId,delta,finished,error?}，media.cancel_minutes中断；生成成功更新/创建meeting_overview并互链三条笔记，失败保留旧纪要。

### R18 OCR索引（代码已接入）
- resource_ocr(resource_id主键/资源外键,text,items,engine,created_at)增量表；media.ocrEnabled默认开启。资源OCR串行队列，工作区切换/资源删除时丢弃旧结果；不下载语言模型，缺失本地语言包时报告错误。
- 笔记Markdown引用的本地图片登记资源并入队；索引追加“图片文字”及OCR结果，移除引用后移除关联资源索引。notes.get补充images；media.ocr_status{noteId}提供队列/完成/失败状态供详情显示。
- 无文本PDF导入时复制原件到本笔记资源目录，后台逐页渲染后OCR（最多200页，逐页限像素）；保留原PDF，结果进入索引，不改写来源正文。

### R16 在线音视频（代码已接入）
- media.downloaderPath为用户指定可执行文件绝对路径，仅以spawn参数数组调用、不运行shell；未配置即明确拒绝。media.add_urls{urls:1..10}持久化media_jobs并按串行队列处理；jobs/cancel_job/retry_job可查询/取消/重试，media.job广播状态。
- 每任务只处理一集，优先下载vtt字幕，无字幕才下载bestaudio并调用ASR；状态waiting/parsing/downloading/transcribing/minutes/done/failed/cancelled。主笔记在解析后落盘，取消保留；重试复用已创建笔记。进程输出与下载文件限定工作区资源目录，子进程可中止。
- 产出主笔记、转写稿、后台模型概览；概览失败不删除前两者。web.get_media作为单URL兼容入口，仅创建任务，不同步返回完整正文。

### R12 MCP（代码已接入）
- mcp_servers增量transport/url/token_enc/token_header；HTTP使用SDK StreamableHTTP，token经safeStorage存储，不在servers_list返回。servers_save兼容stdio并校验URL/请求头；test_connection返回工具数与分类错误。
- mcp.directToolLimit默认40；超过阈值只注入search_tools/list_tools/call三个元工具及服务器名称。search_tools返回无schema的预览和逐服务器errors；list_tools返回完整schema并支持分页；call兼容旧toolName/args及serverId/toolName/arguments，仍走确认卡。

### R13 技能库（代码已接入）
- skills.read{name}返回扫描可见技能原始Markdown；skills.add{dir}仅用户操作，校验SKILL.md frontmatter非空name/description，名称限定安全目录名，拒绝同名与符号链接，限制文件数量/容量后复制到工作区.whywork/skills/name。
- skills.remove{name,confirmed?:true}仅用户，移到系统废纸篓，不永久删除；移除后重新扫描。全局技能显式列出来源，删除同样需确认；界面搜索与详情安全Markdown预览。

### R19 Office（代码已接入）
- office.xlsx_summary{path}返回工作表名/行列数/表头样例；xlsx_read{path,sheets?,offset≥1=1,limit≤1000=100}多表共享20000字符预算，返回remaining/nextOffset。仅工作区.xlsx，文件≤50MB。
- office.ai_slides改为返回title/slides页纲，不自动生成文件；office.slides新增theme:blue/forest/ink，按用户编辑页纲生成PPTX。字体Windows使用Microsoft YaHei、macOS PingFang SC、Linux Noto Sans CJK SC，实际字体显示取决于打开PPTX的设备已安装字体。

### R20 邮件（代码已接入）
- mail.send附件仅工作区文件，单个≤20MB/合计≤25MB，cc/bcc沿用R4；确认卡展示附件路径与数量。认证/网络/TLS/发件拒绝分类，不返回凭据。
- mail_failed保存失败发件参数、分类错误与时间；mail.failed列出、mail.retry{id,confirmed:true}显式重试且复验附件；不后台自动重发。账户移除增加removeNotes默认false，true时将该账户已导入笔记经快照移入回收站。

### R21/R22 平台与配对（代码已接入）
- calendar.search统一query/start/end（日期左闭右开）/calendarIds/sort/limit，默认当前时间前后各一年、limit20上限100；ICS结果source=ics，系统source=system。兼容旧from/to毫秒参数。系统事件只在已授权时读取，权限仅calendar.connect_system用户点击请求。
- Swift/EventKit helper仅macOS构建与打包；calendar.system_status返回supported/authorization，Linux入口隐藏。无创建/编辑/删除事件操作。macOS权限、签名与真实日历验收未在Linux通过。
- pair.start绑定本窗口事件上下文，成功广播pair.bound{deviceId,name}；二维码倒计时到期覆盖与刷新，解绑确认。现有loopback开发配对范围不扩为局域网/Android同步。

- R2标题候选：notes.list新增titleQuery（≤200字），仅匹配标题并在分页前过滤；聊天@候选使用该字段，正文命中不进入候选。

- R4批量卡显示本轮写操作请求数、前5项目标及当前待确认内容；串行工具调用下每张卡只批准当前操作。邮件附件在预览中只读显示，不在override白名单。
- R16首次打开任务表时，将上次进程中断的活动任务标记为失败并提供手动重试，保留已生成笔记。

- R10批量摘要按当前sources/修改日期/集合及query/searchMode筛选全部未处理笔记；无500条截断。开始时冻结目标列表，仍串行执行且可取消。
