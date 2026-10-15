import type { Cell, BorderStyle } from 'exceljs'
import type { SheetStyle } from '../../shared/office'

const borderNames: (BorderStyle|undefined)[] = [undefined,'thin','hair','dotted','dashed','dashDot','dashDotDot','double','medium','mediumDashed','mediumDashDot','mediumDashDotDot','slantDashDot','thick']
const sides = [['top','t'],['right','r'],['bottom','b'],['left','l']] as const
const rgb = (argb?: string) => argb && /^[\da-f]{6,8}$/i.test(argb) ? '#'+argb.slice(-6) : undefined
function argb(color?: {rgb?:string|null|void}|null|void): string|undefined {
  const value=color?.rgb
  if(!value)return undefined
  if(/^#[\da-f]{6}$/i.test(value))return 'FF'+value.slice(1).toUpperCase()
  const m=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value)
  if(m&&m.slice(1).every(n=>Number(n)<=255))return 'FF'+m.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('').toUpperCase()
  throw new Error('不支持的单元格颜色')
}
export function readCellStyle(cell:Cell):SheetStyle {
  const f=cell.font??{},a=cell.alignment??{},s:SheetStyle={
    ff:f.name,fs:f.size,bl:f.bold?1:0,it:f.italic?1:0,ul:{s:f.underline?1:0},st:{s:f.strike?1:0},
    ht:({left:1,center:2,right:3,justify:4,distributed:6} as const)[a.horizontal as 'left']??0,
    vt:({top:1,middle:2,bottom:3} as const)[a.vertical as 'top']??0,tb:a.wrapText?3:1,
    n:{pattern:cell.numFmt||'General'}
  }
  const color=rgb(f.color?.argb);if(color)s.cl={rgb:color}
  if(cell.fill?.type==='pattern'&&cell.fill.pattern==='solid') {const fill=rgb(cell.fill.fgColor?.argb);if(fill)s.bg={rgb:fill}}
  for(const [name,key] of sides) {const b=cell.border?.[name];if(b?.style){s.bd??={};s.bd[key]={s:borderNames.indexOf(b.style),cl:{rgb:rgb(b.color?.argb)??'#000000'}}}}
  return s
}
export function writeCellStyle(cell:Cell,s:SheetStyle,previous:SheetStyle={}):void {
  const changed=(key:keyof SheetStyle)=>JSON.stringify(s[key])!==JSON.stringify(previous[key])
  const f={...cell.font},a={...cell.alignment}
  if(changed('ff'))f.name=s.ff??undefined
  if(changed('fs')) {if(s.fs!==undefined&&(!Number.isFinite(s.fs)||s.fs<1||s.fs>409))throw new Error('非法字号');f.size=s.fs}
  if(changed('bl'))f.bold=s.bl===1
  if(changed('it'))f.italic=s.it===1
  if(changed('ul'))f.underline=s.ul?.s===1
  if(changed('st'))f.strike=s.st?.s===1
  if(changed('cl')){const c=argb(s.cl);f.color=c?{argb:c}:undefined}
  if(changed('bg')){const c=argb(s.bg);cell.fill=c?{type:'pattern',pattern:'solid',fgColor:{argb:c}}:{type:'pattern',pattern:'none'}}
  if(changed('ht'))a.horizontal=({1:'left',2:'center',3:'right',4:'justify',5:'justify',6:'distributed'} as const)[s.ht as 1]
  if(changed('vt'))a.vertical=({1:'top',2:'middle',3:'bottom'} as const)[s.vt as 1]
  if(changed('tb'))a.wrapText=s.tb===3
  if(changed('n'))cell.numFmt=s.n?.pattern??'General'
  if(changed('bd')) {
    const borders={...cell.border}
    for(const [name,key] of sides){const b=s.bd?.[key],style=b?borderNames[b.s]:undefined;borders[name]=style?{style,color:{argb:argb(b?.cl)??'FF000000'}}:undefined}
    cell.border=borders
  }
  cell.font=f;cell.alignment=a
}
