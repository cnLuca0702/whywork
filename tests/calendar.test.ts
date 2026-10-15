import {expect,it,vi} from 'vitest'
vi.mock('electron',()=>({app:{},dialog:{}}))
import {parseCalendar} from '../src/main/syscalls/calendar'
it('preserves UTC date, recurring exceptions and override titles',async()=>{
  const text='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-calendar\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261015T010000Z\r\nDTEND:20261015T020000Z\r\nSUMMARY:例会\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261016T010000Z\r\nEND:VEVENT\r\nEND:VCALENDAR'
  const items=await parseCalendar(text,new Date('2026-10-01'),new Date('2026-11-01'))
  expect(items).toHaveLength(2);expect(items[0]?.title).toBe('例会')
  expect(items[0]?.start).toBe(Date.parse('2026-10-15T01:00:00Z'))
  expect(items[1]?.start).toBe(Date.parse('2026-10-17T01:00:00Z'))
})
it('rejects explosive recurrence inputs',async()=>{
  await expect(parseCalendar('RRULE:FREQ=SECONDLY')).rejects.toThrow('分钟或秒级')
})
