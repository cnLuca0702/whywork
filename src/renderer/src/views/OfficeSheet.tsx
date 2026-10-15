import {useEffect,useRef,useState} from 'react'
import {Alert,Button,Modal,message} from 'antd'
import {createUniver,LocaleType,mergeLocales} from '@univerjs/presets'
import {UniverSheetsCorePreset} from '@univerjs/preset-sheets-core'
import Chinese from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import type {WorkbookSnapshot} from '../../../shared/office'
import {sys} from '../api'
import {registerViewGuard} from '../store/ui'
export default function OfficeSheet({sessionId,snapshot,warning,onClose}:{sessionId:string;snapshot:WorkbookSnapshot;warning:string;onClose:()=>void}) {
  const host=useRef<HTMLDivElement>(null),snapshotRef=useRef<(()=>WorkbookSnapshot)|null>(null)
  const [busy,setBusy]=useState(false)
  const baseline=useRef(''),saving=useRef(false),asking=useRef<Promise<boolean>|null>(null)
  const mayLeave=():Promise<boolean>=>{
    if(saving.current){void message.info('正在保存，请稍候');return Promise.resolve(false)}
    if(!snapshotRef.current||JSON.stringify(snapshotRef.current())===baseline.current)return Promise.resolve(true)
    if(asking.current)return asking.current
    asking.current=new Promise<boolean>(resolve=>Modal.confirm({title:'放弃尚未保存的表格修改？',content:'选择“留在表格”后，可使用“保存副本”保留修改。',okText:'放弃并离开',cancelText:'留在表格',okButtonProps:{danger:true},onOk:()=>resolve(true),onCancel:()=>resolve(false)})).finally(()=>{asking.current=null})
    return asking.current
  }
  useEffect(()=>{
    if(!host.current)return
    const {univer,univerAPI}=createUniver({locale:LocaleType.ZH_CN,locales:{[LocaleType.ZH_CN]:mergeLocales(Chinese)},presets:[UniverSheetsCorePreset({container:host.current})]})
    const workbook=univerAPI.createWorkbook(snapshot as never)
    snapshotRef.current=()=>workbook.save() as unknown as WorkbookSnapshot
    baseline.current=JSON.stringify(snapshotRef.current())
    const removeGuard=registerViewGuard(mayLeave)
    let allowClose=false
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      if(allowClose||(!saving.current&&JSON.stringify(snapshotRef.current?.())===baseline.current))return
      event.preventDefault();event.returnValue=''
      void mayLeave().then(ok=>{if(ok){allowClose=true;window.close()}})
    }
    window.addEventListener('beforeunload',beforeUnload)
    return()=>{removeGuard();window.removeEventListener('beforeunload',beforeUnload);snapshotRef.current=null;univer.dispose()}
  },[sessionId])
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex gap-2 p-2"><Button onClick={()=>void mayLeave().then(ok=>{if(ok)onClose()})}>返回</Button><b className="flex-1">{snapshot.name}</b><Button type="primary" loading={busy} onClick={()=>{
      if(!snapshotRef.current)return
      const saved=structuredClone(snapshotRef.current());setBusy(true);saving.current=true
      void sys('office.save_xlsx',{sessionId,snapshot:saved}).then(()=>{baseline.current=JSON.stringify(saved);void message.success('已保存工作区副本')}).catch(e=>message.error(String(e))).finally(()=>{saving.current=false;setBusy(false)})
    }}>保存副本</Button></div>
    <Alert type="info" message={warning} showIcon/>
    <div ref={host} className="min-h-0 flex-1"/>
  </div>
}
