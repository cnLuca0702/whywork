import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { WhyWorkBridge, SysResult } from '../shared/types'

const bridge: WhyWorkBridge & { pathForFile: (file: File) => string } = {
  sys: (action, payload) =>
    ipcRenderer.invoke('sys:invoke', { action, payload, requestId: crypto.randomUUID() }) as Promise<SysResult>,
  onEvent: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev)
    ipcRenderer.on('sys:event', listener)
    return () => ipcRenderer.off('sys:event', listener)
  },
  abort: (chatId) => ipcRenderer.send('sys:stream', { op: 'abort', chatId }),
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('whywork', bridge)
