import crypto from 'node:crypto'
export const AUTH_ISSUER='https://auth.openai.com'
export const AUTH_ENDPOINT=AUTH_ISSUER+'/api/accounts/authorize'
export const TOKEN_ENDPOINT=AUTH_ISSUER+'/api/accounts/oauth/token'
export const RESOURCE='https://api.openai.com/v1'
export const SCOPE='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export interface LoginAttempt {state:string;nonce:string;verifier:string;redirectUri:string;clientId:string;hostId:string;expiresAt:number;subject?:string}
export function createAttempt(port:number,hostId:string,clientId='dynamic_agent_client',subject?:string):LoginAttempt {
 if(!Number.isInteger(port)||port<1||port>65535||!hostId)throw new Error('登录回调配置无效')
 return{state:crypto.randomBytes(32).toString('base64url'),nonce:crypto.randomBytes(32).toString('base64url'),verifier:crypto.randomBytes(64).toString('base64url'),redirectUri:`http://127.0.0.1:${port}/auth/callback`,clientId,hostId,expiresAt:Date.now()+600000,subject}
}
export function authorizationUrl(a:LoginAttempt):string{
 const p=new URLSearchParams({client_id:a.clientId,ext_agent_host_id:a.hostId,response_type:'code',redirect_uri:a.redirectUri,scope:SCOPE,resource:RESOURCE,state:a.state,nonce:a.nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(a.verifier).digest('base64url')})
 if(a.clientId==='dynamic_agent_client')p.set('agent_name_hint','WhyWork')
 return AUTH_ENDPOINT+'?'+p.toString()
}
export function callbackGrant(a:LoginAttempt,query:URLSearchParams):{code:string;clientId:string}{
 if(Date.now()>a.expiresAt)throw new Error('登录已过期，请从 WhyWork 重新发起')
 if(query.getAll('state').length!==1||query.get('state')!==a.state)throw new Error('登录状态不匹配，请重新发起')
 if(query.has('error'))throw new Error(query.get('error')==='access_denied'?'已取消 ChatGPT 授权':'官方授权未完成，请重新发起')
 const id=query.get('client_id')||a.clientId,code=query.get('code')
 if(query.getAll('code').length!==1||query.getAll('client_id').length>1||!code||!/^oaiapp_[A-Za-z0-9_-]+$/.test(id))throw new Error('授权回调缺少有效的注册标识或授权码')
 if(a.clientId!=='dynamic_agent_client'&&id!==a.clientId)throw new Error('返回的注册标识与所选账号不一致')
 return{code,clientId:id}
}
export function exchangeBody(a:LoginAttempt,grant:{code:string;clientId:string}):URLSearchParams{
 return new URLSearchParams({grant_type:'authorization_code',client_id:grant.clientId,code:grant.code,code_verifier:a.verifier,redirect_uri:a.redirectUri,resource:RESOURCE})
}
export interface Identity {sub:string;email?:string;iss:string;aud:string|string[];exp:number;iat:number;nonce?:string;azp?:string;nbf?:number}
interface Jwk extends crypto.JsonWebKey{kid?:string;alg?:string;use?:string}
export function verifyIdentity(token:string,jwks:{keys:Jwk[]},clientId:string,nonce?:string,subject?:string):Identity{
 try{
  if(token.length>65536)throw new Error()
  const parts=token.split('.');if(parts.length!==3)throw new Error()
  const [h,p,s]=parts as [string,string,string],header=JSON.parse(Buffer.from(h,'base64url').toString()) as {alg:string;kid:string;crit?:unknown}
  if(!['RS256','ES256'].includes(header.alg)||!header.kid||header.crit)throw new Error()
  const key=jwks.keys.find(k=>k.kid===header.kid&&(!k.use||k.use==='sig')&&(!k.alg||k.alg===header.alg))
  if(!key||(header.alg==='RS256'&&key.kty!=='RSA')||(header.alg==='ES256'&&(key.kty!=='EC'||key.crv!=='P-256')))throw new Error()
  const publicKey=crypto.createPublicKey({key,format:'jwk'})
  if(!crypto.verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:header.alg==='ES256'?'ieee-p1363':'der'},Buffer.from(s,'base64url')))throw new Error()
  const c=JSON.parse(Buffer.from(p,'base64url').toString()) as Identity,now=Date.now()/1000
  if(c.iss!==AUTH_ISSUER||!c.sub||typeof c.sub!=='string'||!Number.isFinite(c.exp)||!Number.isFinite(c.iat)||c.exp<=now-5||c.iat>now+5||(c.nbf!==undefined&&(!Number.isFinite(c.nbf)||c.nbf>now+5)))throw new Error()
  if(!(typeof c.aud==='string'?c.aud===clientId:Array.isArray(c.aud)&&c.aud.includes(clientId)))throw new Error()
  if((Array.isArray(c.aud)&&c.aud.length>1||c.azp!==undefined)&&c.azp!==clientId)throw new Error()
  if(nonce!==undefined&&c.nonce!==nonce||subject!==undefined&&c.sub!==subject)throw new Error()
  return c
 }catch{throw new Error('官方身份校验失败，未保存登录凭据，请重新发起登录')}
}
export function planAllowed(scopes:string[]):boolean{return scopes.includes('chatgpt.tokens.use.direct')&&scopes.includes('resource.invoke')}
export function safeErrorCode(body:unknown):string{
 if(!body||typeof body!=='object')return 'unknown_error'
 const e=(body as {error?:unknown}).error
 const code=typeof e==='string'?e:e&&typeof e==='object'?(e as {code?:unknown}).code:undefined
 return typeof code==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(code)?code:'unknown_error'
}
