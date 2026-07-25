import { contextBridge, ipcRenderer } from 'electron'
import type { MipetBridge, PetProfile } from '../shared/types'

const bridge: MipetBridge = {
  openPet: (profile: PetProfile) => ipcRenderer.invoke('pet:open', profile),
  openPanel: () => ipcRenderer.invoke('panel:open'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url)
}

contextBridge.exposeInMainWorld('mipet', bridge)
