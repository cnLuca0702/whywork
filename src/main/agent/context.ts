import { AsyncLocalStorage } from 'node:async_hooks'
import type { SysContext } from '../syscalls/registry'
export const executionContext = new AsyncLocalStorage<SysContext>()
