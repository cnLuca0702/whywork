import fs from 'node:fs'
import crypto from 'node:crypto'
import {shell} from 'electron'
import {resolveWorkspacePath} from '../security/paths'
import {sha256} from '../db/notes-file'
import {getDb} from '../db/client'
import { z } from 'zod'
import { register } from './registry'
import { listChanges, rollbackChange } from '../agent/vault'

/** vault 域：变更列表与回滚（DEVELOPMENT.md §6.10；面板 UI 于 M3） */
export function registerVaultDomain(): void {
  register('vault', {
    list: {
      schema: z.object({ chatId: z.string().optional() }),
      handler: async (p: { chatId?: string }) => {
        const changes=listChanges(p.chatId).map(row=>{const detail=JSON.parse(row.detail??'{}');const target=resolveWorkspacePath(row.path);return {...row,type:detail.relation?'note-collection':row.kind==='note'?'note':fs.existsSync(target)&&fs.statSync(target).isDirectory()?'dir':'file',noteTitle:detail.previousNote?.title??detail.title??(detail.noteId?(getDb().prepare('SELECT title FROM notes WHERE note_id=?').get(detail.noteId) as {title:string}|undefined)?.title:undefined),originalPath:row.op==='rename'?row.path:undefined}})
        return {changes,activeCount:changes.filter(c=>!c.rolled_back).length}
      }
    },
    rollback: {
      schema:z.object({changeId:z.string().optional(),chatId:z.string().optional(),all:z.boolean().optional(),confirm:z.boolean().default(false)}).refine(p=>!!p.changeId||!!p.chatId,'需要变更或会话ID'),
      handler:async(p:{changeId?:string;chatId?:string;confirm:boolean},ctx)=>{
        if(ctx.source==='agent')throw new Error('保险箱回滚仅可由用户操作')
        const rows=(p.changeId?(getDb().prepare('SELECT * FROM vault_changes WHERE change_id=?').all(p.changeId) as import('../agent/vault').VaultChange[]):listChanges(p.chatId)).filter(c=>!c.rolled_back).reverse()
        const restored:string[]=[],skipped:{changeId:string;reason:string}[]=[]
        if(p.changeId&&!rows.length)skipped.push({changeId:p.changeId,reason:'变更不存在或已回滚'})
        for(const row of rows){
          let backup:string|undefined
          try{
            const target=resolveWorkspacePath(row.path)
            if(row.op==='create'&&fs.existsSync(target)){
              if(getDb().prepare('SELECT 1 FROM vault_changes WHERE path=? AND rolled_back=0 AND rowid>(SELECT rowid FROM vault_changes WHERE change_id=?)').get(row.path,row.change_id))throw new Error('存在较新变更，请先回滚')
              if(fs.statSync(target).isDirectory()&&!p.confirm){
                const nestedItems=fs.readdirSync(target).slice(0,500)
                if(nestedItems.length)return {rolledBack:restored.length,restored,skipped,remaining:rows.length-restored.length,needsConfirm:{changeId:row.change_id,nestedItems}}
              }
              const note=getDb().prepare('SELECT content_hash FROM notes WHERE relative_path=?').get(row.path) as {content_hash:string|null}|undefined
              if(note?.content_hash&&fs.statSync(target).isFile()&&sha256(fs.readFileSync(target,'utf8'))!==note.content_hash)throw new Error('文件包含未入库修改，未执行回滚')
              backup=resolveWorkspacePath('.whywork/tmp/rollback-'+crypto.randomUUID(),true)
              fs.cpSync(target,backup,{recursive:true,dereference:false})
              await shell.trashItem(target)
            }
            if(rollbackChange(row.change_id))restored.push(row.change_id)
          }catch(error){
            if(backup&&fs.existsSync(backup)&&!fs.existsSync(resolveWorkspacePath(row.path)))fs.cpSync(backup,resolveWorkspacePath(row.path),{recursive:true,dereference:false})
            skipped.push({changeId:row.change_id,reason:error instanceof Error?error.message:String(error)})
          }finally{if(backup)fs.rmSync(backup,{recursive:true,force:true})}
        }
        const remaining=listChanges(p.chatId).filter(c=>!c.rolled_back).length
        ctx.emit('vault.changed',{chatId:p.chatId,activeCount:remaining,rolledBack:restored.length})
        ctx.emit('notes.changed',{kind:'vault-rollback'})
        return {rolledBack:restored.length,restored,skipped,remaining}
      }
    }
  })
}
