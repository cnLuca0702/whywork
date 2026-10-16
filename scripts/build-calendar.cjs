const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
function buildCalendar(target){
 if(process.platform!=='darwin')throw new Error('系统日历辅助程序只能在macOS构建')
 fs.mkdirSync(path.dirname(target),{recursive:true})
 const root=path.resolve(__dirname,'..')
 execFileSync('swiftc',[path.join(root,'native/calendar/main.swift'),'-framework','EventKit','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',path.join(root,'native/calendar/Info.plist'),'-o',target],{stdio:'inherit'})
 execFileSync('codesign',['--force','--sign','-','--timestamp=none',target],{stdio:'inherit'})
}
module.exports={buildCalendar}
if(require.main===module)buildCalendar(path.resolve('out/native/WhyWorkCalendar'))
