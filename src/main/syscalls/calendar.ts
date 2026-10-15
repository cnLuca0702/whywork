import fs from 'node:fs'
import crypto from 'node:crypto'
import {dialog} from 'electron'
import {z} from 'zod'
import {register} from './registry'
import {getDb} from '../db/client'
export interface CalendarItem {id:string;uid:string;title:string;description:string;location:string;start:number;end:number;recurring:boolean}
function tables():void{getDb().exec('CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,uid TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,location TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,recurring INTEGER NOT NULL,source_id TEXT NOT NULL)')}
export async function parseCalendar(text:string,from=new Date(Date.now()-30*86400000),to=new Date(Date.now()+366*86400000)):Promise<CalendarItem[]> {
  if(/RRULE:[^\r\n]*FREQ=(SECONDLY|MINUTELY)/i.test(text)) throw new Error('暂不支持分钟或秒级重复事件')
  const ical=await import('node-ical'),parsed=ical.sync.parseICS(text)
  const out:CalendarItem[]=[]
  for(const component of Object.values(parsed)) {
    if(!component || component.type!=='VEVENT')continue
    const event=component as import('node-ical').VEvent
    const instances=ical.expandRecurringEvent(event,{from,to,includeOverrides:true,excludeExdates:true})
    if(instances.length>1000)throw new Error('重复事件超过1000条，请缩短日期范围')
    for(const instance of instances) {
      const ev=instance.event
      out.push({id:crypto.randomUUID(),uid:ev.uid??'',title:String(instance.summary??''),description:String(ev.description??''),location:String(ev.location??''),start:instance.start.getTime(),end:instance.end.getTime(),recurring:instance.isRecurring})
    }
  }
  return out.sort((a,b)=>a.start-b.start)
}
export function registerCalendarDomain():void {
  register('calendar',{
    import:{handler:async(_p,ctx)=>{
      const r=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'日历',extensions:['ics']}]})
      if(r.canceled||!r.filePaths[0])return{canceled:true}
      if(fs.statSync(r.filePaths[0]).size>10_000_000)throw new Error('日历文件过大')
      const items=await parseCalendar(fs.readFileSync(r.filePaths[0],'utf8'))
      tables();const source=crypto.createHash('sha256').update(fs.readFileSync(r.filePaths[0])).digest('hex')
      getDb().transaction(()=>{
        getDb().prepare('DELETE FROM calendar_events WHERE source_id=?').run(source)
        const insert=getDb().prepare('INSERT INTO calendar_events(id,uid,title,description,location,start,end,recurring,source_id) VALUES(@id,@uid,@title,@description,@location,@start,@end,@recurring,@source)')
        for(const item of items)insert.run({...item,recurring:item.recurring?1:0,source})
      })();ctx.emit('calendar.changed',{});return{canceled:false,imported:items.length,range:'过去30日至未来一年'}
    }},
    search:{schema:z.object({query:z.string().default(''),from:z.number().optional(),to:z.number().optional()}),handler:async(p:{query:string;from?:number;to?:number})=>{
      tables();return{items:getDb().prepare('SELECT * FROM calendar_events WHERE end>=? AND start<=? AND (title LIKE ? OR description LIKE ? OR location LIKE ?) ORDER BY start LIMIT 200').all(p.from??Date.now()-30*86400000,p.to??Date.now()+366*86400000,...Array(3).fill('%'+p.query+'%'))}
    }}
  })
}
