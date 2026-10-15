import { safeStorage } from 'electron'
const PREFIX='enc:v1:'
export const SECRET_MASK='••••••••'
export function encryptSecret(value:string):string {
  if(!safeStorage.isEncryptionAvailable())throw new Error('系统密钥存储不可用，未保存凭据')
  return PREFIX+safeStorage.encryptString(value).toString('base64')
}
export function decryptSecret(value:string):string {
  if(!value.startsWith(PREFIX))throw new Error('凭据尚未加密，请重新保存')
  if(!safeStorage.isEncryptionAvailable())throw new Error('系统密钥存储不可用')
  return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length),'base64'))
}
export function isEncrypted(value:string):boolean{return value.startsWith(PREFIX)}
