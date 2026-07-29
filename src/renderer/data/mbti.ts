export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP'
] as const

export type MbtiType = typeof MBTI_TYPES[number]
export type MbtiGroupId = 'analyst' | 'diplomat' | 'sentinel' | 'explorer'

export interface MbtiGroup {
  id: MbtiGroupId
  name: string
  color: string
  softColor: string
}

export interface MbtiRecommendation {
  type: MbtiType
  reason: string
}

export const MBTI_GROUPS: Record<MbtiGroupId, MbtiGroup> = {
  analyst: { id: 'analyst', name: '分析家', color: '#88619a', softColor: '#eee5f1' },
  diplomat: { id: 'diplomat', name: '外交家', color: '#33a474', softColor: '#e0f1e9' },
  sentinel: { id: 'sentinel', name: '守护者', color: '#4298b4', softColor: '#e1f0f4' },
  explorer: { id: 'explorer', name: '探险家', color: '#d9a128', softColor: '#f7edcf' }
}

const recommendationTypes: Record<MbtiType, MbtiType[]> = {
  INTJ: ['ENFP', 'ENTP', 'INFP'],
  INTP: ['ENTJ', 'ENFJ', 'ENTP', 'INFP'],
  ENTJ: ['INTP', 'INFP'],
  ENTP: ['INFJ', 'INTJ', 'ENFP'],
  INFJ: ['ENFP', 'ENTP', 'INFP', 'ISFJ'],
  INFP: ['ENFJ', 'ENTJ', 'INFJ'],
  ENFJ: ['INFP', 'ISFP'],
  ENFP: ['INFJ', 'INTJ', 'INFP'],
  ISTJ: ['ESFP', 'ESTP', 'ISFJ'],
  ISFJ: ['ESFP', 'ESTP', 'ISTJ', 'INFJ'],
  ESTJ: ['ISFP', 'ISTP'],
  ESFJ: ['ISFP', 'ISTP', 'ISFJ'],
  ISTP: ['ESFJ', 'ESTJ', 'ISFP'],
  ISFP: ['ENFJ', 'ESFJ'],
  ESTP: ['ISFJ', 'ISTJ', 'ESFP', 'ISTP'],
  ESFP: ['ISFJ', 'ISTJ', 'ESTP']
}

export function isMbtiType(value: string | null | undefined): value is MbtiType {
  return Boolean(value && MBTI_TYPES.includes(value.toUpperCase() as MbtiType))
}

export function getMbtiGroup(type: string): MbtiGroup {
  const normalized = type.toUpperCase()
  if (normalized[1] === 'N' && normalized[2] === 'T') return MBTI_GROUPS.analyst
  if (normalized[1] === 'N' && normalized[2] === 'F') return MBTI_GROUPS.diplomat
  if (normalized[1] === 'S' && normalized[3] === 'J') return MBTI_GROUPS.sentinel
  return MBTI_GROUPS.explorer
}

function buildReason(owner: MbtiType, pet: MbtiType): string {
  const reasons: string[] = []
  if (owner[0] !== pet[0]) {
    reasons.push(pet[0] === 'E'
      ? '它更愿意主动发起互动，能轻轻带动你的生活节奏'
      : '它懂得安静陪伴，也会给你留出舒服的独处空间')
  } else {
    reasons.push(owner[0] === 'E'
      ? '你们都从互动中获得能量，相处会很有回应感'
      : '你们都偏爱低打扰的陪伴，不需要时刻热闹')
  }

  if (owner[2] !== pet[2]) {
    reasons.push(pet[2] === 'F'
      ? '它能用敏锐的情绪回应柔化你理性的一面'
      : '它冷静直接的反馈能在你犹豫时提供稳定感')
  } else if (owner[1] === pet[1]) {
    reasons.push(owner[1] === 'N'
      ? '相近的好奇心让日常互动更容易产生新鲜感'
      : '相近的务实节奏让喂养和陪伴更稳定省心')
  } else {
    reasons.push(pet[1] === 'N'
      ? '它会给熟悉的日常带来一点想象力和意外惊喜'
      : '它重视当下和规律，能让生活更踏实可预期')
  }
  return `${reasons[0]}；${reasons[1]}。`
}

export function getPetRecommendations(ownerMbti: string | null | undefined): MbtiRecommendation[] {
  if (!isMbtiType(ownerMbti)) return []
  const owner = ownerMbti.toUpperCase() as MbtiType
  return recommendationTypes[owner].map(type => ({ type, reason: buildReason(owner, type) }))
}

export interface MbtiDecoration {
  label: string
  accessory: 'crown' | 'glasses' | 'cape' | 'antenna' | 'crystal' | 'flower' | 'medal' | 'star' | 'tie' | 'kerchief' | 'cap' | 'bow' | 'goggles' | 'beret' | 'bandana' | 'sparkles'
}

export const MBTI_DECORATIONS: Record<MbtiType, MbtiDecoration> = {
  INTJ: { label: '战略王冠', accessory: 'crown' },
  INTP: { label: '思考眼镜', accessory: 'glasses' },
  ENTJ: { label: '指挥披风', accessory: 'cape' },
  ENTP: { label: '灵感天线', accessory: 'antenna' },
  INFJ: { label: '洞察水晶', accessory: 'crystal' },
  INFP: { label: '治愈小花', accessory: 'flower' },
  ENFJ: { label: '陪伴勋章', accessory: 'medal' },
  ENFP: { label: '活力星星', accessory: 'star' },
  ISTJ: { label: '秩序领带', accessory: 'tie' },
  ISFJ: { label: '守护方巾', accessory: 'kerchief' },
  ESTJ: { label: '行动帽', accessory: 'cap' },
  ESFJ: { label: '友谊蝴蝶结', accessory: 'bow' },
  ISTP: { label: '机械护目镜', accessory: 'goggles' },
  ISFP: { label: '艺术贝雷帽', accessory: 'beret' },
  ESTP: { label: '冒险头巾', accessory: 'bandana' },
  ESFP: { label: '舞台闪光', accessory: 'sparkles' }
}
