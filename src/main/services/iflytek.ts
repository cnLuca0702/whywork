import crypto from 'node:crypto'
import fs from 'node:fs'
import { safeStorage } from 'electron'
import { getDb } from '../db/client'

/** 科大讯飞智能办公本云端客户端（依据《科大讯飞智能办公本云端通信协议与API规范》）
 *  网关 https://api.iflyink.com/xbew-api；统一响应 {code:'000000',desc,data} */

const BASE_URL = 'https://api.iflyink.com/xbew-api'

interface ApiResp<T> {
  code: string | number
  desc?: string
  data?: T
}

export interface DeviceInfo {
  deviceId: string
  deviceName: string
  deviceModel?: string
  osVersion?: string
  lastLoginTime?: string
  loginStatus?: number
}

export interface CloudNote {
  noteId: string
  title: string
  createTime?: number
  updateTime?: number
  isEncrypt?: number
  hasAudio?: number
  attachmentCount?: number
}

// ---------- token 存取（safeStorage 加密，settings 表） ----------

function setSetting(key: string, value: string | null): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function saveToken(token: string): void {
  setSetting('iflytek.token_enc', safeStorage.encryptString(token).toString('base64'))
}

export function loadToken(): string | null {
  const enc = getSetting('iflytek.token_enc')
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function clearToken(): void {
  setSetting('iflytek.token_enc', null)
}

// ---------- HTTP ----------

async function post<T>(endpoint: string, payload: Record<string, unknown>, token: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...(token ? { token } : {}),
      platform: 'android',
      appVersion: '3.4.1',
      appVersionCode: '341',
      'User-Agent': 'Dart/3.4 (dart:io)'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`讯飞接口 HTTP ${res.status}`)
  const j = (await res.json()) as ApiResp<T>
  if (j.code !== '000000' && j.code !== 0 && j.code !== '0') {
    const err = new Error(`讯飞接口错误 [${String(j.code)}]: ${j.desc ?? ''}`) as Error & { apiCode?: string }
    err.apiCode = String(j.code)
    throw err
  }
  return (j.data ?? ({} as T)) as T
}

function requireToken(): string {
  const t = loadToken()
  if (!t) throw new Error('未登录讯飞账号，请到 设置 → 讯飞办公本 登录')
  return t
}

// ---------- 业务接口 ----------

export interface LoginResult {
  token: string
  userId: string
  userName?: string
  mobile?: string
  expireTime?: number
}

export async function loginByPassword(mobile: string, rawPassword: string): Promise<LoginResult> {
  const pwdMd5 = crypto.createHash('md5').update(rawPassword, 'utf-8').digest('hex')
  const data = await post<LoginResult>(
    '/user/dxkLogin',
    { mobile, password: pwdMd5, loginType: '1' },
    null
  )
  saveToken(data.token)
  setSetting('iflytek.mobile', mobile)
  return data
}

export async function refreshToken(): Promise<string> {
  const old = requireToken()
  const data = await post<{ token: string }>('/user/refreshToken', {}, old)
  saveToken(data.token)
  return data.token
}

export async function getBoundDevices(): Promise<DeviceInfo[]> {
  return post<DeviceInfo[]>('/common/deviceInfo/getLoginHistory', {}, requireToken())
}

export async function getNotes(dirId = '0', pageIndex = 1, pageSize = 20): Promise<{ list?: CloudNote[]; total?: number }> {
  return post<{ list?: CloudNote[]; total?: number }>(
    '/note/dxk/getNoteListContainEncrypt',
    { dirId, pageIndex, pageSize, sortType: 'updateTime' },
    requireToken()
  )
}

export async function getNoteDetail(noteId: string): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/note/dxk/getNoteDetail', { noteId }, requireToken())
}

export async function getDownloadUrl(fileUrl: string): Promise<string> {
  const data = await post<{ downloadUrl?: string; url?: string }>(
    '/common/common/getDownloadUrl',
    { fileUrl },
    requireToken()
  )
  return data.downloadUrl ?? data.url ?? ''
}

/** 把本地文件推送（读写驿站）到办公本：申请预签名 → OSS 直传 → 创建任务 */
export async function sendFileToDevice(absPath: string): Promise<Record<string, unknown>> {
  const token = requireToken()
  const name = absPath.split('/').pop() ?? 'file'
  const ext = name.includes('.') ? (name.split('.').pop() ?? 'bin').toLowerCase() : 'bin'
  const stat = fs.statSync(absPath)
  const auth = await post<{ uploadUrl: string; downloadUrl: string; fileKey?: string }>(
    '/common/common/getUploadUrl',
    { fileName: name, fileType: ext, businessType: 'file_station' },
    token
  )
  const buf = fs.readFileSync(absPath)
  const put = await fetch(auth.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(120_000)
  })
  if (!put.ok) throw new Error(`OSS 上传失败 HTTP ${put.status}`)
  return post<Record<string, unknown>>(
    '/common/iot/saveFilePort',
    { fileName: name, fileSize: stat.size, fileUrl: auth.downloadUrl, thumFilePath: '', fileType: ext },
    token
  )
}

export async function getFilePortList(pageIndex = 1, pageSize = 20): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/common/iot/getFilePortList', { pageIndex, pageSize }, requireToken())
}
