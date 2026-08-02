import type { ActionId, PetAnimationPack, Species } from '../shared/types'
import { Pet3D } from './Pet3D'
import { PetSpriteSheetStill, PetSpriteSimple } from './PetSprite'

interface PetDisplayProps {
  species: Species
  mbti: string
  accent: string
  action: ActionId
  customImage?: string
  customAnimation?: PetAnimationPack
}

function getPosterClip(pack: PetAnimationPack | undefined) {
  if (!pack) return undefined
  return pack.idle ?? pack.yawn ?? pack.pet ?? pack.eat ?? pack.walk
}

export function PetDisplay({ species, mbti, accent, action, customImage, customAnimation }: PetDisplayProps) {
  const posterClip = getPosterClip(customAnimation)
  if (customImage) {
    return <PetSpriteSimple imageUrl={customImage} action={action} />
  }
  if (posterClip) {
    return <PetSpriteSheetStill clip={posterClip} frameIndex={0} />
  }
  return <Pet3D species={species} mbti={mbti} accent={accent} action={action} />
}
