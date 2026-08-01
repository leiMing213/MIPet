import type { MbtiType } from './mbti'
import type { TestDimension, TestAnswer } from './petMbtiTest'

export interface UserPetQuestion {
  id: number
  dimension: TestDimension
  pole: 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'
  text: string
  hint: string
}

export const USER_PET_QUESTIONS: UserPetQuestion[] = [
  { id: 1, dimension: 'EI', pole: 'E', text: '你希望宠物会主动凑过来找你互动，而不是总自己待着。', hint: '想象回家时它是热情迎接还是自顾自趴着' },
  { id: 2, dimension: 'EI', pole: 'I', text: '你更喜欢安静独立的宠物，不需要它时刻围着你转。', hint: '它安安静静陪在旁边就够了，不用太黏人' },
  { id: 3, dimension: 'EI', pole: 'E', text: '你希望宠物在有客人来时表现得活泼大方、不怕生。', hint: '朋友到家里做客时你希望它怎么表现' },
  { id: 4, dimension: 'SN', pole: 'S', text: '你希望宠物作息规律，到点吃饭到点睡觉，省心好养。', hint: '比起探险型，你更想要一个生活规律的伙伴' },
  { id: 5, dimension: 'SN', pole: 'N', text: '你更想要一只好奇心旺盛的宠物，总能给你带来惊喜。', hint: '它会自己发明玩法、探索新角落、翻出新花样' },
  { id: 6, dimension: 'TF', pole: 'T', text: '你希望宠物聪明独立，能自己解决问题而不是依赖你。', hint: '比如自己找到藏起来的零食、学会开门' },
  { id: 7, dimension: 'TF', pole: 'F', text: '你希望宠物能感知你的情绪，在你低落时安静陪伴你。', hint: '你难过时它会蹭过来，而不是无动于衷' },
  { id: 8, dimension: 'TF', pole: 'F', text: '你更看重宠物和你之间的情感纽带，而不是它有多聪明。', hint: '有感情比会才艺更重要' },
  { id: 9, dimension: 'JP', pole: 'J', text: '你希望宠物行为可预测，不会突然搞破坏或乱跑。', hint: '让你安心的宠物应该是有规矩、可控的' },
  { id: 10, dimension: 'JP', pole: 'P', text: '你更喜欢随性自由的宠物，想玩就玩想睡就睡。', hint: '不需要太多训练，活出自己的节奏就好' }
]

const positivePoles: Record<TestDimension, string> = { EI: 'E', SN: 'S', TF: 'T', JP: 'J' }
const maximumScores: Record<TestDimension, number> = { EI: 6, SN: 4, TF: 6, JP: 4 }

export interface UserPetResult {
  type: MbtiType
  scores: Record<TestDimension, number>
  confidence: Record<TestDimension, number>
}

export function calculateUserPetMbti(answers: Record<number, TestAnswer>): UserPetResult {
  const scores: Record<TestDimension, number> = { EI: 0, SN: 0, TF: 0, JP: 0 }
  USER_PET_QUESTIONS.forEach(question => {
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
