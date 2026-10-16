import {expect,it} from 'vitest'
import Database from 'better-sqlite3'
import {DDL_STATEMENTS,migrateDb} from '../src/main/db/ddl'
import {regenerationTurn,discardLastResponse} from '../src/main/agent/regenerate'
it('migrates old workspaces repeatedly without changing history and removes only the last response',()=>{
 const db=new Database(':memory:')
 try {
  for(const sql of DDL_STATEMENTS)db.exec(sql)
  db.prepare("INSERT INTO chats(chat_id,title,created_at,updated_at) VALUES ('c','original',1,1)").run()
  const insert=db.prepare('INSERT INTO messages(msg_id,chat_id,role,content,created_at) VALUES (?,\'c\',?,?,1)')
  for(const [id,role] of [['u1','user'],['a1','assistant'],['u2','user'],['a2','assistant'],['t2','tool'],['a3','assistant']])insert.run(id,role,id)
  migrateDb(db);migrateDb(db)
  const turn=regenerationTurn(db,'c')
  expect(turn.content).toBe('u2')
  discardLastResponse(db,'c',turn.rowid)
  expect(db.prepare('SELECT msg_id FROM messages ORDER BY rowid').all()).toEqual([{msg_id:'u1'},{msg_id:'a1'},{msg_id:'u2'}])
  expect(()=>regenerationTurn(db,'missing')).toThrow('没有')
  insert.run('u3','user','later')
  expect(()=>discardLastResponse(db,'c',turn.rowid)).toThrow('变化')
 }finally{db.close()}
})
