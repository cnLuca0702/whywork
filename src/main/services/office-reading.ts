import fs from 'node:fs'
import {resolveWorkspacePath} from '../security/paths'
async function workbook(relativePath:string){const abs=resolveWorkspacePath(relativePath);if(!/\.xlsx$/i.test(abs)||fs.statSync(abs).size>50*1024*1024)throw new Error('仅支持50MB内的xlsx文件');const ExcelJS=await import('exceljs'),book=new ExcelJS.default.Workbook();await book.xlsx.readFile(abs);return book}
export async function xlsxSummary(path:string){const book=await workbook(path);return {sheets:book.worksheets.map(s=>({name:s.name,rows:s.rowCount,columns:s.columnCount,cols:s.columnCount,headers:Array.from({length:Math.min(s.columnCount,50)},(_,i)=>s.getRow(1).getCell(i+1).text.slice(0,200))}))}}
export async function xlsxRead(path:string,sheets:(string|number)[]|undefined,offset:number,limit:number){
 const book=await workbook(path);sheets=sheets?.map(name=>typeof name==='number'?book.worksheets[name]?.name??'':name);if(sheets?.some(name=>!book.worksheets.some(s=>s.name===name)))throw new Error('工作表不存在')
 let remainingBudget=20000
 const results=book.worksheets.filter(s=>!sheets?.length||sheets.includes(s.name)).map(sheet=>{
  const rows:{row:number;cells:string[]}[]=[];let next=offset
  for(;next<=sheet.rowCount&&rows.length<limit;next++){
   const cells=Array.from({length:Math.min(sheet.columnCount,200)},(_,i)=>sheet.getRow(next).getCell(i+1).text)
   const cost=JSON.stringify(cells).length
   if(cost>remainingBudget){if(!rows.length&&remainingBudget===20000)throw new Error('单行超过20000字符预算，请缩小表格列数');break}
   remainingBudget-=cost;rows.push({row:next,cells})
  }
  return {name:sheet.name,rows,remaining:Math.max(0,sheet.rowCount-next+1),nextOffset:next<=sheet.rowCount?next:null,columnLimit:Math.min(sheet.columnCount,200),totalColumns:sheet.columnCount}
 })
 return {sheets:results,content:results.map(s=>`## ${s.name}\n`+s.rows.map(r=>r.cells.join(' | ')).join('\n')).join('\n'),nextOffset:results.find(s=>s.nextOffset!==null)?.nextOffset??null,remainingRows:results.reduce((n,s)=>n+s.remaining,0),usedCharacters:20000-remainingBudget,truncated:results.some(s=>s.remaining>0||s.totalColumns>s.columnLimit)}
}
