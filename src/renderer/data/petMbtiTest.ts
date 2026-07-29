import type { MbtiType } from './mbti'

export type TestDimension = 'EI' | 'SN' | 'TF' | 'JP'
export type TestAnswer = -2 | -1 | 0 | 1 | 2

export interface PetMbtiQuestion {
  id: number
  dimension: TestDimension
  pole: 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'
  text: string
  hint: string
}

export interface PetMbtiResult {
  type: MbtiType
  scores: Record<TestDimension, number>
  confidence: Record<TestDimension, number>
}

export const PET_MBTI_QUESTIONS: PetMbtiQuestion[] = [
  { id: 1, dimension: 'EI', pole: 'E', text: '看到熟悉的人或动物时，它通常会主动靠近。', hint: '回想开门、回家或遇见熟悉伙伴时的反应' },
  { id: 2, dimension: 'EI', pole: 'I', text: '进入陌生环境后，它会先躲在安全处观察很久。', hint: '例如搬家、去医院或第一次到新房间' },
  { id: 3, dimension: 'EI', pole: 'E', text: '独处一段时间后，它会主动来找人玩或寻求关注。', hint: '不是为了吃饭，而是单纯想互动' },
  { id: 4, dimension: 'SN', pole: 'S', text: '它对固定饭点、路线和熟悉物品非常敏感。', hint: '具体的小变化往往瞒不过它' },
  { id: 5, dimension: 'SN', pole: 'N', text: '比起熟悉的玩具，它更容易被新物件和未知角落吸引。', hint: '观察它面对纸箱、新玩具或新气味时的选择' },
  { id: 6, dimension: 'TF', pole: 'T', text: '想得到玩具或食物时，它会专注目标，不太受周围情绪影响。', hint: '即使你假装不高兴，它也可能继续想办法' },
  { id: 7, dimension: 'TF', pole: 'F', text: '家里有人低落或不舒服时，它会更安静地靠近陪伴。', hint: '关注它是否会感知语气、表情和气氛变化' },
  { id: 8, dimension: 'TF', pole: 'F', text: '被制止后，它会明显在意你的态度，并尝试重新亲近。', hint: '例如观察你的脸、蹭你或小心地试探' },
  { id: 9, dimension: 'JP', pole: 'J', text: '它喜欢固定作息，临时改变安排时容易不安或抗议。', hint: '饭点、睡觉位置和散步时间都算' },
  { id: 10, dimension: 'JP', pole: 'P', text: '玩耍时它常常临时换目标，兴致来了就探索别的东西。', hint: '行动随兴，计划赶不上它的注意力变化' }
]

const positivePoles: Record<TestDimension, string> = { EI: 'E', SN: 'S', TF: 'T', JP: 'J' }
const maximumScores: Record<TestDimension, number> = { EI: 6, SN: 4, TF: 6, JP: 4 }

export function calculatePetMbti(answers: Record<number, TestAnswer>): PetMbtiResult {
  const scores: Record<TestDimension, number> = { EI: 0, SN: 0, TF: 0, JP: 0 }
  PET_MBTI_QUESTIONS.forEach(question => {
    const answer = answers[question.id] ?? 0
    const direction = question.pole === positivePoles[question.dimension] ? 1 : -1
    scores[question.dimension] += answer * direction
  })

  const type = `${scores.EI >= 0 ? 'E' : 'I'}${scores.SN >= 0 ? 'S' : 'N'}${scores.TF >= 0 ? 'T' : 'F'}${scores.JP >= 0 ? 'J' : 'P'}` as MbtiType
  const confidence = Object.fromEntries(
    (Object.keys(scores) as TestDimension[]).map(dimension => [dimension, Math.round(Math.abs(scores[dimension]) / maximumScores[dimension] * 100)])
  ) as Record<TestDimension, number>
  return { type, scores, confidence }
}
