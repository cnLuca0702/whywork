import {useEffect,useState} from 'react'
import {Input,Modal,message} from 'antd'
import {SearchOutlined,PlusOutlined,StarFilled} from '@ant-design/icons'
import {sys} from '../api'
import {t} from '../i18n/zh'
let recent:string[]=[]
/** 加入集合弹窗：集合列表直接展开在弹窗内，可搜索并可新建（U-02，替代会被截断的下拉） */
export default function CollectionPicker({noteIds,onClose}:{noteIds:string[];onClose:()=>void}){
 const [items,setItems]=useState<{id:string;title:string}[]>([]),[query,setQuery]=useState(''),[value,setValue]=useState<string>(),[busy,setBusy]=useState(false)
 useEffect(()=>{void sys<{items:{id:string;title:string}[]}>('notes.collections_list').then(r=>setItems(r.items)).catch(e=>message.error(String(e)))},[])
 const filtered=items.filter(i=>!query.trim()||i.title.toLowerCase().includes(query.trim().toLowerCase()))
 const canCreate=!!query.trim()&&!items.some(i=>i.title===query.trim())
 const pick=(title:string)=>setValue(v=>v===title?undefined:title)
 return <Modal open title={t('notes.addCollection')} confirmLoading={busy} onCancel={()=>!busy&&onClose()}
  okText={t('common.confirm')} cancelText={t('common.cancel')} okButtonProps={{disabled:!value?.trim()}}
  onOk={async()=>{
   if(!value?.trim()||busy)return;setBusy(true)
   try{const existing=items.find(i=>i.title===value);const r=await sys<{success:string[];failed:{reason:string}[];collectionId:string}>('collections.batch_add',{noteIds,...(existing?{collectionId:existing.id}:{collectionTitle:value.trim()})});recent=[r.collectionId,...recent.filter(id=>id!==r.collectionId)].slice(0,5);if(r.failed.length)message.warning(r.failed.map(f=>f.reason).join('；'));else message.success(t('notes.batchDone',{n:r.success.length}));onClose()}catch(e){message.error(String(e))}finally{setBusy(false)}
  }}>
  <Input allowClear aria-label={t('chat.search')} prefix={<SearchOutlined/>} placeholder={t('chat.search')} value={query} onChange={e=>setQuery(e.target.value)} autoFocus/>
  <div role="listbox" aria-label={t('notes.collectionHint')} className="mt-2 max-h-64 overflow-y-auto">
   {filtered.map(i=><button type="button" key={i.id} role="option" aria-selected={value===i.title}
    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${value===i.title?'bg-[var(--ww-primary-soft)] text-[var(--ww-primary)]':'hover:bg-[var(--ww-hover)]'}`}
    onClick={()=>pick(i.title)}>
    {recent.includes(i.id)?<StarFilled className="text-xs text-amber-400"/>:<span className="w-4"/>}
    <span className="min-w-0 flex-1 truncate">{i.title}</span>
    {value===i.title&&<span className="text-xs">✓</span>}
   </button>)}
   {canCreate&&<button type="button" role="option" aria-selected={false}
    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${value===query.trim()?'bg-[var(--ww-primary-soft)] text-[var(--ww-primary)]':'hover:bg-[var(--ww-hover)]'}`}
    onClick={()=>setValue(query.trim())}>
    <PlusOutlined className="w-4 text-xs"/>
    <span className="min-w-0 flex-1 truncate">{t('notes.newCollection',{title:query.trim()})}</span>
   </button>}
   {!filtered.length&&!canCreate&&<p className="py-6 text-center text-xs text-[var(--ww-text-3)]">{t('notes.noCollectionFound')}</p>}
  </div>
 </Modal>
}
