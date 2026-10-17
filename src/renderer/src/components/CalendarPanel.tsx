import {useCallback,useEffect,useRef,useState} from 'react'
import {Button,Card,Empty,Input,Segmented,Spin,Table,message} from 'antd'
import dayjs,{type Dayjs} from 'dayjs'
import 'dayjs/locale/zh-cn'
import {sys} from '../api'
import {t} from '../i18n/zh'

dayjs.locale('zh-cn')

interface CalEvent{id:string;title:string;description?:string;location?:string;start:number;end:number;source:string;calendarTitle?:string}
type CalMode='today'|'week'|'list'
interface CalRange{from:Dayjs;to:Dayjs}

/** 日历面板：今天/本周议程 + 列表模式（U-35）。
 * 议程行按“事件与展示范围的每日交集”裁剪：跨天事件在范围内的每一天各显示一行，
 * 进行中事件的起点被裁剪到当日 00:00，分组标题始终落在展示范围内（复检 P2-2 修复）。 */
export default function CalendarPanel(){
 const [mode,setMode]=useState<CalMode>('list')
 const [draft,setDraft]=useState('')
 const [committed,setCommitted]=useState('')
 const [items,setItems]=useState<CalEvent[]>([])
 const [loading,setLoading]=useState(false)
 const [busy,setBusy]=useState(false)
 const [systemCalendar,setSystemCalendar]=useState<{supported:boolean;authorization:string}|null>(null)
 const requestRef=useRef(0)
 useEffect(()=>{void sys<{supported:boolean;authorization:string}>('calendar.system_status').then(setSystemCalendar).catch(()=>undefined)},[])
 const rangeOf=(m:CalMode):CalRange|undefined=>{
  const now=dayjs()
  if(m==='today')return{from:now.startOf('day'),to:now.startOf('day').add(1,'day')}
  if(m==='week')return{from:now.startOf('week'),to:now.startOf('week').add(7,'day')}
  return undefined
 }
 const load=useCallback(async(m:CalMode,q:string)=>{
  const request=++requestRef.current
  setLoading(true)
  try{
    const range=rangeOf(m)
    const r=await sys<{items:CalEvent[]}>('calendar.search',{query:q,limit:100,...(range?{from:range.from.valueOf(),to:range.to.valueOf()}:{})})
    if(request!==requestRef.current)return
    setItems(r.items)
  }catch(e){if(request===requestRef.current)message.error(String(e))}finally{if(request===requestRef.current)setLoading(false)}
 },[])
 // 模式切换沿用“已提交”的搜索词，输入框草稿不参与查询（复检 P2-1 修复）
 useEffect(()=>{void load(mode,committed)},[mode,committed,load])
 const search=()=>setCommitted(draft.trim())
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){void message.error(String(e))}finally{setBusy(false)}}

 const range=rangeOf(mode)
 const emptyText=mode==='today'?t('calendar.noEventsToday'):t('calendar.noEventsWeek')
 return <Card title={t('calendar.title')}>
  {systemCalendar?.supported&&<div className="mb-4">
   <Button loading={busy} onClick={()=>void run(async()=>{const r=await sys<{supported:boolean;authorization:string}>('calendar.connect_system');setSystemCalendar(r);await load(mode,committed)})}>{t('calendar.connect')}</Button>
   <span className="ml-2">{t(systemCalendar.authorization==='authorized'?'calendar.authorized':systemCalendar.authorization==='restricted'?'calendar.restricted':'calendar.denied')}</span>
  </div>}
  <div className="mb-4 flex flex-wrap items-center gap-2">
   <Button type="primary" loading={busy} onClick={()=>void run(async()=>{await sys('calendar.import');await load(mode,committed)})}>导入日历</Button>
   <Segmented value={mode} onChange={v=>setMode(v as CalMode)} options={[{value:'today',label:t('calendar.today')},{value:'week',label:t('calendar.week')},{value:'list',label:t('calendar.list')}]}/>
   <Input.Search className="max-w-56" placeholder="搜索事件" value={draft} allowClear
    onChange={e=>{setDraft(e.target.value);if(!e.target.value&&committed)setCommitted('')}}
    onSearch={search}/>
  </div>
  {loading?<div className="flex h-24 items-center justify-center"><Spin/></div>
   :mode==='list'||!range
    ?<Table size="small" rowKey="id" dataSource={items} columns={[{title:'事件',dataIndex:'title'},{title:'开始',dataIndex:'start',render:value=>new Date(Number(value)).toLocaleString()},{title:'地点',dataIndex:'location'},{title:t('calendar.source'),dataIndex:'source',render:value=>value==='system'?t('calendar.system'):'ICS'}]}/>
    :<AgendaView mode={mode} range={range} items={items} emptyText={emptyText}/>}
 </Card>
}

interface AgendaRow{key:string;event:CalEvent;start:Dayjs;end:Dayjs;allDay:boolean;crossDay:boolean}

function AgendaView({mode,range,items,emptyText}:{mode:'today'|'week';range:CalRange;items:CalEvent[];emptyText:string}){
 const rows:AgendaRow[]=[]
 for(const event of items){
  const crossDay=!dayjs(event.start).isSame(dayjs(event.end),'day')
  for(let day=range.from;day.isBefore(range.to);day=day.add(1,'day')){
   const dayStart=day.startOf('day'),dayEnd=dayStart.add(1,'day')
   if(event.end<=dayStart.valueOf()||event.start>=dayEnd.valueOf())continue
   const start=dayjs(Math.max(event.start,dayStart.valueOf()))
   const end=dayjs(Math.min(event.end,dayEnd.valueOf()))
   rows.push({key:`${event.id}:${day.format('YYYY-MM-DD')}`,event,start,end,
    allDay:start.isSame(dayStart)&&end.isSame(dayEnd),crossDay})
  }
 }
 if(!rows.length)return <div className="flex h-40 items-center justify-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText}/></div>
 const groups=new Map<string,{label:string;rows:AgendaRow[]}>()
 for(const row of rows){
  const key=row.start.format('YYYY-MM-DD')
  const group=groups.get(key)??{label:mode==='today'?t('calendar.todayLabel'):row.start.format('M月D日 ddd'),rows:[]}
  group.rows.push(row)
  groups.set(key,group)
 }
 return <div className="space-y-4">
  {[...groups.entries()].map(([key,group])=><section key={key}>
   <h4 className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">{group.label} · {group.rows.length}</h4>
   {group.rows.sort((a,b)=>a.start.valueOf()-b.start.valueOf()).map(row=><AgendaRowView key={row.key} row={row}/>)}
  </section>)}
 </div>
}

function AgendaRowView({row}:{row:AgendaRow}){
 const {event}=row
 const time=row.allDay?t('calendar.allDay')
  :row.end.valueOf()<=row.start.valueOf()?row.start.format('HH:mm')
  :`${row.start.format('HH:mm')}–${row.end.format('HH:mm')}`
 return <div className="flex items-baseline gap-3 border-b border-[var(--ww-border-2)] py-2 text-sm last:border-b-0">
  <span className="w-28 shrink-0 text-xs text-[var(--ww-text-3)]">{time}</span>
  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
  {row.crossDay&&<span className="shrink-0 text-xs text-[var(--ww-warn)]">{t('calendar.crossDay')}</span>}
  {event.location&&<span className="max-w-40 truncate text-xs text-[var(--ww-text-3)]">{event.location}</span>}
  <span className="shrink-0 text-xs text-[var(--ww-text-3)]">{event.source==='system'?t('calendar.system'):'ICS'}</span>
 </div>
}
