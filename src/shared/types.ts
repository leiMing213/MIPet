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
}

export interface MipetBridge {
  openPet: (profile: PetProfile) => Promise<void>
  openPanel: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  setMousePassthrough: (passthrough: boolean) => void
  beginPetDrag: () => void
  endPetDrag: () => void
  walkPet: (direction: -1 | 1) => void
  onWalkFinished: (callback: () => void) => () => void
  quitApp: () => Promise<void>
}
