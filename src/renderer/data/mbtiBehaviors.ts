export interface MbtiBehavior {
  type: string
  energy: number
  curiosity: number
  affection: number
  spontaneity: number
  animationSpeed: number
  gestureScale: number
  walkDistance: [number, number]
  walkDuration: [number, number]
  autonomousDelay: [number, number]
  walkChance: number
  attentionChance: number
}

const types = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP'
] as const

function createBehavior(type: string): MbtiBehavior {
  const extrovert = type[0] === 'E'
  const intuitive = type[1] === 'N'
  const feeling = type[2] === 'F'
  const perceiving = type[3] === 'P'

  const energy = extrovert ? 0.82 : 0.43
  const curiosity = intuitive ? 0.82 : 0.48
  const affection = feeling ? 0.84 : 0.48
  const spontaneity = perceiving ? 0.86 : 0.42

  return {
    type,
    energy,
    curiosity,
    affection,
    spontaneity,
    animationSpeed: 0.72 + energy * 0.58 + spontaneity * 0.12,
    gestureScale: 0.66 + energy * 0.36 + affection * 0.18,
    walkDistance: extrovert ? [145, 235] : [80, 155],
    walkDuration: extrovert ? [720, 1100] : [1050, 1650],
    autonomousDelay: extrovert ? [6500, 12500] : [10500, 22000],
    walkChance: Math.min(0.78, 0.2 + energy * 0.42 + curiosity * 0.16),
    attentionChance: Math.min(0.72, 0.12 + affection * 0.44 + spontaneity * 0.12)
  }
}

export const mbtiBehaviors: Record<string, MbtiBehavior> = Object.fromEntries(
  types.map(type => [type, createBehavior(type)])
)

export function getMbtiBehavior(type?: string): MbtiBehavior {
  return mbtiBehaviors[type ?? 'INFP'] ?? mbtiBehaviors.INFP
}
