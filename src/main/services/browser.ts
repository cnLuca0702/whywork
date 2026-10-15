import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import type { Browser } from 'playwright'
const execute=promisify(execFile)
const browserDir=()=>process.argv.includes('--browser-check') && process.env.WHYWORK_TEST_BROWSER_PATH ? process.env.WHYWORK_TEST_BROWSER_PATH : path.join(app.getPath('userData'),'browsers')
let browser:Browser|null=null
let launching:Promise<Browser>|null=null
let installing:Promise<void>|null=null
export async function prepareBrowser():Promise<void> {
  if(installing)return installing
  process.env.PLAYWRIGHT_BROWSERS_PATH=browserDir()
  const req=createRequire(path.join(app.getAppPath(),'package.json'))
  const cli=path.join(path.dirname(req.resolve('playwright/package.json')),'cli.js')
  installing=execute(process.execPath,[cli,'install','chromium'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:240000,maxBuffer:2_000_000}).then(()=>undefined)
  try{await installing}finally{installing=null}
}
async function getBrowser():Promise<Browser> {
  if(browser?.isConnected())return browser
  if(launching)return launching
  launching=(async()=>{
    process.env.PLAYWRIGHT_BROWSERS_PATH=browserDir()
    const {chromium}=await import('playwright')
    if(!fs.existsSync(chromium.executablePath()))await prepareBrowser()
    browser=await chromium.launch({headless:true})
    return browser
  })()
  try{return await launching}finally{launching=null}
}
export async function closeBrowser():Promise<void>{const b=browser;browser=null;await b?.close()}
export async function browserPage(url:string,script?:string):Promise<{url:string;title:string;text:string;result?:unknown}> {
  const parsed=new URL(url)
  if(!['http:','https:'].includes(parsed.protocol))throw new Error('仅支持 HTTP/HTTPS 网页')
  const instance=await getBrowser(),context=await instance.newContext({acceptDownloads:false})
  const page=await context.newPage();page.setDefaultTimeout(30000)
  try {
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
    const result=script?await page.evaluate(script):undefined
    return{url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,50000),...(script?{result}:{})}
  }finally{await context.close()}
}
