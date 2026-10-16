import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const mock=vi.hoisted(()=>({ws:'',db:null as unknown}))
vi.mock('electron',()=>({app:{getPath:()=>'/synthetic'},shell:{}}))
vi.mock('../src/main/syscalls/app',()=>({getWorkspacePath:()=>mock.ws}))
vi.mock('../src/main/db/client',()=>({getDb:()=>mock.db,dbPath:()=>'',resetDb:()=>{}}))
import Database from 'better-sqlite3'
import {DDL_STATEMENTS,migrateDb} from '../src/main/db/ddl'
import {createNote,searchNotes,updateNoteBody} from '../src/main/db/repos/notes'
import {ocrStatus,ocrImages,attachScannedPdf} from '../src/main/services/ocr-index'
import {createCanvas} from '@napi-rs/canvas'
beforeAll(()=>{mock.ws=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-ocr-'));const db=new Database(':memory:');db.pragma('foreign_keys = ON');for(const stmt of DDL_STATEMENTS)db.exec(stmt);migrateDb(db);mock.db=db})
afterAll(()=>{(mock.db as Database.Database).close();fs.rmSync(mock.ws,{recursive:true,force:true})})
async function finish(id:string){for(let i=0;i<300;i++){const states=ocrStatus(id).items;if(states.some(s=>s.state==='error'))throw new Error(JSON.stringify(states));if(states.length&&states.every(s=>s.state==='done'))return;await new Promise(r=>setTimeout(r,100))}throw new Error('OCR timeout')}
it('recognizes a synthetic image, indexes it and removes the hit after image removal',async()=>{
 const canvas=createCanvas(1200,240),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,240);ctx.fillStyle='black';ctx.font='64px sans-serif';ctx.fillText('SYNTHETIC ORANGE PLAN',30,130)
 fs.mkdirSync(path.join(mock.ws,'resources'),{recursive:true});fs.writeFileSync(path.join(mock.ws,'resources/test.png'),canvas.toBuffer('image/png'))
 const note=createNote({title:'image test',body:'![scan](whywork-res://resources/test.png)'})
 await finish(note.note_id);expect(ocrImages(note.note_id)[0]?.ocrText).toContain('ORANGE')
 expect(searchNotes('ORANGE',10).map(h=>h.noteId)).toContain(note.note_id)
 updateNoteBody(note.note_id,{body:'image removed'});expect(searchNotes('ORANGE',10).map(h=>h.noteId)).not.toContain(note.note_id)
},40000)
it('renders and recognizes the scanned PDF fixture through the same queue',async()=>{
 const note=createNote({title:'scanned pdf',body:'PDF without text',source:'pdf'})
 attachScannedPdf(note.note_id,path.resolve('tests/fixtures/remio-r/importable/pdf/scanned.pdf'))
 await finish(note.note_id);expect(ocrImages(note.note_id)[0]?.ocrText).toContain('OCR_MARKER_742');expect(searchNotes('OCR_MARKER_742',10).map(h=>h.noteId)).toContain(note.note_id)
},40000)
