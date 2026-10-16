import {useEffect,useState} from 'react'
import {Modal,Select,message} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
let recent:string[]=[]
export default function CollectionPicker({noteIds,onClose}:{noteIds:string[];onClose:()=>void}){
 const [items,setItems]=useState<{id:string;title:string}[]>([]),[value,setValue]=useState<string>(),[busy,setBusy]=useState(false)
 useEffect(()=>{void sys<{items:{id:string;title:string}[]}>('notes.collections_list').then(r=>setItems(r.items)).catch(e=>message.error(String(e)))},[])
 return <Modal open title={t('notes.addCollection')} confirmLoading={busy} onCancel={()=>!busy&&onClose()} okButtonProps={{disabled:!value?.trim()}} onOk={async()=>{
  if(!value?.trim()||busy)return;setBusy(true)
  try{const existing=items.find(i=>i.title===value);const r=await sys<{success:string[];failed:{reason:string}[];collectionId:string}>('collections.batch_add',{noteIds,...(existing?{collectionId:existing.id}:{collectionTitle:value.trim()})});recent=[r.collectionId,...recent.filter(id=>id!==r.collectionId)].slice(0,5);if(r.failed.length)message.warning(r.failed.map(f=>f.reason).join('；'));else message.success(t('notes.batchDone',{n:r.success.length}));onClose()}catch(e){message.error(String(e))}finally{setBusy(false)}
 }}><Select showSearch mode="tags" value={value?[value]:[]} style={{width:'100%'}} placeholder={t('notes.collectionHint')} onChange={v=>setValue(v.at(-1))} options={[...items.filter(i=>recent.includes(i.id)),...items.filter(i=>!recent.includes(i.id))].map(i=>({value:i.title,label:(recent.includes(i.id)?'★ ':'')+i.title}))}/></Modal>
}
