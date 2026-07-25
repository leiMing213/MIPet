import type { Species } from '../../shared/types'

export const speciesMeta: Record<Species, { label: string; emoji: string; subtitle: string }> = {
  cat: { label: '猫咪', emoji: '🐈', subtitle: '安静、敏锐，也可能突然做出自己的决定' },
  dog: { label: '狗狗', emoji: '🐕', subtitle: '热情、可靠，随时准备加入你的生活' }
}
