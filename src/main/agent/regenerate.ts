import type Database from 'better-sqlite3'

/** Keep the final user turn and all earlier history; only discard its responses. */
export function regenerationTurn(db: Database.Database, chatId: string): { rowid: number; content: string } {
  const user = db.prepare("SELECT rowid, content FROM messages WHERE chat_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(chatId) as {rowid:number;content:string}|undefined
  if (!user) throw new Error('没有可重新生成的用户消息')
  return user
}
export function discardLastResponse(db: Database.Database, chatId: string, rowid: number): void {
  if (regenerationTurn(db, chatId).rowid !== rowid) throw new Error('会话已变化，请重试')
  db.prepare("DELETE FROM messages WHERE chat_id=? AND rowid>? AND role IN ('assistant','tool')").run(chatId, rowid)
}
