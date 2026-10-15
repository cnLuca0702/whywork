import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { WorkbookSnapshot, SheetStyle } from '../../shared/office'
import { resolveWorkspacePath } from '../security/paths'
import { snapshotBeforeWrite } from '../agent/vault'
import { readCellStyle, writeCellStyle } from './office-style'
const sessions=new Map<string,{relativePath:string;hash:string;baseline:WorkbookSnapshot}>()
const hash=(data:Buffer)=>crypto.createHash('sha256').update(data).digest('hex')
const styleOf=(snapshot:WorkbookSnapshot,style?:SheetStyle|string|null):SheetStyle=>typeof style==='string'?snapshot.styles?.[style]??{}:style??{}
const sameValue=(a:{v?:unknown;f?:string}|undefined,b:{v?:unknown;f?:string}|undefined)=>JSON.stringify([a?.v??null,a?.f??''])===JSON.stringify([b?.v??null,b?.f??''])
function index(value:string,limit:number):number {const n=Number(value);if(!Number.isInteger(n)||n<0||n>=limit)throw new Error('非法行列地址');return n+1}
export async function openWorkbook(relativePath:string):Promise<{sessionId:string;snapshot:WorkbookSnapshot;warning:string}> {
  const ExcelJS=await import('exceljs'),workbook=new ExcelJS.default.Workbook()
  const absolute=resolveWorkspacePath(relativePath)
  await workbook.xlsx.readFile(absolute)
  const snapshot:WorkbookSnapshot={id:crypto.randomUUID(),name:path.basename(absolute),appVersion:'1.0.4',locale:'zhCN',sheetOrder:[],sheets:{}}
  for(const sheet of workbook.worksheets) {
    const id='sheet-'+sheet.id
    const cellData:WorkbookSnapshot['sheets'][string]['cellData']={}
    if(sheet.rowCount>200000||sheet.rowCount*Math.max(sheet.columnCount,1)>2000000)throw new Error('工作表超出当前编辑器的交互容量')
    sheet.eachRow({includeEmpty:true},(row,r)=>row.eachCell({includeEmpty:true},(cell,c)=>{
      if(cell.isMerged&&cell.master.address!==cell.address)return
      if(cell.value===null&&Object.keys(cell.style??{}).length===0)return
      const value=cell.value
      const data=cell.formula?{f:'='+cell.formula,v:cell.result as string|number|boolean|null}:
        {v:value instanceof Date?(value.getTime()/86400000+25569-(workbook.properties.date1904?1462:0)):typeof value==='number'||typeof value==='boolean'?value:cell.text}
      Object.assign(data,{s:readCellStyle(cell)})
      ;(cellData[String(r-1)]??={})[String(c-1)]=data
    }))
    const rowData:NonNullable<WorkbookSnapshot['sheets'][string]['rowData']>={},columnData:NonNullable<WorkbookSnapshot['sheets'][string]['columnData']>={}
    sheet.eachRow({includeEmpty:true},(row,r)=>{if(row.height!==undefined||row.hidden)rowData[String(r-1)]={...(row.height===undefined?{}:{h:row.height*4/3}),hd:row.hidden?1:0}})
    sheet.columns.forEach((col,c)=>{if(col.width!==undefined||col.hidden)columnData[String(c)]={...(col.width===undefined?{}:{w:col.width*7+5}),hd:col.hidden?1:0}})
    const mergeData=(sheet.model.merges??[]).map(range=>{const [from,to]=range.split(':');const a=sheet.getCell(from!),b=sheet.getCell(to??from!);return{startRow:Number(a.row)-1,endRow:Number(b.row)-1,startColumn:Number(a.col)-1,endColumn:Number(b.col)-1}})
    snapshot.sheetOrder.push(id);snapshot.sheets[id]={id,name:sheet.name,rowCount:Math.max(sheet.rowCount+100,1000),columnCount:Math.max(sheet.columnCount+10,26),cellData,rowData,columnData,mergeData}
  }
  const sessionId=crypto.randomUUID()
  sessions.set(sessionId,{relativePath,hash:hash(fs.readFileSync(absolute)),baseline:structuredClone(snapshot)})
  return{sessionId,snapshot,warning:'编辑工作区副本：支持值、公式、常用字体/颜色/对齐/数字格式、边框、合并和行列尺寸。暂不支持增删或重排工作表；图表、透视表及宏不在此编辑器的兼容范围内。'}
}
export async function saveWorkbook(sessionId:string,snapshot:WorkbookSnapshot):Promise<{relativePath:string}> {
  const session=sessions.get(sessionId);if(!session)throw new Error('工作簿会话已失效，请重新打开')
  const absolute=resolveWorkspacePath(session.relativePath)
  if(hash(fs.readFileSync(absolute))!==session.hash)throw new Error('文件已被其他程序修改，请重新打开后保存')
  const ExcelJS=await import('exceljs'),workbook=new ExcelJS.default.Workbook()
  await workbook.xlsx.readFile(absolute)
  if(!snapshot||JSON.stringify(snapshot.sheetOrder)!==JSON.stringify(session.baseline.sheetOrder))throw new Error('目前不支持增删或重排工作表，请保留原工作表结构')
  const names=new Set<string>();let count=0
  for(const id of snapshot.sheetOrder){const model=snapshot.sheets[id];if(!model||!model.cellData||typeof model.name!=='string'||!model.name||model.name.length>31||/[\\/*?:\[\]]/.test(model.name)||names.has(model.name.toLowerCase()))throw new Error('非法或重复工作表名称');names.add(model.name.toLowerCase());for(const cells of Object.values(model.cellData))count+=Object.keys(cells).length}
  if(count>200000)throw new Error('此编辑器单次最多保存200000个单元格')
  // Temporary names avoid collisions when two sheet names are exchanged.
  for(const sheet of workbook.worksheets)sheet.name='ww-'+crypto.randomUUID().slice(0,20)
  for(const sheet of workbook.worksheets) {
    const model=snapshot.sheets['sheet-'+sheet.id];if(!model)throw new Error('工作表结构变更暂不支持')
    const before=session.baseline.sheets['sheet-'+sheet.id]!
    sheet.name=model.name
    const changedMerges=JSON.stringify(model.mergeData??[])!==JSON.stringify(before.mergeData??[])
    if(changedMerges)for(const range of [...sheet.model.merges])sheet.unMergeCells(range)
    // Clear omitted cells too, so deleting a value in the editor persists.
    sheet.eachRow((row,r)=>row.eachCell((cell,c)=>{
      if(cell.isMerged&&cell.master.address!==cell.address)return
      if(!model.cellData[String(r-1)]?.[String(c-1)])cell.value=null
    }))
    for(const [r,cells] of Object.entries(model.cellData))for(const [c,data] of Object.entries(cells)) {
      const row=index(r,1048576),column=index(c,16384)
      const cell=sheet.getCell(row,column)
      const previous=before.cellData[r]?.[c]
      if(!sameValue(data,previous))cell.value=data.f?{formula:data.f.replace(/^=/,''),result:typeof data.v==='boolean'||typeof data.v==='number'||typeof data.v==='string'?data.v:undefined}:data.v??null
      writeCellStyle(cell,styleOf(snapshot,data.s),styleOf(session.baseline,previous?.s))
    }
    for(const r of new Set([...Object.keys(before.rowData??{}),...Object.keys(model.rowData??{})])){const row=sheet.getRow(index(r,1048576)),data=model.rowData?.[r];if(data?.h!==undefined&&(!Number.isFinite(data.h)||data.h<0||data.h>546))throw new Error('非法行高');row.height=data?.h===undefined?(sheet.properties.defaultRowHeight??15):data.h*3/4;row.hidden=data?.hd===1}
    for(const c of new Set([...Object.keys(before.columnData??{}),...Object.keys(model.columnData??{})])){const col=sheet.getColumn(index(c,16384)),data=model.columnData?.[c];if(data?.w!==undefined&&(!Number.isFinite(data.w)||data.w<0||data.w>1790))throw new Error('非法列宽');col.width=data?.w===undefined?(sheet.properties.defaultColWidth??8.43):Math.max(0,(data.w-5)/7);col.hidden=data?.hd===1}
    if(changedMerges)for(const m of model.mergeData??[]){const a=index(String(m.startRow),1048576),b=index(String(m.endRow),1048576),c=index(String(m.startColumn),16384),d=index(String(m.endColumn),16384);if(b<a||d<c||(b-a+1)*(d-c+1)>200000)throw new Error('非法合并区域');sheet.mergeCells(a,c,b,d)}
  }
  const tmp=absolute+'.'+crypto.randomUUID()+'.tmp'
  try {
    await workbook.xlsx.writeFile(tmp)
    snapshotBeforeWrite(session.relativePath,'modify')
    if(hash(fs.readFileSync(absolute))!==session.hash)throw new Error('保存期间文件已被其他程序修改，请重新打开')
    fs.renameSync(tmp,absolute);session.hash=hash(fs.readFileSync(absolute));session.baseline=structuredClone(snapshot)
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
  return{relativePath:session.relativePath}
}
export async function createDocx(title:string,markdown:string):Promise<string> {
  const {markdownDocxBuffer}=await import('./office-docx')
  const data=await markdownDocxBuffer(title,markdown)
  const relativePath=path.join('resources','office',crypto.randomUUID()+'.docx'),target=resolveWorkspacePath(relativePath)
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);return relativePath
}
export async function createSlides(title:string,slides:{title:string;bullets:string[]}[]):Promise<string> {
  const {default:PptxGenJS}=await import('pptxgenjs'),deck=new PptxGenJS()
  deck.layout='LAYOUT_WIDE';deck.author='WhyWork';deck.subject=title;deck.title=title;
  deck.theme={headFontFace:'PingFang SC',bodyFontFace:'PingFang SC'}
  for(const item of slides) {
    const slide=deck.addSlide();slide.background={color:'F7F9FF'}
    slide.addText(item.title,{x:0.7,y:0.5,w:12,h:0.7,fontSize:28,bold:true,color:'1E3A8A',breakLine:false})
    slide.addText(item.bullets.map(text=>({text,options:{bullet:{indent:20},breakLine:true}})),{x:0.9,y:1.6,w:11.6,h:4.8,fontSize:20,color:'1F2937',paraSpaceAfter:14,fit:'shrink'})
    slide.addText('WhyWork',{x:11.5,y:7,w:1,h:0.2,fontSize:9,color:'64748B'})
  }
  const relativePath=path.join('resources','office',crypto.randomUUID()+'.pptx'),target=resolveWorkspacePath(relativePath)
  fs.mkdirSync(path.dirname(target),{recursive:true});await deck.writeFile({fileName:target});return relativePath
}
export function closeOfficeSessions():void{sessions.clear()}
