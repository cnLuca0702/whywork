import {afterEach,describe,expect,it} from 'vitest'
import {agendaRowsForRange,calendarSearchReducer,type CalendarSearchState} from '../src/renderer/src/components/calendarAgenda'

/** 本地时区的“某天某时刻”时间戳 */
function at(dayOffset:number,hour:number,minute=0):number{
 const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+dayOffset);d.setHours(hour,minute,0,0);return d.getTime()
}
const day0=at(0,0),dayKeyOf=(ts:number)=>{const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

describe('agendaRowsForRange 跨天/点事件归组（复检 P2-2）',()=>{
 it('午夜零时长点事件归入所在日（半开区间交集会将其丢弃的回归）',()=>{
  const midnightTomorrow=at(1,0)
  const rows=agendaRowsForRange([{eventId:'z',start:midnightTomorrow,end:midnightTomorrow}],{from:day0,to:at(7,0)})
  expect(rows).toHaveLength(1)
  expect(rows[0]!.dayKey).toBe(dayKeyOf(midnightTomorrow))
  expect(rows[0]!.point).toBe(true)
  // 前一天不得重复归入
  expect(rows[0]!.dayKey).not.toBe(dayKeyOf(day0))
 })
 it('同日 14:00 点事件归当天且不跨到次日',()=>{
  const rows=agendaRowsForRange([{eventId:'p',start:at(0,14),end:at(0,14)}],{from:day0,to:at(1,0)})
  expect(rows.map(r=>r.dayKey)).toEqual([dayKeyOf(day0)])
  expect(rows[0]!.point).toBe(true)
 })
 it('跨天区间事件裁剪到当日 00:00 并标记跨天',()=>{
  const rows=agendaRowsForRange([{eventId:'ov',start:at(-1,23),end:at(0,1)}],{from:day0,to:at(1,0)})
  expect(rows).toHaveLength(1)
  expect(rows[0]!.start).toBe(day0)
  expect(rows[0]!.end).toBe(at(0,1))
  expect(rows[0]!.crossDay).toBe(true)
  expect(rows[0]!.allDay).toBe(false)
 })
 it('单日全天事件记 allDay 且不算跨天',()=>{
  const rows=agendaRowsForRange([{eventId:'a',start:at(0,0),end:at(1,0)}],{from:day0,to:at(2,0)})
  expect(rows).toHaveLength(1)
  expect(rows[0]!.allDay).toBe(true)
  expect(rows[0]!.crossDay).toBe(false)
 })
 it('起于上周的进行中事件首行归属范围起点并逐日展开',()=>{
  const weekFrom=at(-((new Date(day0).getDay()+6)%7),0) // 本周一
  const rows=agendaRowsForRange([{eventId:'lw',start:at(-6,9),end:at(1,3)}],{from:weekFrom,to:weekFrom+7*86400000})
  expect(rows.length).toBeGreaterThan(1)
  expect(rows[0]!.dayKey).toBe(dayKeyOf(weekFrom))
  expect(rows[0]!.allDay).toBe(true)
  expect(new Set(rows.map(r=>r.dayKey)).size).toBe(rows.length)
 })
 it('范围外与 to 边界的点事件不归入（半开语义）',()=>{
  const from=at(0,0),to=at(1,0)
  expect(agendaRowsForRange([{eventId:'before',start:at(-1,10),end:at(-1,11)}],{from,to})).toHaveLength(0)
  expect(agendaRowsForRange([{eventId:'after',start:at(2,10),end:at(2,11)}],{from,to})).toHaveLength(0)
  expect(agendaRowsForRange([{eventId:'edge',start:to,end:to}],{from,to})).toHaveLength(0)
  expect(agendaRowsForRange([{eventId:'start',start:from,end:from}],{from,to})).toHaveLength(1)
 })
 it('跨多周事件在周范围内只展开范围内日期',()=>{
  const weekFrom=at(-((new Date(day0).getDay()+6)%7),0)
  const rows=agendaRowsForRange([{eventId:'long',start:at(-10,0),end:at(10,0)}],{from:weekFrom,to:weekFrom+7*86400000})
  expect(rows).toHaveLength(7)
  expect(rows[0]!.allDay).toBe(true)
 })
})

describe('calendarSearchReducer 搜索提交状态机（复检 P2-1）',()=>{
 const s=(draft:string,committed:string):CalendarSearchState=>({draft,committed})
 it('未提交草稿时清空：无论 onSearch/onChange 到达顺序，最终都不残留筛选',()=>{
  // antd 清空按钮：先 onSearch('') 再 onChange('')
  let state=s('REVIEW今天','')
  state=calendarSearchReducer(state,{type:'search',value:''})
  expect(state.committed).toBe('')
  state=calendarSearchReducer(state,{type:'change',value:''})
  expect(state).toEqual(s('',''))
  // 反向顺序同样收敛
  let state2=s('REVIEW今天','')
  state2=calendarSearchReducer(state2,{type:'change',value:''})
  state2=calendarSearchReducer(state2,{type:'search',value:''})
  expect(state2).toEqual(s('',''))
 })
 it('onSearch 以传入 value 提交并 trim，不读旧 draft',()=>{
  const state=calendarSearchReducer(s('旧草稿','旧词'),{type:'search',value:'  REVIEW今天 '})
  expect(state).toEqual(s('旧草稿','REVIEW今天'))
 })
 it('onChange 非空只更新草稿，不影响已提交词',()=>{
  const state=calendarSearchReducer(s('','已提交'),{type:'change',value:'新草稿'})
  expect(state).toEqual(s('新草稿','已提交'))
 })
 it('已提交状态下清空同样归空（既有路径回归）',()=>{
  let state=s('REVIEW今天','REVIEW今天')
  state=calendarSearchReducer(state,{type:'change',value:''})
  expect(state).toEqual(s('',''))
 })
})
