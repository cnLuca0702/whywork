import http from 'node:http'
import assert from 'node:assert/strict'
import {browserPage,closeBrowser} from './services/browser'
export async function runBrowserCheck():Promise<void> {
  const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic browser check</title><body><div id="marker"></div><script>document.getElementById("marker").textContent="DYNAMIC_SYNTHETIC_MARKER"</script></body>')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const {port}=server.address() as {port:number}
    const page=await browserPage(`http://127.0.0.1:${port}`,'document.querySelector("#marker").textContent')
    assert.equal(page.title,'Synthetic browser check');assert(page.text.includes('DYNAMIC_SYNTHETIC_MARKER'));assert.equal(page.result,'DYNAMIC_SYNTHETIC_MARKER')
    console.log('[BROWSER-CHECK] isolated dynamic-page fetch and eval PASS')
  }finally{await closeBrowser();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
