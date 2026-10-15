import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dialog } from 'electron'
import { z } from 'zod'
import {register,invokeSys} from './registry'
import {resolveWorkspacePath} from '../security/paths'
import {openWorkbook,saveWorkbook,createDocx,createSlides} from '../services/office'
import type {WorkbookSnapshot} from '../../shared/office'
import {noteMarkdownForExport} from '../services/note-export'
export function registerOfficeDomain():void {
  register('office',{
    open_xlsx:{handler:async(_p,ctx)=>{
      const picked=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Excel',extensions:['xlsx']}]})
      if(picked.canceled||!picked.filePaths[0])return{canceled:true}
      const relativePath=path.join('resources','office',crypto.randomUUID()+'.xlsx'),target=resolveWorkspacePath(relativePath)
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(picked.filePaths[0],target)
      return{canceled:false,...await openWorkbook(relativePath)}
    }},
    read_xlsx:{schema:z.object({path:z.string()}),handler:async(p:{path:string})=>openWorkbook(p.path)},
    save_xlsx:{schema:z.object({sessionId:z.string(),snapshot:z.unknown()}),handler:async(p:{sessionId:string;snapshot:WorkbookSnapshot})=>saveWorkbook(p.sessionId,p.snapshot)},
    note_docx:{schema:z.object({noteId:z.string()}),handler:async(p:{noteId:string},ctx)=>{
      const r=await invokeSys('notes.get',p,ctx);if(!r.ok)throw new Error(r.error.message)
      const n=r.data as {body:string;note:{title:string}}
      return{path:await createDocx(n.note.title,noteMarkdownForExport(n.body)),warning:'保留标题、常用文字格式、列表、表格、链接、代码块与工作区图片。数学公式保持源码，复杂分页和原Word版式不还原。'}
    }},
    slides:{schema:z.object({title:z.string(),slides:z.array(z.object({title:z.string().max(150),bullets:z.array(z.string().max(500)).max(12)})).min(1).max(40)}),handler:async(p:{title:string;slides:{title:string;bullets:string[]}[]})=>({path:await createSlides(p.title,p.slides)})},
    ai_slides:{schema:z.object({noteId:z.string(),instruction:z.string().max(2000).default('制作五页中文演示文稿')}),handler:async(p:{noteId:string;instruction:string},ctx)=>{
      const n=await invokeSys('notes.get',{noteId:p.noteId},ctx);if(!n.ok)throw new Error(n.error.message)
      const note=n.data as {body:string;note:{title:string}}
      const r=await invokeSys('llm.complete',{messages:[{role:'system',content:'仅依据提供资料，不补充不存在的事实。输出JSON {"slides":[{"title":"标题","bullets":["要点"]}]}。每页3至6条要点。'},{role:'user',content:p.instruction+'\n'+note.body.slice(0,18000)}]},ctx)
      if(!r.ok)throw new Error(r.error.message)
      const text=(r.data as {text:string}).text.replace(/^```(?:json)?\s*|\s*```$/g,'').trim()
      const parsed=z.object({slides:z.array(z.object({title:z.string().max(150),bullets:z.array(z.string().max(500)).max(12)})).min(1).max(40)}).parse(JSON.parse(text))
      return{path:await createSlides(note.note.title,parsed.slides),sourceNoteId:p.noteId}
    }}
  })
}
