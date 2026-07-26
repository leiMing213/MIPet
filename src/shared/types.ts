export type Species = 'cat' | 'dog'
export type OwnerMbti = string | null
export type ActionId = 'idle' | 'walk' | 'eat' | 'pet'

export interface PetProfile {
  id: string
  name: string
  species: Species
  mbti: string
  ownerName: string
  ownerMbti: OwnerMbti
  appearanceMode: 'default' | 'custom'
  customImage?: string
  createdAt: string
}

export interface PetState {
  hunger: number
  cleanliness: number
  mood: number
  affection: number
  action: ActionId
  level: number
  xp: number
  evolutionStage: number
}

export interface PetSnapshot {
  profile: PetProfile
  state: PetState
}

export interface PetWalkOptions {
  direction: -1 | 1
  distance: number
  duration: number
}

export interface MipetBridge {
  openPet: (profile: PetProfile) => Promise<void>
  openPanel: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  setMousePassthrough: (passthrough: boolean) => void
  beginPetDrag: () => void
  endPetDrag: () => void
  walkPet: (options: PetWalkOptions) => void
  onWalkFinished: (callback: () => void) => () => void
  getCursorPosition: () => Promise<{ x: number; y: number }>
  getSystemIdleTime: () => Promise<number>
  quitApp: () => Promise<void>
}
