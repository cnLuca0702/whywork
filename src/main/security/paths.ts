import fs from 'node:fs'
import path from 'node:path'
import { getWorkspacePath } from '../syscalls/app'

/** Resolve existing parents too: lexical checks alone do not contain symlinks. */
export function resolveWorkspacePath(rel: string, allowMetadata = false): string {
  const ws = fs.realpathSync(getWorkspacePath())
  const abs = path.resolve(ws, rel)
  if (abs !== ws && !abs.startsWith(ws + path.sep)) throw new Error('路径超出工作区')
  const relative = path.relative(ws, abs)
  if (!allowMetadata && ['.whywork','.myremio'].includes(relative.split(path.sep)[0] ?? '')) throw new Error('禁止访问应用元数据')
  let parent = abs
  while (!fs.existsSync(parent)) {
    try {if(fs.lstatSync(parent).isSymbolicLink())throw new Error('无法验证符号链接目标')}
    catch(e){if((e as NodeJS.ErrnoException).code !== 'ENOENT')throw e}
    parent = path.dirname(parent)
  }
  const real = fs.realpathSync(parent)
  if (real !== ws && !real.startsWith(ws + path.sep)) throw new Error('符号链接指向工作区外')
  const finalPath=path.join(real,path.relative(parent,abs))
  const realRelative=path.relative(ws,finalPath)
  if(!allowMetadata && ['.whywork','.myremio'].includes(realRelative.split(path.sep)[0]??''))throw new Error('禁止访问应用元数据')
  return finalPath
}

export function resourcePath(url: string): string {
  const u = new URL(url)
  if (!['whywork-res:', 'myremio-res:'].includes(u.protocol)) throw new Error('非法资源协议')
  const rel = decodeURIComponent((u.hostname === 'workspace' ? '' : u.hostname) + u.pathname).replace(/^\/+/, '')
  if (!(rel.startsWith('resources/') || rel.startsWith('.whywork/tmp/'))) throw new Error('非法资源目录')
  const result=resolveWorkspacePath(rel,true)
  const realRelative=path.relative(fs.realpathSync(getWorkspacePath()),result)
  if(!(realRelative.startsWith('resources'+path.sep)||realRelative.startsWith(path.join('.whywork','tmp')+path.sep)))throw new Error('资源符号链接指向非资源目录')
  return result
}
