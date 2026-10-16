export const shortcutDefaults={focusChat:'CommandOrControl+Alt+Space',newNote:'CommandOrControl+Alt+N'}
export function normalizeShortcut(value:string){
 const tokens=value.split('+').map(s=>s.trim()).filter(Boolean)
 const aliases:Record<string,string>={cmd:'Command',command:'Command',ctrl:'Control',control:'Control',alt:'Alt',option:'Alt',shift:'Shift',commandorcontrol:'CommandOrControl',cmdorctrl:'CommandOrControl',meta:'Command'}
 return tokens.map(s=>aliases[s.toLowerCase()]??(s.length===1?s.toUpperCase():s)).join('+')
}
export function validateShortcuts(pair:{focusChat:string;newNote:string}){
 const canonical=(value:string)=>normalizeShortcut(value).replaceAll('CommandOrControl',process.platform==='darwin'?'Command':'Control').split('+').sort().join('+').toLowerCase()
 for(const value of Object.values(pair)){
  const parts=normalizeShortcut(value).split('+'),mods=parts.filter(p=>['Command','Control','Alt','Shift','CommandOrControl'].includes(p))
  if(!mods.some(p=>p!=='Shift')||parts.length!==mods.length+1||new Set(parts).size!==parts.length)throw new Error('快捷键必须包含 ⌘/⌃/⌥ 之一和一个按键')
  if(parts.some(p=>!['Command','Control','Alt','Shift','CommandOrControl'].includes(p)&&!(/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Up|Down|Left|Right)$/).test(p)))throw new Error('不支持的快捷键')
  if(['Command+Q','Command+W','Command+Tab','Command+Space','Control+Q','Alt+Tab'].some(v=>canonical(v)===canonical(value)))throw new Error('该组合是常见系统快捷键，请选择其他组合')
 }
 if(canonical(pair.focusChat)===canonical(pair.newNote))throw new Error('两项快捷键不能相同')
 return {focusChat:normalizeShortcut(pair.focusChat),newNote:normalizeShortcut(pair.newNote)}
}
