import dayjs from 'dayjs'

/** 日历议程与搜索提交的纯逻辑，供 CalendarPanel 渲染与单元测试共用（Codex 复检三轮 P2 修复）。 */

export interface AgendaEventInput{eventId:string;start:number;end:number}
export interface AgendaRowDef{key:string;eventId:string;dayKey:string;start:number;end:number;allDay:boolean;crossDay:boolean;point:boolean}
export interface AgendaRange{from:number;to:number}

const DAY=86400000

/** 事件与展示范围逐日求交集：
 *  - 区间事件（end>start）用半开区间 [start,end) 与当日 [dayStart,dayEnd) 求交，起点裁剪到 00:00，占满当日记 allDay；
 *  - 点事件（end<=start）单独归入 dayStart<=start<dayEnd 的那一天——否则半开交集为空，午夜零时长事件会整天消失（复检 P2-2）；
 *  - crossDay 仅当事件内容跨越一个以上自然日（单日 00:00–24:00 的“全天”不算跨天）。 */
export function agendaRowsForRange(events:AgendaEventInput[],range:AgendaRange):AgendaRowDef[]{
 const rows:AgendaRowDef[]=[]
 for(const event of events){
  const point=event.end<=event.start
  // 内容跨过一个以上自然日才算跨天：恰至次日 00:00 的单日全天事件不算
  const crossDay=!point&&event.end>dayjs(event.start).startOf('day').valueOf()+DAY
  for(let day=dayjs(range.from).startOf('day');day.valueOf()<range.to;day=day.add(1,'day')){
   const dayStart=day.valueOf(),dayEnd=dayStart+DAY
   if(point){
    if(event.start<dayStart||event.start>=dayEnd)continue
    rows.push({key:`${event.eventId}:${day.format('YYYY-MM-DD')}`,eventId:event.eventId,dayKey:day.format('YYYY-MM-DD'),start:event.start,end:event.start,allDay:false,crossDay:false,point:true})
   }else{
    if(event.end<=dayStart||event.start>=dayEnd)continue
    const start=Math.max(event.start,dayStart),end=Math.min(event.end,dayEnd)
    rows.push({key:`${event.eventId}:${day.format('YYYY-MM-DD')}`,eventId:event.eventId,dayKey:day.format('YYYY-MM-DD'),start,end,allDay:start===dayStart&&end===dayEnd,crossDay,point:false})
   }
  }
 }
 return rows
}

export interface CalendarSearchState{draft:string;committed:string}
export type CalendarSearchAction={type:'search';value:string}|{type:'change';value:string}

/** 搜索框状态机：draft 是输入草稿，committed 是参与查询的已提交词。
 *  onSearch 始终以 antd 传入的实际 value 提交（清空按钮会先触发 onSearch('')，不能读取旧 draft）；
 *  输入清空（onChange 空值）无条件把两项都归空——未提交的草稿不得残留为筛选条件（复检 P2-1）。 */
export function calendarSearchReducer(state:CalendarSearchState,action:CalendarSearchAction):CalendarSearchState{
 if(action.type==='search')return{...state,committed:action.value.trim()}
 if(!action.value)return{draft:'',committed:''}
 return{...state,draft:action.value}
}
