import {useEffect,useState} from 'react'
import {Button,Drawer,Modal,Tag,message} from 'antd'
import {sys,useSysEvent} from '../api'
import {t} from '../i18n/zh'
interface Change {change_id:string;path:string;noteTitle?:string;originalPath?:string;type:'note'|'file'|'dir'|'note-collection';op:'create'|'modify'|'delete'|'rename';rolled_back:number}
interface Result {restored:string[];skipped:{changeId:string;reason:string}[];remaining:number;needsConfirm?:{changeId:string;nestedItems:string[]}}
/** 保险箱抽屉：两行布局避免内容被截断（U-01）——第一行类型/操作与标题，第二行时间/原路径与操作按钮 */
export default function VaultPanel({open,onClose,chatId}:{open:boolean;onClose:()=>void;chatId:string|null}){
 const [rows,setRows]=useState<Change[]>([]),[busy,setBusy]=useState(false)
 const load=()=>{if(chatId)void sys<{changes:Change[]}>('vault.list',{chatId}).then(r=>setRows(r.changes)).catch(e=>message.error(String(e)));else setRows([])}
 useEffect(load,[chatId,open]);useSysEvent('vault.changed',load)
 const rollback=async(changeId?:string,confirm=false)=>{
  setBusy(true)
  try{
   const r=await sys<Result>('vault.rollback',{changeId,chatId,all:!changeId,confirm})
   if(r.needsConfirm){Modal.confirm({title:t('vault.directoryConfirm'),content:<pre>{r.needsConfirm.nestedItems.join('\n')}</pre>,okText:t('common.confirm'),cancelText:t('common.cancel'),onOk:()=>rollback(r.needsConfirm!.changeId,true)});return}
   Modal.info({title:t('vault.result',{restored:r.restored.length,skipped:r.skipped.length,remaining:r.remaining}),content:<div><p>{t('vault.trashHint')}</p>{r.skipped.map(s=><p key={s.changeId}>{s.reason}</p>)}</div>});load()
  }catch(e){void message.error(String(e))}finally{setBusy(false)}
 }
 return <Drawer title={t('vault.title')} open={open} onClose={onClose} width={440}>
  {(['note','file','dir','note-collection'] as const).map(type=>{
   const group=rows.filter(r=>r.type===type);if(!group.length)return null
   return <section key={type}><h3>{t(`vault.${type}`)}</h3>{group.map(r=><div key={r.change_id} className="my-2 rounded border border-[var(--ww-border)] p-2">
    <div className="flex min-w-0 items-center gap-1">
     <Tag className="m-0 shrink-0">{t(`vault.${r.op}`)}</Tag>
     <span className="min-w-0 flex-1 truncate" title={r.noteTitle??r.path}>{r.noteTitle??r.path}</span>
     {r.rolled_back?<Tag className="m-0 shrink-0">{t('vault.restored')}</Tag>
      :<span className="shrink-0"><Button size="small" disabled={busy} onClick={()=>void rollback(r.change_id)}>{t('vault.restore')}</Button></span>}
    </div>
    {r.originalPath&&<p className="mb-0 mt-1 truncate text-xs text-[var(--ww-text-3)]" title={r.originalPath}>{r.originalPath}</p>}
   </div>)}</section>
  })}
  <Button danger block disabled={!chatId||busy||!rows.some(r=>!r.rolled_back)} onClick={()=>void rollback()}>{t('vault.all')}</Button>
 </Drawer>
}
