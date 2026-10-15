import http from 'node:http'
import crypto from 'node:crypto'
import {getDb} from '../db/client'
let server:http.Server|null=null
let token='',expires=0
export async function stopPairing():Promise<void> {
  const s=server;server=null;token='';expires=0
  if(s)await new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections()})
}
export async function startPairing():Promise<{url:string;qr:string;expires:number;scope:string}> {
  await stopPairing();token=crypto.randomBytes(32).toString('hex');expires=Date.now()+5*60000
  const s=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8')
    const fail=(status:number,message:string)=>{res.writeHead(status);res.end(JSON.stringify({error:message}))}
    if(req.method!=='POST'||req.url!=='/pair'){fail(404,'not found');return}
    if(req.headers.origin){fail(403,'origin not allowed');return}
    let size=0,body=''
    try {
      for await(const data of req){size+=data.length;if(size>10000){fail(413,'payload too large');return}body+=data.toString()}
      const input=JSON.parse(body) as {token?:string;name?:string;platform?:string;pubkey?:string}
      if(!token||Date.now()>expires||typeof input.token!=='string'||input.token.length!==token.length||!crypto.timingSafeEqual(Buffer.from(input.token),Buffer.from(token))){fail(403,'token invalid or expired');return}
      if(!input.name||input.name.length>100||!input.pubkey||input.pubkey.length<32||input.pubkey.length>4096){fail(400,'invalid device');return}
      const id=crypto.randomUUID()
      getDb().prepare('INSERT INTO devices(device_id,name,platform,pubkey,paired_at,last_seen) VALUES(?,?,?,?,?,?)').run(id,input.name,(input.platform??'unknown').slice(0,30),input.pubkey,Date.now(),Date.now())
      token='';res.end(JSON.stringify({deviceId:id,paired:true,sync:false}))
    }catch{fail(400,'invalid request')}
  })
  await new Promise<void>((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>{s.off('error',reject);resolve()})})
  server=s;const address=s.address() as {port:number}
  const url=`whywork://pair?endpoint=${encodeURIComponent(`http://127.0.0.1:${address.port}/pair`)}&token=${token}`
  const QR=await import('qrcode')
  const qr=await QR.toDataURL(url)
  return{url,qr,expires,scope:'本机开发骨架；手机端及局域网安全配对尚未接入'}
}
