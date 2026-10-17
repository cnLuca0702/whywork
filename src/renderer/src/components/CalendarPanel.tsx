import {useCallback,useEffect,useRef,useState} from 'react'
import {Button,Card,Empty,Input,Segmented,Spin,Table,message} from 'antd'
import dayjs,{type Dayjs} from 'dayjs'
import 'dayjs/locale/zh-cn'
import {sys} from '../api'
import {t} from '../i18n/zh'
import {agendaRowsForRange,calendarSearchReducer,type AgendaRowDef,type CalendarSearchState} from './calendarAgenda'

dayjs.locale('zh-cn')

interface CalEvent{id:string;title:string;description?:string;location?:string;start:number;end:number;source:string;calendarTitle?:string}
type CalMode='today'|'week'|'list'
interface CalRange{from:Dayjs;to:Dayjs}

/** 日历面板：今天/本周议程 + 列表模式（U-35）。议程归组与搜索提交逻辑在 calendarAgenda.ts（纯函数，含单测）。 */
export default function CalendarPanel(){
 const [mode,setMode]=useState<CalMode>('list')
 const [search,setSearch]=useState<CalendarSearchState>({draft:'',committed:''})
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
 useEffect(()=>{void load(mode,search.committed)},[mode,search.committed,load])
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){void message.error(String(e))}finally{setBusy(false)}}

 const range=rangeOf(mode)
 const emptyText=mode==='today'?t('calendar.noEventsToday'):t('calendar.noEventsWeek')
 return <Card title={t('calendar.title')}>
  {systemCalendar?.supported&&<div className="mb-4">
   <Button loading={busy} onClick={()=>void run(async()=>{const r=await sys<{supported:boolean;authorization:string}>('calendar.connect_system');setSystemCalendar(r);await load(mode,search.committed)})}>{t('calendar.connect')}</Button>
   <span className="ml-2">{t(systemCalendar.authorization==='authorized'?'calendar.authorized':systemCalendar.authorization==='restricted'?'calendar.restricted':'calendar.denied')}</span>
  </div>}
  <div className="mb-4 flex flex-wrap items-center gap-2">
   <Button type="primary" loading={busy} onClick={()=>void run(async()=>{await sys('calendar.import');await load(mode,search.committed)})}>导入日历</Button>
   <Segmented value={mode} onChange={v=>setMode(v as CalMode)} options={[{value:'today',label:t('calendar.today')},{value:'week',label:t('calendar.week')},{value:'list',label:t('calendar.list')}]}/>
   <Input.Search className="max-w-56" placeholder="搜索事件" value={search.draft} allowClear
    onChange={e=>setSearch(s=>calendarSearchReducer(s,{type:'change',value:e.target.value}))}
    onSearch={value=>setSearch(s=>calendarSearchReducer(s,{type:'search',value}))}/>
  </div>
  {loading?<div className="flex h-24 items-center justify-center"><Spin/></div>
   :mode==='list'||!range
    ?<Table size="small" rowKey="id" dataSource={items} columns={[{title:'事件',dataIndex:'title'},{title:'开始',dataIndex:'start',render:value=>new Date(Number(value)).toLocaleString()},{title:'地点',dataIndex:'location'},{title:t('calendar.source'),dataIndex:'source',render:value=>value==='system'?t('calendar.system'):'ICS'}]}/>
    :<AgendaView mode={mode} range={range} items={items} emptyText={emptyText}/>}
 </Card>
}

function AgendaView({mode,range,items,emptyText}:{mode:'today'|'week';range:CalRange;items:CalEvent[];emptyText:string}){
 const rows=agendaRowsForRange(items.map(e=>({eventId:e.id,start:e.start,end:e.end})),{from:range.from.valueOf(),to:range.to.valueOf()})
 if(!rows.length)return <div className="flex h-40 items-center justify-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText}/></div>
 const groups=new Map<string,{label:string;rows:{row:AgendaRowDef;event:CalEvent}[]}>()
 const byId=new Map(items.map(e=>[e.id,e]))
 for(const row of rows){
  const group=groups.get(row.dayKey)??{label:mode==='today'?t('calendar.todayLabel'):dayjs(row.start).format('M月D日 ddd'),rows:[]}
  const event=byId.get(row.eventId)
  if(event)group.rows.push({row,event})
  groups.set(row.dayKey,group)
 }
 return <div className="space-y-4">
  {[...groups.entries()].map(([key,group])=><section key={key}>
   <h4 className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">{group.label} · {group.rows.length}</h4>
   {group.rows.sort((a,b)=>a.row.start-b.row.start).map(({row,event})=><AgendaRowView key={row.key} row={row} event={event}/>)}
  </section>)}
 </div>
}

function AgendaRowView({row,event}:{row:AgendaRowDef;event:CalEvent}){
 const time=row.allDay?t('calendar.allDay')
  :row.point?dayjs(row.start).format('HH:mm')
  :`${dayjs(row.start).format('HH:mm')}–${dayjs(row.end).format('HH:mm')}`
 return <div className="flex items-baseline gap-3 border-b border-[var(--ww-border-2)] py-2 text-sm last:border-b-0">
  <span className="w-28 shrink-0 text-xs text-[var(--ww-text-3)]">{time}</span>
  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
  {row.crossDay&&<span className="shrink-0 text-xs text-[var(--ww-warn)]">{t('calendar.crossDay')}</span>}
  {event.location&&<span className="max-w-40 truncate text-xs text-[var(--ww-text-3)]">{event.location}</span>}
  <span className="shrink-0 text-xs text-[var(--ww-text-3)]">{event.source==='system'?t('calendar.system'):'ICS'}</span>
 </div>
}
