import { pendingNoteSave } from './editor/save-queue'
import { useEffect,useRef } from 'react'
import type { SysResult } from '../../shared/types'

/** 渲染层统一 sys 封装：失败即抛错（组件层用 message 提示） */
export async function sys<T>(action: string, payload?: unknown): Promise<T> {
  if(action==='notes.get' && payload && typeof payload==='object' && 'noteId' in payload)await pendingNoteSave(String(payload.noteId))
  const res = (await window.whywork.sys(action, payload)) as SysResult<T>
  if (!res.ok) throw new Error(`[${res.error.code}] ${res.error.message}`)
  return res.data
}

/** 订阅 sys:event（组件卸载自动退订） */
export function useSysEvent(topic: string, cb: (payload: unknown) => void): void {
  const callback=useRef(cb)
  callback.current=cb
  useEffect(() => {
    return window.whywork.onEvent((e) => {
      if (e.topic === topic) callback.current(e.payload)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic])
}
