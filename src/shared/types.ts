/** 全项目共享类型（main/preload/renderer 三端引用，见 docs/DEVELOPMENT.md §2.1） */

export interface SysError {
  code:
    | 'UNKNOWN_ACTION'
    | 'BAD_PAYLOAD'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'IO_ERROR'
    | 'PROVIDER_ERROR'
    | 'NETWORK_ERROR'
    | 'NO_PROVIDER'
    | 'ABORTED'
    | 'WATCH_DUPLICATE'
    | 'WATCH_COVERED'
    | 'INTERNAL'
  message: string
}

export type SysResult<T = unknown> = { ok: true; data: T } | { ok: false; error: SysError }

export interface SysRequest {
  action: string
  payload?: unknown
  requestId: string
}

export interface SysEvent {
  topic: string
  payload: unknown
}

/** 渲染层可用的桥 API（preload 暴露） */
export interface WhyWorkBridge {
  sys: (action: string, payload?: unknown) => Promise<SysResult>
  onEvent: (cb: (e: SysEvent) => void) => () => void
  abort: (chatId: string) => void
  /** 拖拽事件中的 File → 绝对路径（sandbox 渲染层用 webUtils） */
  pathForFile: (file: File) => string
}
