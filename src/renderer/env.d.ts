import type { MipetBridge } from '../shared/types'

declare global {
  interface Window { mipet: MipetBridge }
}

export {}
