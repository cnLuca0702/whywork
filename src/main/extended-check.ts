import { scanSkills,enabledSkillTexts } from './syscalls/mcp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {safeStorage,nativeImage} from 'electron'
import {getWorkspacePath} from './syscalls/app'
import {resolveWorkspacePath} from './security/paths'
import {openWorkbook,saveWorkbook,createDocx,createSlides} from './services/office'
import {importMailSource} from './syscalls/mail'
import {startPairing,stopPairing} from './services/pairing'
import {getDb} from './db/client'
import {saveServer,refreshTools,callTool,deleteServer,closeAll} from './mcp/manager'
import {invokeSys,type SysContext} from './syscalls/registry'
import {runAgent} from './agent/loop'
import {upsertProvider} from './providers/store'
import {respondConfirmation} from './agent/confirmation'
import * as repo from './db/repos/notes'
import {importFile,relinkLocalImages} from './services/importer'
import {resourcePath} from './security/paths'
export async function runExtendedChecks():Promise<void> {
  const ctx:SysContext={win:()=>null,emit:()=>undefined}
  const skill=path.join(getWorkspacePath(),'.whywork/skills/synthetic/SKILL.md')
  fs.mkdirSync(path.dirname(skill),{recursive:true});fs.writeFileSync(skill,'---\nname: synthetic\ndescription: Synthetic test only\n---\nSYNTHETIC_SKILL_ONLY')
  assert.equal(scanSkills().length,1);assert(enabledSkillTexts().some(t=>t.includes('SYNTHETIC_SKILL_ONLY')))
  getDb().prepare('UPDATE skills SET enabled=0 WHERE name=?').run('synthetic');assert.equal(enabledSkillTexts().length,0)
  assert.equal(scanSkills()[0]?.enabled,false)
  const ExcelJS=await import('exceljs'),JSZip=(await import('jszip')).default
  const xlsx=resolveWorkspacePath('resources/synthetic.xlsx'),book=new ExcelJS.default.Workbook(),sheet=book.addWorksheet('合成表')
  sheet.getCell('A1').value='保留';sheet.getCell('B1').value={formula:'1+2',result:3};sheet.getCell('A1').font={bold:true}
  sheet.getCell('A2').value=new Date('2026-10-01T00:00:00.000Z');sheet.getCell('A2').numFmt='yyyy-mm-dd'
  sheet.getCell('B2').value={text:'链接',hyperlink:'https://example.invalid/'}
  sheet.mergeCells('A3:B3');sheet.getCell('A3').value='合并值';sheet.getCell('C4').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF112233'}}
  sheet.getRow(3).height=30;sheet.getColumn(2).width=22
  await book.xlsx.writeFile(xlsx)
  const opened=await openWorkbook('resources/synthetic.xlsx'),id=opened.snapshot.sheetOrder[0]!
  const modelSheet=opened.snapshot.sheets[id]!
  assert.equal(modelSheet.mergeData?.length,1);assert.equal(modelSheet.rowData?.['2']?.h,40)
  assert.equal((modelSheet.cellData['3']!['2']!.s as {bg:{rgb:string}}).bg.rgb,'#112233')
  modelSheet.cellData['0']!['0']!.v='已更新'
  opened.snapshot.styles={changed:{bl:1,it:1,cl:{rgb:'#123456'},n:{pattern:'0.00'},ht:2,vt:2,tb:3,bd:{b:{s:1,cl:{rgb:'#abcdef'}}}}}
  modelSheet.cellData['0']!['1']!.s='changed';modelSheet.columnData!['1']={w:215};modelSheet.rowData!['2']={h:48}
  await saveWorkbook(opened.sessionId,opened.snapshot)
  const checked=new ExcelJS.default.Workbook();await checked.xlsx.readFile(xlsx)
  assert.equal(checked.worksheets[0]!.getCell('A1').value,'已更新');assert.equal(checked.worksheets[0]!.getCell('B1').formula,'1+2');assert.equal(checked.worksheets[0]!.getCell('A1').font.bold,true)
  const verified=checked.worksheets[0]!
  assert.equal(verified.getCell('A3').value,'合并值');assert.equal(verified.getCell('B3').value,'合并值')
  assert.equal((verified.getCell('A2').value as Date).toISOString(),'2026-10-01T00:00:00.000Z');assert.equal(verified.getCell('B2').hyperlink,'https://example.invalid/')
  assert.equal(verified.getCell('B1').font.color?.argb,'FF123456');assert.equal(verified.getCell('B1').numFmt,'0.00');assert.equal(verified.getCell('B1').alignment.horizontal,'center');assert.equal(verified.getRow(3).height,36);assert.equal(verified.getColumn(2).width,30)
  modelSheet.mergeData=[];modelSheet.cellData['2']!['1']={v:'拆分后'};await saveWorkbook(opened.sessionId,opened.snapshot)
  const unmerged=new ExcelJS.default.Workbook();await unmerged.xlsx.readFile(xlsx);assert.equal(unmerged.worksheets[0]!.getCell('B3').value,'拆分后');assert.equal(unmerged.worksheets[0]!.getCell('A3').value,'合并值')
  fs.appendFileSync(xlsx,'external-change');await assert.rejects(saveWorkbook(opened.sessionId,opened.snapshot),/其他程序修改/)
  const pixel=nativeImage.createFromBitmap(Buffer.alloc(4*4*4,255),{width:4,height:4}).toPNG()
  fs.writeFileSync(resolveWorkspacePath('resources/docx-pixel.png'),pixel)
  const documentMarkdown='# 标题\n\n文档正文 **加粗** *斜体* ~~删除~~ `代码` [链接](https://example.invalid/)\n\n3. 第三项\n4. 第四项\n\n- 项目甲\n  - 嵌套乙\n\n> 引用正文\n\n```js\nconst n = 1\nconsole.log(n)\n```\n\n| 名称 | 数量 |\n| --- | --- |\n| 甲 | 2 |\n\n![合成像素](whywork-res://resources/docx-pixel.png)'
  const docx=await createDocx('合成文档',documentMarkdown),doc=await JSZip.loadAsync(fs.readFileSync(resolveWorkspacePath(docx)))
  const docXml=await doc.file('word/document.xml')!.async('string')
  for(const marker of ['文档正文','<w:b/>','<w:i/>','<w:strike/>','<w:tbl>','<w:drawing>','<w:hyperlink','<w:numPr>','console.log(n)'])assert(docXml.includes(marker),marker)
  assert((await doc.file('word/numbering.xml')!.async('string')).includes('w:start w:val="3"'))
  assert(Object.keys(doc.files).some(name=>name.startsWith('word/media/')&&name.endsWith('.png')))
  const importedDoc=(await importFile(resolveWorkspacePath(docx)))[0]!
  assert(importedDoc.markdown.includes('**加粗**'));assert.match(importedDoc.markdown,/\| (?:\*\*)?名称(?:\*\*)? \| (?:\*\*)?数量(?:\*\*)? \|/);assert(importedDoc.markdown.includes('data:image/png;base64,'));assert(importedDoc.markdown.includes('https://example.invalid/'))
  const imageRoundtrip=relinkLocalImages(importedDoc.markdown,'docx-roundtrip',importedDoc.baseDir,getWorkspacePath(),'resources/docx-roundtrip')
  assert(!imageRoundtrip.includes('data:image/'))
  const imageUrl=imageRoundtrip.match(/whywork-res:\/\/[^)]+/)![0]
  assert(fs.statSync(resourcePath(imageUrl)).size>0)
  await assert.rejects(createDocx('外部图片拒绝','![external](https://example.invalid/private.png)'),/须先导入/)
  await assert.rejects(createDocx('路径越界拒绝','![external](whywork-res://resources/%2e%2e%2f..%2foutside.png)'),/非法资源目录|路径超出/)
  const pptx=await createSlides('合成演示',[{title:'第一页',bullets:['证据甲','证据乙']}]),slides=await JSZip.loadAsync(fs.readFileSync(resolveWorkspacePath(pptx)))
  assert((await slides.file('ppt/slides/slide1.xml')!.async('string')).includes('证据甲'))
  const mail=await importMailSource(Buffer.from('From: sender@example.invalid\r\nTo: recipient@example.invalid\r\nSubject: Synthetic email\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nMAIL_SYNTHETIC_MARKER'),ctx)
  assert(repo.searchNotes('MAIL_SYNTHETIC_MARKER',10).some(n=>n.noteId===mail.noteId))
  const pairing=await startPairing()
  try {
    assert(pairing.qr.startsWith('data:image/png;base64,'));const u=new URL(pairing.url),endpoint=u.searchParams.get('endpoint')!
    const payload={token:u.searchParams.get('token'),name:'synthetic-phone',platform:'synthetic',pubkey:'x'.repeat(64)}
    const bad=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,token:'bad'})});assert.equal(bad.status,403)
    const good=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(good.status,200)
    const replay=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(replay.status,403)
  }finally{await stopPairing()}
  if(safeStorage.isEncryptionAvailable()) {
    const server=saveServer({name:'synthetic-echo',command:process.execPath,args:[path.resolve('tests/support/mcp-echo.cjs')],env:{ELECTRON_RUN_AS_NODE:'1'}})
    try {
      const tools=await refreshTools(server.id);assert.equal(tools.length,1)
      assert.equal(await callTool(tools[0]!.name,{text:'MCP_SYNTHETIC_MARKER'}),'MCP_SYNTHETIC_MARKER')
    }finally{deleteServer(server.id);closeAll()}
    // Genuine Agent/tool wiring against a synthetic local SSE provider. This is
    // an integration check, not an assertion about a live LLM or RAG quality.
    let step=0,asked=false
    const model=http.createServer(async(req,res)=>{
      let body='';for await(const data of req)body+=data
      const request=JSON.parse(body)
      res.writeHead(200,{'content-type':'text/event-stream'})
      const frame=step++===0?{choices:[{delta:{tool_calls:[{index:0,id:'tool-synthetic',function:{name:'file__write',arguments:'{"path":"resources/agent-created.txt","content":"AGENT_SYNTHETIC_MARKER"}'}}]},finish_reason:'tool_calls'}]}:
        {choices:[{delta:{content:'Done with synthetic tool output.'},finish_reason:'stop'}]}
      if(step===1)assert(request.tools.some((t:{function:{name:string}})=>t.function.name==='file__write'))
      res.end('data: '+JSON.stringify(frame)+'\n\ndata: [DONE]\n\n')
    })
    await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve))
    try {
      const address=model.address() as {port:number}
      upsertProvider({id:'synthetic',kind:'openai-compat',name:'Synthetic only',baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:'synthetic-key',models:{fast:['synthetic'],expert:[]}})
      const chatId='agent-integration',now=Date.now();getDb().prepare('INSERT INTO chats(chat_id,title,created_at,updated_at) VALUES(?,?,?,?)').run(chatId,'synthetic',now,now)
      const agentCtx:SysContext={...ctx,emit:(topic,payload)=>{if(topic==='chat.confirm'){asked=true;const p=payload as {id:string;chatId:string};respondConfirmation(p.id,p.chatId,true)}}}
      const result=await runAgent({ctx:agentCtx,chatId,userText:'Write a synthetic marker',selection:{providerId:'synthetic',model:'synthetic'},onEvent:()=>undefined})
      assert(result.ok);assert(asked);assert.equal(fs.readFileSync(resolveWorkspacePath('resources/agent-created.txt'),'utf8'),'AGENT_SYNTHETIC_MARKER')
      const changes=getDb().prepare('SELECT * FROM vault_changes WHERE chat_id=?').all(chatId);assert.equal(changes.length,1)
      getDb().prepare('DELETE FROM providers WHERE id=?').run('synthetic')
    }finally{await new Promise<void>(resolve=>model.close(()=>resolve()))}
  }
  console.log('[EXTENDED-CHECK] XLSX values/formulas/styles/conflicts, DOCX, PPTX, synthetic EML, one-use pairing, synthetic MCP/Agent/Skills verified')
}
