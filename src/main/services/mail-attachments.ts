import fs from 'node:fs'
import path from 'node:path'
import {resolveWorkspacePath} from '../security/paths'
export function mailAttachments(items:{path:string}[]=[]){let total=0;return items.map(item=>{const abs=resolveWorkspacePath(item.path),stat=fs.statSync(abs);if(!stat.isFile())throw new Error('邮件附件必须为文件');if(stat.size>20*1024*1024)throw new Error('单个附件超过20MB');total+=stat.size;if(total>25*1024*1024)throw new Error('附件合计超过25MB');return {filename:path.basename(abs),path:abs}})}
export function mailError(error:unknown){const msg=error instanceof Error?error.message:String(error),code=(error as {code?:string})?.code??'';if(/AUTH|535|534|invalid credentials|authentication/i.test(code+' '+msg))return '邮件认证失败，请更新应用专用密码';if(/TLS|CERT|SSL/i.test(code+' '+msg))return '邮件TLS连接失败，请检查证书与端口';if(/ECONN|ENOTFOUND|ETIMEDOUT|connection|timeout/i.test(code+' '+msg))return '无法连接邮件服务器，请检查地址与网络';return '发件被拒，请检查收件人、附件与服务器设置'}
