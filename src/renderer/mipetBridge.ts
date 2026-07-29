import type { MipetBridge } from '../shared/types'

const fallbackBridge: MipetBridge = {
  openPet: async () => undefined,
  openPanel: async () => undefined,
  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  setMousePassthrough: () => undefined,
  beginPetDrag: () => undefined,
  endPetDrag: () => undefined,
  walkPet: () => undefined,
  onWalkFinished: () => () => undefined,
  getCursorPosition: async () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
  getSystemIdleTime: async () => 0,
  quitApp: async () => undefined
}

export function getMipetBridge() {
  return window.mipet ?? fallbackBridge
}
