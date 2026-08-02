export type Species = 'cat' | 'dog'
export type OwnerMbti = string | null
export type ActionId = 'idle' | 'walk' | 'eat' | 'pet' | 'yawn'

export interface PetAnimationClip {
  src: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  fps: number
  columns?: number
  rows?: number
  loop?: boolean
  mode?: 'sheet' | 'overlay'
  baseSrc?: string
  overlaySrc?: string
  overlayFrameWidth?: number
  overlayFrameHeight?: number
  overlayOffsetX?: number
  overlayOffsetY?: number
}

export interface PetAnimationPack {
  version: 'v1'
  idle?: PetAnimationClip
  walk?: PetAnimationClip
  eat?: PetAnimationClip
  pet?: PetAnimationClip
  yawn?: PetAnimationClip
}

export interface PetProfile {
  id: string
  name: string
  species: Species
  mbti: string
  ownerName: string
  ownerMbti: OwnerMbti
  appearanceMode: 'default' | 'custom'
  customImage?: string
  customAnimation?: PetAnimationPack
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
  angle: number
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
