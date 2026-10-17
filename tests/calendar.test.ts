import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import Database from 'better-sqlite3'

const mock = vi.hoisted(() => ({ ws: '', db: null as unknown }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '' }, dialog: {} }))
vi.mock('../src/main/syscalls/app', () => ({ getWorkspacePath: () => mock.ws }))
vi.mock('../src/main/db/client', () => ({ getDb: () => mock.db, dbPath: () => '', resetDb: () => {} }))

import {parseCalendar, registerCalendarDomain} from '../src/main/syscalls/calendar'
import {invokeSys, type SysContext} from '../src/main/syscalls/registry'

const ctx: SysContext = { source: 'user', win: () => null, emit: () => {} }
async function searchCalendar(payload: Record<string, unknown>) {
  const res = await invokeSys('calendar.search', payload, ctx)
  if (!res.ok) throw new Error(res.error.message)
  return res.data as { items: Array<{ id: string; title: string; start: number; end: number; calendarId: string; source: string }>; total: number; warning?: string }
}

describe('calendar.search from/to 边界与点/区间事件集成测试', () => {
  let db: Database.Database
  beforeAll(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,uid TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,location TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,recurring INTEGER NOT NULL,source_id TEXT NOT NULL)')
    mock.db = db
    registerCalendarDomain()
  })
  afterAll(() => {
    db.close()
  })
  beforeEach(() => {
    db.prepare('DELETE FROM calendar_events').run()
  })

  it('半开区间 [from, to) 边界区分点事件与区间事件（含起点午夜点事件）', async () => {
    const from = 1792195200000 // 2026-10-17 00:00:00 UTC
    const to = from + 86400000  // 2026-10-18 00:00:00 UTC
    const insert = db.prepare('INSERT INTO calendar_events(id,uid,title,description,location,start,end,recurring,source_id) VALUES(?,?,?,?,?,?,?,?,?)')

    // 点事件 (end <= start)
    insert.run('p_from', 'p_from', '起点午夜点事件', '', '', from, from, 0, 'src1')
    insert.run('p_inside', 'p_inside', '范围内点事件', '', '', from + 3600000, from + 3600000, 0, 'src1')
    insert.run('p_to', 'p_to', '终点午夜点事件', '', '', to, to, 0, 'src1')
    insert.run('p_before', 'p_before', '范围前点事件', '', '', from - 3600000, from - 3600000, 0, 'src1')
    insert.run('p_after', 'p_after', '范围后点事件', '', '', to + 3600000, to + 3600000, 0, 'src1')
    insert.run('p_inv', 'p_inv', '倒置点事件', '', '', from + 1000, from, 0, 'src1')

    // 区间事件 (end > start)
    insert.run('i_cross_from', 'i_cross_from', '跨起点区间事件', '', '', from - 3600000, from + 3600000, 0, 'src1')
    insert.run('i_touch_from', 'i_touch_from', '止于起点区间事件', '', '', from - 3600000, from, 0, 'src1')
    insert.run('i_start_from', 'i_start_from', '起于起点区间事件', '', '', from, from + 3600000, 0, 'src1')
    insert.run('i_inside', 'i_inside', '范围内区间事件', '', '', from + 3600000, from + 7200000, 0, 'src1')
    insert.run('i_cross_to', 'i_cross_to', '跨终点区间事件', '', '', to - 3600000, to + 3600000, 0, 'src1')
    insert.run('i_start_to', 'i_start_to', '起于终点区间事件', '', '', to, to + 3600000, 0, 'src1')

    const res = await searchCalendar({ from, to, limit: 100 })
    const titles = res.items.map(i => i.title)

    // 应包含项：
    expect(titles).toContain('起点午夜点事件')   // 关键修复：start=end=from 必须包含
    expect(titles).toContain('范围内点事件')
    expect(titles).toContain('倒置点事件')       // end <= start 作为点事件对待
    expect(titles).toContain('跨起点区间事件')   // 跨界相交
    expect(titles).toContain('起于起点区间事件')
    expect(titles).toContain('范围内区间事件')
    expect(titles).toContain('跨终点区间事件')   // 跨终点相交

    // 应排除项：
    expect(titles).not.toContain('终点午夜点事件') // 半开区间右端点排除
    expect(titles).not.toContain('范围前点事件')
    expect(titles).not.toContain('范围后点事件')
    expect(titles).not.toContain('止于起点区间事件') // 半开相交：在 from 结束不算交集
    expect(titles).not.toContain('起于终点区间事件') // 在 to 开始不算交集

    expect(res.total).toBe(7)
    expect(res.items.every(i => i.source === 'ics' && i.calendarId === 'src1')).toBe(true)
  })

  it('第四轮复现用例回归：起点午夜点事件在今天单日与本周范围均能查到', async () => {
    const t = 1792195200000 // 假设今天 00:00
    const midnight = t + 86400000
    const monday = t - 3 * 86400000
    const insert = db.prepare('INSERT INTO calendar_events(id,uid,title,description,location,start,end,recurring,source_id) VALUES(?,?,?,?,?,?,?,?,?)')

    insert.run('overnight', 'overnight', 'REVIEW跨天会议', '', '', t - 3600000, t + 3600000, 0, 'round4')
    insert.run('today', 'today', 'REVIEW今天会议', '', '', t + 10 * 3600000, t + 11 * 3600000, 0, 'round4')
    insert.run('zero', 'zero', 'REVIEW午夜零时长', '', '', midnight, midnight, 0, 'round4')
    insert.run('fromzero', 'fromzero', 'REVIEW起点午夜', '', '', t, t, 0, 'round4')
    insert.run('zero14', 'zero14', 'REVIEW下午零时长', '', '', t + 14 * 3600000, t + 14 * 3600000, 0, 'round4')

    // 今天单日查询 [t, t + 24h)
    const todayResult = await searchCalendar({ from: t, to: t + 86400000, limit: 100 })
    const todayTitles = todayResult.items.map(i => i.title)
    expect(todayTitles).toContain('REVIEW跨天会议')
    expect(todayTitles).toContain('REVIEW起点午夜')   // 修复前丢失，修复后必须包含
    expect(todayTitles).toContain('REVIEW今天会议')
    expect(todayTitles).toContain('REVIEW下午零时长')
    expect(todayTitles).not.toContain('REVIEW午夜零时长') // midnight = to 边界排除
    expect(todayResult.total).toBe(4)

    // 本周查询 [monday, monday + 7*24h)
    const weekResult = await searchCalendar({ from: monday, to: monday + 7 * 86400000, limit: 100 })
    const weekTitles = weekResult.items.map(i => i.title)
    expect(weekTitles).toContain('REVIEW跨天会议')
    expect(weekTitles).toContain('REVIEW起点午夜')
    expect(weekTitles).toContain('REVIEW今天会议')
    expect(weekTitles).toContain('REVIEW下午零时长')
    expect(weekTitles).toContain('REVIEW午夜零时长')
    expect(weekResult.total).toBe(5)
  })

  it('支持 start/end 字符串参数与关键词搜索过滤', async () => {
    const from = new Date('2026-10-17T00:00:00').getTime()
    const insert = db.prepare('INSERT INTO calendar_events(id,uid,title,description,location,start,end,recurring,source_id) VALUES(?,?,?,?,?,?,?,?,?)')
    insert.run('e1', 'e1', '早间站会', '项目讨论', '会议室A', from, from, 0, 'src')
    insert.run('e2', 'e2', '下午例会', '进度评审', '会议室B', from + 14 * 3600000, from + 15 * 3600000, 0, 'src')

    // 使用 start/end 参数
    const dateRange = await searchCalendar({ start: '2026-10-17', end: '2026-10-18', query: '' })
    expect(dateRange.items.map(i => i.title)).toEqual(['早间站会', '下午例会'])

    // 关键词过滤
    const filtered = await searchCalendar({ start: '2026-10-17', end: '2026-10-18', query: '站会' })
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0]!.title).toBe('早间站会')
  })
})

describe('parseCalendar 既有测试', () => {
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
})
