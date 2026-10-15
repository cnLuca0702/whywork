/// <reference types="vite/client" />
import type { WhyWorkBridge } from '../../shared/types'

declare global {
  interface Window {
    whywork: WhyWorkBridge
  }
}

export {}
