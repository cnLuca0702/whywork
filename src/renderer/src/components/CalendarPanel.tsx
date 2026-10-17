import {useCallback,useEffect,useState} from 'react'
import {Button,Card,Empty,Input,Segmented,Spin,Table,message} from 'antd'
import dayjs,{type Dayjs} from 'dayjs'
import 'dayjs/locale/zh-cn'
import {sys} from '../api'
import {t} from '../i18n/zh'

dayjs.locale('zh-cn')

interface CalEvent{id:string;title:string;description?:string;location?:string;start:number;end:number;source:string;calendarTitle?:string}
type CalMode='today'|'week'|'list'

/** 日历面板：今天/本周议程 + 列表模式（U-35）。列表保留原表格；议程按天分组显示时间与地点。 */
export default function CalendarPanel(){
 const [mode,setMode]=useState<CalMode>('list')
 const [query,setQuery]=useState('')
 const [items,setItems]=useState<CalEvent[]>([])
 const [loading,setLoading]=useState(false)
 const [busy,setBusy]=useState(false)
 const [systemCalendar,setSystemCalendar]=useState<{supported:boolean;authorization:string}|null>(null)
 useEffect(()=>{void sys<{supported:boolean;authorization:string}>('calendar.system_status').then(setSystemCalendar).catch(()=>undefined)},[])
 const rangeOf=(m:CalMode):{from:Dayjs;to:Dayjs}|undefined=>{
  const now=dayjs()
  if(m==='today')return{from:now.startOf('day'),to:now.startOf('day').add(1,'day')}
  if(m==='week')return{from:now.startOf('week'),to:now.startOf('week').add(7,'day')}
  return undefined
 }
 const load=useCallback(async(m:CalMode,q:string)=>{
  setLoading(true)
  try{
    const range=rangeOf(m)
    const r=await sys<{items:CalEvent[]}>('calendar.search',{query:q,limit:100,...(range?{from:range.from.valueOf(),to:range.to.valueOf()}:{})})
    setItems(r.items)
  }catch(e){message.error(String(e))}finally{setLoading(false)}
 },[])
 useEffect(()=>{void load(mode,'')},[mode,load])
 const search=()=>void load(mode,query.trim())
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){void message.error(String(e))}finally{setBusy(false)}}

 const emptyText=mode==='today'?t('calendar.noEventsToday'):t('calendar.noEventsWeek')
 return <Card title={t('calendar.title')}>
  {systemCalendar?.supported&&<div className="mb-4">
   <Button loading={busy} onClick={()=>void run(async()=>{const r=await sys<{supported:boolean;authorization:string}>('calendar.connect_system');setSystemCalendar(r);await load(mode,query.trim())})}>{t('calendar.connect')}</Button>
   <span className="ml-2">{t(systemCalendar.authorization==='authorized'?'calendar.authorized':systemCalendar.authorization==='restricted'?'calendar.restricted':'calendar.denied')}</span>
  </div>}
  <div className="mb-4 flex flex-wrap items-center gap-2">
   <Button type="primary" loading={busy} onClick={()=>void run(async()=>{await sys('calendar.import');await load(mode,query.trim())})}>导入日历</Button>
   <Segmented value={mode} onChange={v=>setMode(v as CalMode)} options={[{value:'today',label:t('calendar.today')},{value:'week',label:t('calendar.week')},{value:'list',label:t('calendar.list')}]}/>
   <Input.Search className="max-w-56" placeholder="搜索事件" value={query} onChange={e=>setQuery(e.target.value)} onSearch={search} allowClear/>
  </div>
  {loading?<div className="flex h-24 items-center justify-center"><Spin/></div>
   :mode==='list'
    ?<Table size="small" rowKey="id" dataSource={items} columns={[{title:'事件',dataIndex:'title'},{title:'开始',dataIndex:'start',render:value=>new Date(Number(value)).toLocaleString()},{title:'地点',dataIndex:'location'},{title:t('calendar.source'),dataIndex:'source',render:value=>value==='system'?t('calendar.system'):'ICS'}]}/>
    :<AgendaView mode={mode} items={items} emptyText={emptyText}/>}
 </Card>
}

function AgendaView({mode,items,emptyText}:{mode:'today'|'week';items:CalEvent[];emptyText:string}){
 if(!items.length)return <div className="flex h-40 items-center justify-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText}/></div>
 const groups=new Map<string,{label:string;events:CalEvent[]}>()
 for(const event of items){
  const start=dayjs(event.start)
  const key=start.format('YYYY-MM-DD')
  const label=mode==='today'?t('calendar.todayLabel'):start.format('M月D日 ddd')
  const group=groups.get(key)??{label,events:[]}
  group.events.push(event)
  groups.set(key,group)
 }
 return <div className="space-y-4">
  {[...groups.entries()].map(([key,group])=><section key={key}>
   <h4 className="mb-1 text-xs font-medium text-[var(--ww-text-3)]">{group.label} · {group.events.length}</h4>
   {group.events.sort((a,b)=>a.start-b.start).map(event=><AgendaRow key={event.id} event={event}/>)}
  </section>)}
 </div>
}

function AgendaRow({event}:{event:CalEvent}){
 const start=dayjs(event.start),end=dayjs(event.end)
 const sameDay=start.isSame(end,'day')
 const time=sameDay?`${start.format('HH:mm')}–${end.format('HH:mm')}`:`${start.format('M月D日 HH:mm')} 起`
 return <div className="flex items-baseline gap-3 border-b border-[var(--ww-border-2)] py-2 text-sm last:border-b-0">
  <span className="w-28 shrink-0 text-xs text-[var(--ww-text-3)]">{time}</span>
  <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
  {event.location&&<span className="max-w-40 truncate text-xs text-[var(--ww-text-3)]">{event.location}</span>}
  <span className="shrink-0 text-xs text-[var(--ww-text-3)]">{event.source==='system'?t('calendar.system'):'ICS'}</span>
 </div>
}
