import {describe,it,expect} from 'vitest'
import crypto from 'node:crypto'
import {createAttempt,authorizationUrl,callbackGrant,exchangeBody,verifyIdentity,planAllowed,safeErrorCode,AUTH_ISSUER,RESOURCE} from '../src/main/providers/chatgpt-oauth'
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
const jwks={keys:[{...pair.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'}]}
function token(patch:Record<string,unknown>={},key=pair.privateKey){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),p=Buffer.from(JSON.stringify({iss:AUTH_ISSUER,sub:'synthetic-user',aud:'oaiapp_synthetic',exp:Date.now()/1000+60,iat:Date.now()/1000,nonce:'synthetic-nonce',...patch})).toString('base64url');return h+'.'+p+'.'+crypto.sign('sha256',Buffer.from(h+'.'+p),key).toString('base64url')}
describe('official local ChatGPT OAuth contract',()=>{
 it('uses dynamic registration, exact callback, scopes and S256; never borrowed identity',()=>{
  const a=createAttempt(51001,'urn:uuid:synthetic'),url=new URL(authorizationUrl(a)),p=url.searchParams
  expect(url.origin+url.pathname).toBe('https://auth.openai.com/api/accounts/authorize');expect(p.get('client_id')).toBe('dynamic_agent_client');expect(p.get('agent_name_hint')).toBe('WhyWork');expect(p.get('ext_agent_host_id')).toBe(a.hostId);expect(p.get('redirect_uri')).toBe('http://127.0.0.1:51001/auth/callback');expect(p.get('resource')).toBe(RESOURCE);expect(p.get('scope')).toContain('chatgpt.tokens.use.direct');expect(p.get('nonce')).toBe(a.nonce);expect(p.get('code_challenge')).toBe(crypto.createHash('sha256').update(a.verifier).digest('base64url'));expect(p.has('code_verifier')).toBe(false)
  expect(createAttempt(51001,a.hostId).state).not.toBe(a.state)
 })
 it('reuses issued registration without name override and preserves exact form values',()=>{
  const a=createAttempt(51002,'urn:uuid:synthetic','oaiapp_synthetic','synthetic-user'),p=new URL(authorizationUrl(a)).searchParams
  expect(p.has('agent_name_hint')).toBe(false)
  const grant=callbackGrant(a,new URLSearchParams({code:'synthetic+code/=',state:a.state})),body=exchangeBody(a,grant)
  expect(body.get('client_id')).toBe('oaiapp_synthetic');expect(body.get('redirect_uri')).toBe(a.redirectUri);expect(new URLSearchParams(body.toString()).get('code')).toBe('synthetic+code/=');expect(body.get('code_verifier')).toBe(a.verifier)
 })
 it('requires state and issued client, and rejects consent errors, expiration and substitutions',()=>{
  const a=createAttempt(51003,'synthetic-host')
  for(const q of [{code:'x',state:'wrong',client_id:'oaiapp_x'},{code:'x',state:a.state},{code:'x',state:a.state,client_id:'dynamic_agent_client'},{state:a.state,error:'access_denied'}])expect(()=>callbackGrant(a,new URLSearchParams(q as Record<string,string>))).toThrow()
  expect(()=>callbackGrant({...a,expiresAt:0},new URLSearchParams({code:'x',state:a.state,client_id:'oaiapp_x'}))).toThrow()
  expect(()=>callbackGrant({...a,clientId:'oaiapp_existing'},new URLSearchParams({code:'x',state:a.state,client_id:'oaiapp_other'}))).toThrow()
  expect(()=>callbackGrant(a,new URLSearchParams(`state=${a.state}&state=${a.state}&code=x&client_id=oaiapp_x`))).toThrow()
 })
 it('accepts cryptographically signed synthetic identity with all expected bindings',()=>{
  expect(verifyIdentity(token(),jwks,'oaiapp_synthetic','synthetic-nonce','synthetic-user').sub).toBe('synthetic-user')
 })
 it.each([{iss:'https://example.invalid'},{aud:'oaiapp_other'},{exp:0},{iat:Date.now()/1000+1000},{nonce:'wrong'},{sub:'other'},{nbf:Date.now()/1000+1000},{aud:['oaiapp_synthetic','other']},{azp:'other'}])('rejects invalid signed identity claims %j',patch=>{
  expect(()=>verifyIdentity(token(patch),jwks,'oaiapp_synthetic','synthetic-nonce','synthetic-user')).toThrow('身份校验失败')
 })
 it('rejects forged signatures and algorithm confusion',()=>{
  expect(()=>verifyIdentity(token({},crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey),jwks,'oaiapp_synthetic','synthetic-nonce')).toThrow()
  expect(()=>verifyIdentity('eyJhbGciOiJub25lIn0.e30.',jwks,'oaiapp_synthetic')).toThrow()
 })
 it('does not treat identity alone as plan consent or expose raw server text',()=>{
  expect(planAllowed(['openid'])).toBe(false);expect(planAllowed(['resource.invoke','chatgpt.tokens.use.direct'])).toBe(true)
  expect(safeErrorCode({error:{code:'invalid_grant',message:'secret'}})).toBe('invalid_grant');expect(safeErrorCode({error:'https://example.invalid/?token=secret'})).toBe('unknown_error')
 })
})
