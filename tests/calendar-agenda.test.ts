import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest'
import {agendaRowsForRange,calendarSearchReducer,type CalendarSearchState} from '../src/renderer/src/components/calendarAgenda'

/** 固定基准时间的“某天某时刻”时间戳（2026-06-15 周一，避免真实日期依赖与夏令时跳变） */
function at(dayOffset:number,hour:number,minute=0):number{
 const d=new Date(2026,5,15,0,0,0,0);d.setDate(d.getDate()+dayOffset);d.setHours(hour,minute,0,0);return d.getTime()
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

describe('agendaRowsForRange 夏令时（DST）回归测试', () => {
 const origTz = process.env.TZ
 beforeAll(() => {
  process.env.TZ = 'America/New_York'
 })
 afterAll(() => {
  if (origTz !== undefined) process.env.TZ = origTz
  else delete process.env.TZ
 })
 const parseNy = (s: string) => new Date(s).getTime()

 it('春季夏令时（23小时日）：次日 00:30 点事件归入次日，不重复出现在前一天', () => {
  const from = parseNy('2026-03-08T00:00:00')
  const to = parseNy('2026-03-10T00:00:00')
  const eventTime = parseNy('2026-03-09T00:30:00')
  const rows = agendaRowsForRange([{ eventId: 'DST-SPRING', start: eventTime, end: eventTime }], { from, to })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.dayKey).toBe('2026-03-09')
  expect(rows[0]!.point).toBe(true)
  expect(rows[0]!.crossDay).toBe(false)
 })

 it('秋季夏令时（25小时日）：23:30 点事件归入当天，不因 24h 计算空档丢失', () => {
  const from = parseNy('2026-11-01T00:00:00')
  const to = parseNy('2026-11-03T00:00:00')
  const eventTime = parseNy('2026-11-01T23:30:00')
  const rows = agendaRowsForRange([{ eventId: 'DST-AUTUMN', start: eventTime, end: eventTime }], { from, to })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.dayKey).toBe('2026-11-01')
  expect(rows[0]!.point).toBe(true)
  expect(rows[0]!.crossDay).toBe(false)
 })

 it('春季 23 小时自然日全天事件记 allDay 且不跨天', () => {
  const from = parseNy('2026-03-08T00:00:00')
  const to = parseNy('2026-03-10T00:00:00')
  const rows = agendaRowsForRange([{ eventId: 'SPRING-FULL', start: from, end: parseNy('2026-03-09T00:00:00') }], { from, to })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.dayKey).toBe('2026-03-08')
  expect(rows[0]!.allDay).toBe(true)
  expect(rows[0]!.crossDay).toBe(false)
 })

 it('秋季 25 小时自然日全天事件记 allDay 且不跨天', () => {
  const from = parseNy('2026-11-01T00:00:00')
  const to = parseNy('2026-11-03T00:00:00')
  const rows = agendaRowsForRange([{ eventId: 'AUTUMN-FULL', start: from, end: parseNy('2026-11-02T00:00:00') }], { from, to })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.dayKey).toBe('2026-11-01')
  expect(rows[0]!.allDay).toBe(true)
  expect(rows[0]!.crossDay).toBe(false)
 })

 it('跨越春季 DST 转换点的区间事件跨天裁剪与标记正确', () => {
  const from = parseNy('2026-03-08T00:00:00')
  const to = parseNy('2026-03-10T00:00:00')
  const rows = agendaRowsForRange([{ eventId: 'SPRING-SPAN', start: parseNy('2026-03-08T10:00:00'), end: parseNy('2026-03-09T10:00:00') }], { from, to })
  expect(rows).toHaveLength(2)
  expect(rows[0]!.dayKey).toBe('2026-03-08')
  expect(rows[0]!.crossDay).toBe(true)
  expect(rows[1]!.dayKey).toBe('2026-03-09')
  expect(rows[1]!.crossDay).toBe(true)
  expect(rows[1]!.start).toBe(parseNy('2026-03-09T00:00:00'))
 })
})
