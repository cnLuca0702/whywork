import path from 'node:path'
import fs from 'node:fs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {app} from 'electron'
export async function systemCalendar(command:'status'|'connect'|'events',from?:number,to?:number){
 if(process.platform!=='darwin')return {supported:false,authorization:'unsupported',items:[]}
 const helper=app.isPackaged?path.join(process.resourcesPath,'WhyWorkCalendar'):path.join(app.getAppPath(),'out/native/WhyWorkCalendar')
 if(!fs.existsSync(helper))return {supported:true,authorization:'unavailable',items:[]}
 const {stdout}=await promisify(execFile)(helper,[command,...(command==='events'?[String(from),String(to)]:[])],{timeout:command==='connect'?125000:30000,maxBuffer:8*1024*1024})
 return {supported:true,...JSON.parse(stdout)} as {supported:boolean;authorization:string;items?:Record<string,unknown>[]}
}
