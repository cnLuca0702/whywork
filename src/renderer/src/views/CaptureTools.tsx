import {useEffect,useState} from 'react'
import {Alert,Button,Card,Space,Table,message} from 'antd'
import {sys,useSysEvent} from '../api'
interface Folder {id:string;dir:string;enabled:boolean;status:string}
export default function CaptureTools() {
  const [items,setItems]=useState<Folder[]>([]),[busy,setBusy]=useState(false)
  const refresh=()=>sys<{items:Folder[]}>('watch.folders_list').then(r=>setItems(r.items))
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();await refresh()}catch(e){void message.error(String(e))}finally{setBusy(false)}}
  useEffect(()=>{void refresh().catch(e=>message.error(String(e)))},[])
  useSysEvent('notes.changed',()=>{void refresh().catch(()=>undefined)})
  useSysEvent('watch.error',p=>{void message.error((p as {error:string}).error);void refresh().catch(()=>undefined)})
  useSysEvent('watch.item_failed',p=>{const item=p as {file:string;error:string};void message.error(`${item.file}：${item.error}`)})
  return <Card title="目录采集与分享收件箱">
    <Alert showIcon type="info" message="选择专用目录后，其中支持的文件会自动导入，内容修改后更新原笔记。暂停状态会保留，移除监控会保留已导入的笔记。"/>
    <p className="my-3">使用 macOS 分享时，在“WhyWork 收件箱”扩展中选择同一个目录。文本和网页链接会保存为本地 Markdown，再由此处自动入库。分享扩展需要安装后的系统菜单支持。</p>
    <Space className="mb-3"><Button loading={busy} onClick={()=>void run(async()=>{
      const picked=await sys<{canceled:boolean;path?:string}>('app.pick_folder');if(picked.canceled||!picked.path)return
      const folder=await sys<{id:string}>('watch.folders_add',{dir:picked.path});await sys('watch.scan_now',{id:folder.id})
    })}>选择并监控目录</Button><Button disabled={busy} onClick={()=>void run(async()=>undefined)}>刷新</Button></Space>
    <Table rowKey="id" size="small" dataSource={items} columns={[
      {title:'目录',dataIndex:'dir',render:value=><span className="break-all">{value}</span>},
      {title:'状态',dataIndex:'status'},
      {title:'操作',render:(_,folder)=><Space wrap>
        <Button size="small" disabled={busy} onClick={()=>void run(async()=>{await sys(folder.enabled?'watch.pause':'watch.resume',{id:folder.id})})}>{folder.enabled?'暂停':'恢复'}</Button>
        <Button size="small" disabled={busy||!folder.enabled} onClick={()=>void run(async()=>{await sys('watch.scan_now',{id:folder.id})})}>立即扫描</Button>
        <Button size="small" disabled={busy} onClick={()=>void run(async()=>{await sys('watch.folders_remove',{id:folder.id})})}>移除监控</Button>
      </Space>}
    ]}/>
  </Card>
}
