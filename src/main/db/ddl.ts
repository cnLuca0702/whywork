/** 数据库 DDL（DEVELOPMENT.md §5.2 的真身；幂等，启动时执行） */

export const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS notes (
    note_id        TEXT PRIMARY KEY,
    title          TEXT NOT NULL DEFAULT '',
    parsed_title   TEXT,
    summary        TEXT,
    keywords       TEXT,
    topic          TEXT,
    author         TEXT,
    note_type      TEXT NOT NULL DEFAULT 'normal_note'
      CHECK (note_type IN ('normal_note','collection','file','folder','mail','meeting','parsed_content','slack')),
    note_source    TEXT NOT NULL DEFAULT 'manual'
      CHECK (note_source IN ('manual','text','journal','page','image','audio','video','pdf','word','ppt','ppl',
                             'mail_message','mail_session','meeting_recording','meeting_transcript','meeting_overview',
                             'slack_message','slack_channel','slack_workspace','organization','pre_defined_prompt','chat')),
    relative_path  TEXT NOT NULL UNIQUE,
    resource_dir   TEXT,
    favorite       INTEGER NOT NULL DEFAULT 0,
    pinned         INTEGER NOT NULL DEFAULT 0,
    later          INTEGER NOT NULL DEFAULT 0,
    processed      INTEGER NOT NULL DEFAULT 0,
    restrictions   TEXT,
    content_hash   TEXT,
    created_at     INTEGER NOT NULL,
    modified_at    INTEGER NOT NULL,
    accessed_at    INTEGER NOT NULL,
    deleted_at     INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at)`,

  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL UNIQUE,
    icon TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS note_collections (
    note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (note_id, collection_id)
  )`,

  `CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    source_note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    target_note_id TEXT REFERENCES notes(note_id) ON DELETE CASCADE,
    target_text TEXT NOT NULL,
    ext TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (source_note_id, target_text)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_note_id)`,

  `CREATE TABLE IF NOT EXISTS resources (
    resource_id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chats (
    chat_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '新对话',
    note_id TEXT REFERENCES notes(note_id) ON DELETE SET NULL,
    model_role TEXT NOT NULL DEFAULT 'fast' CHECK (model_role IN ('fast','expert')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chat_models (
    chat_id TEXT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    msg_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
    content TEXT,
    tool_calls TEXT,
    tool_result TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('openai-compat','anthropic','chatgpt')),
    name TEXT NOT NULL,
    base_url TEXT,
    api_key_enc BLOB,
    models TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    extra TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    command TEXT,
    args TEXT,
    env TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    tools_cache TEXT,
    status TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('workspace','global')),
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS vault_changes (
    change_id TEXT PRIMARY KEY,
    chat_id TEXT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file','note')),
    op TEXT NOT NULL CHECK (op IN ('create','modify','delete','rename')),
    path TEXT NOT NULL,
    snapshot_path TEXT,
    detail TEXT,
    rolled_back INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    name TEXT,
    platform TEXT,
    pubkey TEXT,
    paired_at INTEGER,
    last_seen INTEGER
  )`,

  // FTS5：独立内容表（正文在磁盘文件，notes 表不含 body，故不用 external content）
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, summary, keywords, body,
    tokenize = 'unicode61'
  )`
]
