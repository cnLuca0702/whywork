import Database from 'better-sqlite3'
import path from 'node:path'
import { getWorkspacePath } from '../syscalls/app'
import { DDL_STATEMENTS } from './ddl'

/** better-sqlite3 单例（工作区范围 <ws>/.whywork/whywork.db，WAL） */

let db: Database.Database | null = null

export function dbPath(): string {
  return path.join(getWorkspacePath(), '.whywork', 'whywork.db')
}

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const stmt of DDL_STATEMENTS) db.exec(stmt)
  return db
}

/** 切换工作区后调用：关闭旧连接，下次 getDb 重新打开 */
export function resetDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** 测试/自检用：在指定路径建内存外的临时库 */
export function openDbAt(file: string): Database.Database {
  const d = new Database(file)
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  for (const stmt of DDL_STATEMENTS) d.exec(stmt)
  return d
}
