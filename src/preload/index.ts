import { contextBridge, ipcRenderer } from 'electron'
import type { MipetBridge, PetProfile, PetWalkOptions } from '../shared/types'

const bridge: MipetBridge = {
  openPet: (profile: PetProfile) => ipcRenderer.invoke('pet:open', profile),
  openPanel: () => ipcRenderer.invoke('panel:open'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  setMousePassthrough: (passthrough: boolean) => ipcRenderer.send('pet:mouse-passthrough', passthrough),
  beginPetDrag: () => ipcRenderer.send('pet:drag-start'),
  endPetDrag: () => ipcRenderer.send('pet:drag-end'),
  walkPet: (options: PetWalkOptions) => ipcRenderer.send('pet:walk', options),
  onWalkFinished: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('pet:walk-finished', listener)
    return () => ipcRenderer.removeListener('pet:walk-finished', listener)
  },
  quitApp: () => ipcRenderer.invoke('app:quit')
}

contextBridge.exposeInMainWorld('mipet', bridge)
