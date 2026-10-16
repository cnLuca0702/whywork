import fs from 'node:fs'
import path from 'node:path'
export function watchConflict(input:string,workspace:string,home:string,existing:{id:string;dir:string}[]){
 const dir=fs.realpathSync(input),ws=fs.realpathSync(workspace),user=fs.realpathSync(home)
 if(!fs.statSync(dir).isDirectory())throw new Error('目录不存在')
 const under=(child:string,parent:string)=>child===parent||child.startsWith(parent===path.parse(parent).root?parent:parent+path.sep)
 if(under(dir,ws)||under(ws,dir))throw new Error('不能监控包含工作区的目录或工作区内部目录')
 if(dir===user||['/System','/Library','/Applications','/bin','/sbin','/usr','/etc','/private/etc','/proc','/sys','/dev','/var/lib'].some(system=>under(dir,system)))throw new Error('不允许同步主目录根或系统目录')
 const normalized=existing.map(row=>({...row,dir:fs.existsSync(row.dir)?fs.realpathSync(row.dir):path.resolve(row.dir)}))
 const same=normalized.find(r=>r.dir===dir)
 if(same)throw Object.assign(new Error('已在同步'),{code:'WATCH_DUPLICATE'})
 const parent=normalized.find(r=>under(dir,r.dir))
 if(parent)throw Object.assign(new Error(`已被上级目录 ${parent.dir} 覆盖`),{code:'WATCH_COVERED'})
 return {dir,children:normalized.filter(r=>under(r.dir,dir))}
}
export function watchError(error:unknown){return ['EACCES','EPERM'].includes((error as NodeJS.ErrnoException)?.code??'')?'请在系统设置 → 隐私与安全性中授予 WhyWork 访问该目录的权限，然后重新扫描':error instanceof Error?error.message:String(error)}
