import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Brain,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Footprints,
  Heart,
  Home,
  ImagePlus,
  MessageCircle,
  MonitorUp,
  PawPrint,
  Pencil,
  Send,
  Smile,
  Sparkles,
  Utensils,
  UserRound
} from 'lucide-react'
import type { PetAnimationPack, PetProfile, PetSnapshot, PetState, Species } from '../shared/types'
import { personalities, type Personality } from './data/personalities'
import { speciesMeta } from './data/pets'
import { getMbtiBehavior } from './data/mbtiBehaviors'
import { getMbtiGroup, getPetRecommendations, MBTI_GROUPS, MBTI_TYPES, type MbtiGroupId, type MbtiType } from './data/mbti'
import { calculatePetMbti, PET_MBTI_QUESTIONS, type PetMbtiResult, type TestAnswer } from './data/petMbtiTest'
import { calculateUserPetMbti, USER_PET_QUESTIONS, type UserPetResult } from './data/userPetTest'
import { getMipetBridge } from './mipetBridge'
import { PetDisplay } from './PetDisplay'

const OWNER_MBTI_LINK = 'https://www.16personalities.com/ch'
const API_BASE = 'http://127.0.0.1:8787'
const MAX_STORED_CUSTOM_IMAGE_LENGTH = 120_000
const MAX_APPEARANCE_RETRIES = 2
const MAX_APPEARANCE_POLL_ERRORS = 3

type DashboardView = 'home' | 'chat' | 'profile'
type CareAction = 'pet' | 'feed' | 'walk'

interface ChatRecord {
  id: number | string
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

interface GrowthRecord {
  id: number
  eventType: string
  xpDelta: number
  level: number
  createdAt: string
}

const DEFAULT_PET_STATE: PetState = {
  hunger: 68,
  cleanliness: 86,
  mood: 78,
  affection: 12,
  action: 'idle',
  level: 1,
  xp: 0,
  evolutionStage: 1
}

function normalizePetState(state?: Partial<PetState> | null): PetState {
  return { ...DEFAULT_PET_STATE, ...state }
}

function compactAnimationPackForStorage(pack?: PetAnimationPack): PetAnimationPack | undefined {
  return pack
}

function compactProfileForStorage(profile: PetProfile): PetProfile {
  return profile
}

function saveProfile(profile: PetProfile) {
  try {
    localStorage.setItem('mipet:profile', JSON.stringify(compactProfileForStorage(profile)))
  } catch (error) {
    console.warn('[MiPet] Failed to cache pet profile locally:', error)
  }
}

function getProfile(): PetProfile | null {
  try {
    const raw = localStorage.getItem('mipet:profile')
    return raw ? compactProfileForStorage(JSON.parse(raw) as PetProfile) : null
  } catch {
    return null
  }
}

function saveState(state: PetState) {
  localStorage.setItem('mipet:state', JSON.stringify(state))
}

function getState(): PetState {
  try {
    return normalizePetState(JSON.parse(localStorage.getItem('mipet:state') ?? ''))
  } catch {
    return { ...DEFAULT_PET_STATE }
  }
}

async function saveSnapshot(snapshot: PetSnapshot) {
  const response = await fetch(`${API_BASE}/v1/pets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot)
  })
  if (!response.ok) throw new Error(`save pet failed: ${response.status}`)
}

async function persistPetState(petId: string, state: PetState, eventType?: 'pet' | 'feed' | 'walk'): Promise<PetState | null> {
  const response = await fetch(`${API_BASE}/v1/pets/${encodeURIComponent(petId)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  })
  if (!response.ok) throw new Error(`save state failed: ${response.status}`)
  if (eventType) {
    const eventResponse = await fetch(`${API_BASE}/v1/pets/${encodeURIComponent(petId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: eventType, metadata: {} })
    })
    if (eventResponse.ok) {
      const result = await eventResponse.json() as { state?: PetState }
      return result.state ? normalizePetState(result.state) : null
    }
  }
  return null
}

async function loadLatestSnapshot(): Promise<PetSnapshot | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/v1/pets/latest`)
      if (response.ok) return await response.json() as PetSnapshot | null
    } catch {
      // The bundled backend may still be starting; retry briefly before using the local cache.
    }
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  return null
}

function App() {
  const mode = new URLSearchParams(window.location.search).get('mode')

  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [])

  return mode === 'pet' ? <PetWindow /> : <MainWindow />
}

function MainWindow() {
  const mipet = getMipetBridge()
  const cachedProfile = getProfile()
  const [profile, setProfile] = useState<PetProfile | null>(cachedProfile)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await loadLatestSnapshot()
        if (cancelled) return
        if (snapshot) {
          saveProfile(snapshot.profile)
          saveState(normalizePetState(snapshot.state))
          setProfile(snapshot.profile)
          void mipet.openPet(snapshot.profile)
        } else if (cachedProfile) {
          void saveSnapshot({ profile: cachedProfile, state: getState() }).catch(() => undefined)
          void mipet.openPet(cachedProfile)
        }
      } catch (error) {
        console.error('[MiPet] Failed to initialize main window:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <main className="panel-loading"><div className="loading-paw"><PawPrint size={24} /></div><span>正在打开 MiPet…</span></main>
  }

  if (!profile || editing) {
    return (
      <Onboarding
        existing={editing ? profile : null}
        onCancel={profile ? () => setEditing(false) : undefined}
        onComplete={nextProfile => {
          setProfile(nextProfile)
          setEditing(false)
        }}
      />
    )
  }

  return <Dashboard profile={profile} onEdit={() => setEditing(true)} onProfileUpdate={setProfile} />
}

function Dashboard({ profile, onEdit, onProfileUpdate }: {
  profile: PetProfile
  onEdit: () => void
  onProfileUpdate: (profile: PetProfile) => void
}) {
  const mipet = getMipetBridge()
  const [view, setView] = useState<DashboardView>('home')
  const [state, setState] = useState<PetState>(getState)
  const [messages, setMessages] = useState<ChatRecord[]>([])
  const [growth, setGrowth] = useState<GrowthRecord[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [draftName, setDraftName] = useState(profile.name)
  const [draftOwnerName, setDraftOwnerName] = useState(profile.ownerName)
  const mbti = personalities.find(personality => personality.type === profile.mbti) ?? personalities[0]
  const mbtiGroup = getMbtiGroup(profile.mbti)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [snapshotResult, messagesResult, growthResult] = await Promise.allSettled([
        fetch(`${API_BASE}/v1/pets/${encodeURIComponent(profile.id)}`).then(response => response.ok ? response.json() as Promise<PetSnapshot | null> : null),
        fetch(`${API_BASE}/v1/pets/${encodeURIComponent(profile.id)}/messages`).then(response => response.ok ? response.json() as Promise<ChatRecord[]> : []),
        fetch(`${API_BASE}/v1/pets/${encodeURIComponent(profile.id)}/growth`).then(response => response.ok ? response.json() as Promise<GrowthRecord[]> : [])
      ])
      if (cancelled) return
      if (snapshotResult.status === 'fulfilled' && snapshotResult.value) {
        const nextState = normalizePetState(snapshotResult.value.state)
        saveState(nextState)
        setState(nextState)
      }
      if (messagesResult.status === 'fulfilled') setMessages(messagesResult.value)
      if (growthResult.status === 'fulfilled') setGrowth(growthResult.value)
    })()
    return () => { cancelled = true }
  }, [profile.id])

  useEffect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key === 'mipet:state' && event.newValue) {
        try { setState(normalizePetState(JSON.parse(event.newValue) as PetState)) } catch { /* keep the current state */ }
      }
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, [])

  function flash(text: string) {
    setFeedback(text)
    window.setTimeout(() => setFeedback(''), 2200)
  }

  function care(action: CareAction) {
    const labels: Record<CareAction, string> = {
      pet: `${profile.name}舒服地眯起了眼睛`,
      feed: `${profile.name}吃饱了，心情不错`,
      walk: `${profile.name}准备去桌面散散步`
    }
    const current = getState()
    const next: PetState = action === 'feed'
      ? { ...current, hunger: Math.max(0, current.hunger - 18), mood: Math.min(100, current.mood + 4), affection: Math.min(100, current.affection + 2), action: 'eat' }
      : action === 'walk'
        ? { ...current, mood: Math.min(100, current.mood + 2), action: 'walk' }
        : { ...current, mood: Math.min(100, current.mood + 3), affection: Math.min(100, current.affection + 3), action: 'pet' }

    saveState(next)
    setState(next)
    flash(labels[action])
    if (action === 'walk') {
      const behavior = getMbtiBehavior(profile.mbti)
      const [minDistance, maxDistance] = behavior.walkDistance
      const [minDuration, maxDuration] = behavior.walkDuration
      mipet.walkPet({
        angle: Math.random() * Math.PI * 2,
        distance: minDistance + Math.random() * (maxDistance - minDistance),
        duration: minDuration + Math.random() * (maxDuration - minDuration)
      })
    }
    void persistPetState(profile.id, next, action).then(persisted => {
      if (!persisted) return
      const merged = { ...next, level: persisted.level, xp: persisted.xp, evolutionStage: persisted.evolutionStage }
      saveState(merged)
      setState(merged)
      void fetch(`${API_BASE}/v1/pets/${encodeURIComponent(profile.id)}/growth`)
        .then(response => response.ok ? response.json() as Promise<GrowthRecord[]> : [])
        .then(setGrowth)
        .catch(() => undefined)
    }).catch(() => flash('操作已经记录在本地，稍后会自动同步'))

    window.setTimeout(() => {
      const latest = getState()
      if (latest.action !== next.action) return
      const idle = { ...latest, action: 'idle' as const }
      saveState(idle)
      setState(idle)
      void persistPetState(profile.id, idle).catch(() => undefined)
    }, action === 'feed' ? 3400 : 2300)
  }

  async function sendDashboardChat(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || isSending) return
    const userMessage: ChatRecord = { id: `user-${Date.now()}`, role: 'user', content }
    const assistantId = `assistant-${Date.now()}`
    const recentMessages = messages.slice(-8).map(message => `${message.role}: ${message.content}`)
    setInput('')
    setMessages(current => [...current, userMessage])
    setIsSending(true)

    try {
      const response = await fetch(`${API_BASE}/v1/pets/${encodeURIComponent(profile.id)}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            pet_id: profile.id,
            pet_name: profile.name,
            species: profile.species,
            mbti: profile.mbti,
            state,
            recent_messages: recentMessages
          },
          event: { type: 'chat', content, metadata: {} }
        })
      })
      if (!response.ok || !response.body) throw new Error('chat failed')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const chunks = buffer.split('\n')
        buffer = chunks.pop() ?? ''
        for (const line of chunks) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { token?: string }
            if (!data.token) continue
            reply += data.token
            setMessages(current => [
              ...current.filter(message => message.id !== assistantId),
              { id: assistantId, role: 'assistant', content: reply }
            ])
          } catch { /* ignore incomplete server events */ }
        }
        if (done) break
      }
      if (!reply) throw new Error('empty response')
    } catch {
      setMessages(current => [
        ...current.filter(message => message.id !== assistantId),
        { id: assistantId, role: 'assistant', content: '我听见啦。现在网络有点忙，等一下再陪你慢慢聊。' }
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function saveProfileDetails() {
    const nextProfile = {
      ...profile,
      name: draftName.trim() || profile.name,
      ownerName: draftOwnerName.trim() || profile.ownerName
    }
    saveProfile(nextProfile)
    onProfileUpdate(nextProfile)
    try {
      await saveSnapshot({ profile: nextProfile, state })
      flash('档案已保存')
    } catch {
      flash('已保存在本机，服务恢复后会继续同步')
    }
  }

  const pageTitle = view === 'home' ? '今天也一起待着吧' : view === 'chat' ? `和${profile.name}聊聊` : '宠物档案'
  const growthLabels: Record<string, string> = { chat: '聊了一会儿', pet: '摸了摸它', feed: '喂了一顿', walk: '一起散步' }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand"><span><PawPrint size={19} /></span><strong>MiPet</strong></div>
        <nav className="dashboard-nav" aria-label="管理页导航">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Home size={18} />总览</button>
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}><MessageCircle size={18} />聊天</button>
          <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><UserRound size={18} />宠物档案</button>
        </nav>
        <div className="sidebar-pet">
          <span className="sidebar-avatar"><PetDisplay species={profile.species} mbti={profile.mbti} accent={mbtiGroup.color} action="idle" customImage={profile.customImage} customAnimation={profile.customAnimation} /></span>
          <div><strong>{profile.name}</strong><small><i />正在桌面陪你</small></div>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div><p>{profile.ownerName ? `${profile.ownerName}，` : ''}{pageTitle}</p><span>{view === 'home' ? '这里是你们共同生活的管理台。' : view === 'chat' ? '不用想好话题，随便说点什么就行。' : '名字和外形随时都可以调整。'}</span></div>
          <button className="desktop-return-button" onClick={() => mipet.openPet(profile)}><MonitorUp size={17} />回到桌面</button>
        </header>

        {view === 'home' && (
          <div className="dashboard-content home-dashboard">
            <section className="pet-summary-card">
              <div className="summary-copy"><span className="status-kicker">今日状态</span><h1>{state.mood >= 75 ? '心情很好，' : '安安静静，'}<br />正在等你。</h1><p>{feedback || `${profile.name}今天已经在桌面陪着你了。想起它的时候，过来摸摸就好。`}</p><button onClick={() => setView('chat')}>去说句话 <ChevronRight size={16} /></button></div>
              <div className="summary-pet" style={{ '--pet-accent': mbtiGroup.color } as React.CSSProperties}>
                <div className="summary-pet-floor" />
                <PetDisplay species={profile.species} mbti={profile.mbti} accent={mbtiGroup.color} action={state.action} customImage={profile.customImage} customAnimation={profile.customAnimation} />
                <small>Lv.{state.level} · {mbti.name}</small>
              </div>
            </section>

            <section className="state-card">
              <div className="card-heading"><div><span>生活状态</span><small>照顾得很不错</small></div><Heart size={19} /></div>
              <StatusRow label="饱腹" value={100 - state.hunger} tone="orange" />
              <StatusRow label="心情" value={state.mood} tone="green" />
              <StatusRow label="亲密" value={state.affection} tone="pink" />
            </section>

            <section className="care-card">
              <div className="card-heading"><div><span>现在做点什么</span><small>操作会同步到桌面宠物</small></div></div>
              <div className="care-actions">
                <button data-testid="care-feed" onClick={() => care('feed')}><span className="care-icon food"><Utensils size={20} /></span><strong>喂食</strong><small>饥饿 -18</small></button>
                <button data-testid="care-pet" onClick={() => care('pet')}><span className="care-icon pet"><Smile size={20} /></span><strong>摸摸</strong><small>亲密 +3</small></button>
                <button data-testid="care-walk" onClick={() => care('walk')}><span className="care-icon walk"><Footprints size={20} /></span><strong>散步</strong><small>心情 +2</small></button>
              </div>
            </section>

            <section className="growth-card">
              <div className="card-heading"><div><span>最近的陪伴</span><small>每次互动都会留下痕迹</small></div><span className="level-chip">Lv.{state.level}</span></div>
              <div className="growth-progress"><span style={{ width: `${Math.min(100, state.xp % 100)}%` }} /></div>
              <div className="growth-list">
                {growth.length > 0 ? growth.slice(0, 4).map(item => <div key={item.id}><i /><span>{growthLabels[item.eventType] ?? '陪伴了一会儿'}</span><small>+{item.xpDelta} XP</small></div>) : <p>从一次摸摸开始，留下你们的第一条记录。</p>}
              </div>
            </section>
          </div>
        )}

        {view === 'chat' && (
          <div className="dashboard-content chat-dashboard">
            <section className="conversation-card">
              <div className="conversation-person"><span className="conversation-pet-avatar"><PetDisplay species={profile.species} mbti={profile.mbti} accent={mbtiGroup.color} action="idle" customImage={profile.customImage} customAnimation={profile.customAnimation} /></span><div><strong>{profile.name}</strong><small>{profile.mbti} · {mbti.name}</small></div></div>
              <div className="message-list">
                {messages.length === 0 && <div className="empty-conversation"><MessageCircle size={27} /><strong>从一句简单的话开始</strong><span>它会记住你们慢慢聊过的事情。</span><div><button onClick={() => setInput('今天过得怎么样？')}>今天过得怎么样？</button><button onClick={() => setInput('陪我待一会儿')}>陪我待一会儿</button></div></div>}
                {messages.map(message => <div key={message.id} className={`message-row ${message.role}`}><span>{message.content}</span></div>)}
                {isSending && !messages.some(message => String(message.id).startsWith('assistant-')) && <div className="message-row assistant"><span className="typing-dots">•••</span></div>}
              </div>
              <form className="dashboard-chat-form" onSubmit={sendDashboardChat}><input value={input} onChange={event => setInput(event.target.value)} placeholder={`和${profile.name}说点什么…`} disabled={isSending} /><button type="submit" aria-label="发送" disabled={isSending || !input.trim()}><Send size={18} /></button></form>
            </section>
          </div>
        )}

        {view === 'profile' && (
          <div className="dashboard-content profile-dashboard">
            <section className="profile-card">
              <div className="profile-portrait" style={{ '--pet-accent': mbtiGroup.color } as React.CSSProperties}><PetDisplay species={profile.species} mbti={profile.mbti} accent={mbtiGroup.color} action="idle" customImage={profile.customImage} customAnimation={profile.customAnimation} /><small>{profile.species === 'cat' ? '猫咪' : '狗狗'} · {profile.mbti} · {mbtiGroup.name}</small></div>
              <div className="profile-form">
                <div className="card-heading"><div><span>基本信息</span><small>修改后会同步到桌面</small></div><Pencil size={18} /></div>
                <label>宠物名字<input value={draftName} onChange={event => setDraftName(event.target.value)} /></label>
                <label>怎么称呼你<input value={draftOwnerName} onChange={event => setDraftOwnerName(event.target.value)} /></label>
                <div className="profile-facts"><div><span>性格</span><strong>{profile.mbti} · {mbti.name}</strong></div><div><span>相识于</span><strong>{new Date(profile.createdAt).toLocaleDateString('zh-CN')}</strong></div></div>
                <button className="save-profile-button" onClick={saveProfileDetails}>保存修改</button>
                <button className="edit-full-profile" onClick={onEdit}>重新选择物种、性格或形象 <ChevronRight size={16} /></button>
              </div>
            </section>
          </div>
        )}
      </section>
      {feedback && <div className="dashboard-toast">{feedback}</div>}
    </main>
  )
}

function StatusRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="status-row"><div><span>{label}</span><strong>{value}</strong></div><div className={`status-track ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>
}

function Onboarding({ existing, onComplete, onCancel }: {
  existing?: PetProfile | null
  onComplete: (profile: PetProfile) => void
  onCancel?: () => void
}) {
  const mipet = getMipetBridge()
  const isEditingExisting = Boolean(existing)
  const [step, setStep] = useState(existing ? 2 : 1)
  const [ownerName, setOwnerName] = useState(existing?.ownerName ?? '')
  const [ownerMbti, setOwnerMbti] = useState(existing?.ownerMbti ?? '')
  const [species, setSpecies] = useState<Species>(existing?.species ?? 'cat')
  const [selected, setSelected] = useState<Personality>(personalities.find(p => p.type === existing?.mbti) ?? personalities[0])
  const [appearanceMode, setAppearanceMode] = useState<'default' | 'custom'>('default')
  const [customImage, setCustomImage] = useState<string | undefined>(undefined)
  const [customAnimation, setCustomAnimation] = useState<PetAnimationPack | undefined>(existing?.customAnimation)
  const [referenceImage, setReferenceImage] = useState<string | undefined>(undefined)
  const [appearanceStatus, setAppearanceStatus] = useState('')
  const [isAppearanceGenerating, setIsAppearanceGenerating] = useState(false)
  const [isSpriteGenerating, setIsSpriteGenerating] = useState(false)
  const [petName, setPetName] = useState(existing?.name ?? '')
  const [ownerError, setOwnerError] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const [userTestOpen, setUserTestOpen] = useState(false)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [openMbtiGroup, setOpenMbtiGroup] = useState<MbtiGroupId | null>(() => getMbtiGroup(existing?.ownerMbti || existing?.mbti || 'INTJ').id)
  const [personalityPath, setPersonalityPath] = useState<'test' | 'direct' | null>(null)
  const [testType, setTestType] = useState<'pet-behavior' | 'user-as-pet' | null>(null)

  const selectedGroup = getMbtiGroup(selected.type)
  const previewStyle = useMemo(() => ({ '--pet-accent': selectedGroup.color } as React.CSSProperties), [selectedGroup.color])
  const recommendations = useMemo(() => getPetRecommendations(ownerMbti), [ownerMbti])
  const recommendedTypes = useMemo(() => new Set(recommendations.map(item => item.type)), [recommendations])
  const ownerMbtiPersonality = ownerMbti ? personalities.find(item => item.type === ownerMbti) : null
  const hasGeneratedAppearance = Boolean(customImage || customAnimation)
  const shouldShowAppearancePlaceholder = !hasGeneratedAppearance && isAppearanceGenerating

  useEffect(() => {
    if (!ownerMbti) return
    setOpenMbtiGroup(getMbtiGroup(ownerMbti).id)
  }, [ownerMbti])

  useEffect(() => {
    if (!isEditingExisting) return
    setAppearanceMode('default')
    setCustomImage(undefined)
    setCustomAnimation(undefined)
    setReferenceImage(undefined)
    setIsAppearanceGenerating(false)
    setAppearanceStatus('已重置上一轮形象，请重新生成或重新上传参考图')
  }, [isEditingExisting])

  useEffect(() => {
    if (customImage || customAnimation) setIsAppearanceGenerating(false)
  }, [customAnimation, customImage])

  useEffect(() => {
    if (!appearanceStatus) return
    if (
      appearanceStatus.includes('失败') ||
      appearanceStatus.includes('不可用') ||
      appearanceStatus.includes('较长') ||
      appearanceStatus.includes('完成')
    ) {
      setIsAppearanceGenerating(false)
    }
  }, [appearanceStatus])

  useEffect(() => {
    if (appearanceStatus.includes('3D')) {
      setIsAppearanceGenerating(false)
    }
  }, [appearanceStatus])

  function choosePersonality(personality: Personality) {
    setSelected(personality)
    setOpenMbtiGroup(getMbtiGroup(personality.type).id)
    setAppearanceMode('default')
    setCustomImage(undefined)
    setCustomAnimation(undefined)
    setReferenceImage(undefined)
    setIsAppearanceGenerating(false)
    setAppearanceStatus('')
  }

  function next() {
    if (step === 1 && !ownerName.trim()) {
      setOwnerError('先告诉我应该怎么称呼你')
      return
    }
    if (step === 4 && isAppearanceGenerating) {
      setAppearanceStatus('形象生成中，请耐心等待生成完成后再继续')
      return
    }
    if (step === 4 && isSpriteGenerating) {
      setAppearanceStatus('动作帧生成中，请耐心等待完成后再继续')
      return
    }
    if (step === 4 && appearanceMode === 'custom' && !hasGeneratedAppearance) {
      setAppearanceStatus(referenceImage ? '已上传参考图，请先点击“开始生成形象”，生成完成后再继续' : '请先上传一张参考图片，再开始生成形象')
      return
    }
    setOwnerError('')
    setStep(s => Math.min(5, s + 1))
  }

  async function generateActionSpriteSheets(personality: Personality, referenceImageUrl?: string) {
    void personality
    void referenceImageUrl
    setIsSpriteGenerating(false)
    setAppearanceStatus('全部生成完成，可以继续')
    return

    const action = 'yawn'
    setIsSpriteGenerating(true)
    setAppearanceStatus(`正在生成${species === 'cat' ? '打哈欠' : '吐舌头'}动作帧…`)
    try {
      const response = await fetch(`${API_BASE}/v1/appearance/sprite-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          species,
          mbti: personality.type,
          reference_image_url: referenceImageUrl ?? null,
        })
      })
      if (!response.ok) {
        setIsSpriteGenerating(false)
        setAppearanceStatus('动作帧生成请求失败')
        return
      }
      const result = await response.json() as { status: string; task_id?: string; clip?: PetAnimationClip }
      if (result.status === 'completed' && result.clip) {
        setCustomAnimation(prev => ({ version: 'v1', ...prev, [action]: result.clip }))
        setIsSpriteGenerating(false)
        setAppearanceStatus('全部生成完成，可以继续')
      } else if (result.task_id) {
        void pollSpriteSheetTask(result.task_id, action)
      } else {
        setIsSpriteGenerating(false)
        setAppearanceStatus('动作帧生成失败')
      }
    } catch {
      setIsSpriteGenerating(false)
      setAppearanceStatus('动作帧生成失败')
    }
  }

  async function pollSpriteSheetTask(taskId: string, action: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 3000))
      try {
        const response = await fetch(`${API_BASE}/v1/appearance/sprite-sheet/tasks/${encodeURIComponent(taskId)}?action=${encodeURIComponent(action)}`)
        if (!response.ok) continue
        const result = await response.json() as { status: string; clip?: PetAnimationClip; message?: string }
        setAppearanceStatus(result.message ?? `动作帧生成中（${attempt + 1}/30）…`)
        if (result.status === 'completed' && result.clip) {
          setCustomAnimation(prev => ({ version: 'v1', ...prev, [action]: result.clip }))
          setIsSpriteGenerating(false)
          setAppearanceStatus('全部生成完成，可以继续')
          return
        }
        if (result.status === 'failed') {
          setIsSpriteGenerating(false)
          setAppearanceStatus(result.message ?? '动作帧生成失败')
          return
        }
      } catch {
        continue
      }
    }
    setIsSpriteGenerating(false)
    setAppearanceStatus('动作帧生成超时')
  }

  async function pollAppearanceTask(taskId: string, imageDataUrl: string | null, personality: Personality, retryCount = 0) {
    let pollErrorCount = 0
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 3000))
      try {
        const response = await fetch(`${API_BASE}/v1/appearance/tasks/${encodeURIComponent(taskId)}`)
        if (!response.ok) throw new Error('task query failed')
        const result = await response.json() as { status: string; image_url?: string; progress?: number; message?: string; animation_pack?: PetAnimationPack; animationPack?: PetAnimationPack }
        pollErrorCount = 0
        setAppearanceStatus(result.message ?? `正在生成专属形象（${result.progress ?? 0}%）`)
        const animationPack = result.animationPack ?? result.animation_pack
        const hasAnimationPack = Boolean(animationPack?.idle || animationPack?.walk || animationPack?.eat || animationPack?.pet || animationPack?.yawn)
        if (result.status === 'completed' && (result.image_url || hasAnimationPack)) {
          setCustomImage(result.image_url)
          setCustomAnimation(animationPack)
          setIsAppearanceGenerating(false)
          setAppearanceStatus('专属形象生成完成，正在生成动作帧…')
          setAppearanceStatus('全部生成完成，可以继续')
          return
        }
        if (result.status === 'failed') {
          if (retryCount < MAX_APPEARANCE_RETRIES) {
            setAppearanceStatus(`生成失败，正在自动重试（${retryCount + 1}/${MAX_APPEARANCE_RETRIES}）…`)
            void requestAppearance(imageDataUrl, personality, retryCount + 1)
          } else {
            setIsAppearanceGenerating(false)
            setAppearanceStatus(result.message ?? '图片生成失败，请稍后重试')
          }
          return
        }
      } catch {
        pollErrorCount += 1
        if (pollErrorCount >= MAX_APPEARANCE_POLL_ERRORS) {
          if (retryCount < MAX_APPEARANCE_RETRIES) {
            setAppearanceStatus(`查询异常，正在自动重试（${retryCount + 1}/${MAX_APPEARANCE_RETRIES}）…`)
            void requestAppearance(imageDataUrl, personality, retryCount + 1)
          } else {
            setIsAppearanceGenerating(false)
            setAppearanceStatus('网络异常，请稍后重试')
          }
          return
        }
        continue
      }
    }
    setIsAppearanceGenerating(false)
    setAppearanceStatus('生成时间较长，可稍后重新尝试')
  }

  async function requestAppearance(imageDataUrl: string | null, personality: Personality, retryCount = 0) {
    setIsAppearanceGenerating(true)
    setCustomImage(undefined)
    setCustomAnimation(undefined)
    if (retryCount === 0) {
      setAppearanceStatus(`正在按 ${personality.type} 特征生成专属形象…`)
    }
    try {
      const response = await fetch(`${API_BASE}/v1/pets/appearance/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          species,
          mbti: personality.type,
          image_data_url: imageDataUrl,
        })
      })
      if (!response.ok) {
        if (retryCount < MAX_APPEARANCE_RETRIES) {
          setAppearanceStatus(`请求失败，正在自动重试（${retryCount + 1}/${MAX_APPEARANCE_RETRIES}）…`)
          await new Promise(resolve => window.setTimeout(resolve, 2000))
          return requestAppearance(imageDataUrl, personality, retryCount + 1)
        }
        throw new Error('appearance request failed')
      }
      const result = await response.json() as { status: string; image_url?: string; task_id?: string; progress?: number; message?: string; animation_pack?: PetAnimationPack; animationPack?: PetAnimationPack }
      const animationPack = result.animationPack ?? result.animation_pack
      const hasAnimationPack = Boolean(animationPack?.idle || animationPack?.walk || animationPack?.eat || animationPack?.pet || animationPack?.yawn)
      if (result.task_id && !result.image_url && !hasAnimationPack) void pollAppearanceTask(result.task_id, imageDataUrl, personality, retryCount)
      if (result.image_url || hasAnimationPack) {
        setCustomImage(result.image_url)
        setCustomAnimation(animationPack)
        setIsAppearanceGenerating(false)
        setAppearanceStatus('专属形象生成完成，正在生成动作帧…')
        void generateActionSpriteSheets(personality, result.image_url)
      } else {
        setAppearanceStatus(result.message ?? `图片生成任务已提交（${result.progress ?? 0}%）`)
      }
    } catch {
      setIsAppearanceGenerating(false)
      setAppearanceStatus('图像服务暂时不可用，将使用默认 3D 形象')
    }
  }

  function startCustomAppearanceGeneration() {
    if (!referenceImage || isAppearanceGenerating || isSpriteGenerating) return
    void requestAppearance(referenceImage, selected)
  }

  function handlePhoto(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      setReferenceImage(dataUrl)
      setAppearanceMode('custom')
      setCustomImage(undefined)
      setCustomAnimation(undefined)
      setIsAppearanceGenerating(false)
      setAppearanceStatus('参考图已上传，确认无误后点击“开始生成形象”')
    }
    reader.readAsDataURL(file)
  }

  function completePetTest(result: PetMbtiResult) {
    const personality = personalities.find(item => item.type === result.type) ?? personalities[0]
    choosePersonality(personality)
    setTestOpen(false)
    setStep(4)
  }

  function completeUserTest(result: UserPetResult) {
    const personality = personalities.find(item => item.type === result.type) ?? personalities[0]
    choosePersonality(personality)
    setUserTestOpen(false)
    setStep(4)
  }

  async function adopt() {
    const profile: PetProfile = {
      id: existing?.id ?? crypto.randomUUID(),
      name: petName.trim() || `${selected.name}的小伙伴`,
      species,
      mbti: selected.type,
      ownerName: ownerName.trim(),
      ownerMbti: ownerMbti || null,
      appearanceMode,
      customImage,
      customAnimation,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    }
    const state = existing ? getState() : { ...DEFAULT_PET_STATE }
    saveProfile(profile)
    saveState(state)
    try {
      await saveSnapshot({ profile, state })
    } finally {
      onComplete(profile)
      await mipet.openPet(profile)
    }
  }

  return (
    <main className="app-shell">
      <section className="onboarding-shell">
        <header className="brand-header">
          <div className="brand-mark"><PawPrint size={22} /></div>
          <div><div className="brand-name">MiPet</div><div className="brand-tagline">每只宠物都该有个灵魂</div></div>
          {onCancel ? <button className="onboarding-return" onClick={onCancel}>返回管理台</button> : <div className="header-badge"><Sparkles size={15} /> 桌面伙伴</div>}
        </header>

        <div className="progress-row">
          {['认识你', '选物种', '选性格', '选形象', '起名字'].map((label, index) => <div className={`progress-item ${step >= index + 1 ? 'active' : ''}`} key={label}><span>{index + 1}</span>{label}</div>)}
        </div>

        <div className="onboarding-stage">
        {step === 1 && (
          <section className="onboarding-grid">
            <div className="hero-copy">
              <div className="eyebrow">WELCOME TO MIPET</div>
              <h1>先让它知道，<br /><em>应该怎么称呼你。</em></h1>
              <p>选好你的 MBTI 后，MiPet 会推荐更适合长期相处的宠物人格；也可以暂时跳过。</p>
              <div className="hero-pet"><div className="hero-emoji">🐈</div><div className="hero-caption">“先认识你，再找到合拍的我。”</div></div>
            </div>
            <div className="form-panel">
              <label>你的昵称</label>
              <input className="text-input" placeholder="例如：小米同学" value={ownerName} onChange={event => setOwnerName(event.target.value)} autoFocus />
              {ownerError && <div className="error-text">{ownerError}</div>}
              <label className="spaced-label">你的 MBTI <span>可选</span></label>
              <div className="owner-mbti-row">
                <div className={`mbti-picker ${ownerPickerOpen ? 'open' : ''}`}>
                  <button
                    className="mbti-picker-trigger"
                    type="button"
                    aria-expanded={ownerPickerOpen}
                    onClick={() => setOwnerPickerOpen(open => !open)}
                  >
                    <span>
                      {ownerMbti ? <strong>{ownerMbti}</strong> : <strong>暂时跳过</strong>}
                      <small>{ownerMbtiPersonality?.name ?? '之后也可以再填写'}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  {ownerPickerOpen && (
                    <div className="mbti-picker-menu">
                      <button className={!ownerMbti ? 'active' : ''} type="button" onClick={() => { setOwnerMbti(''); setOwnerPickerOpen(false) }}>
                        <span>暂时跳过</span><small>不影响继续领养</small>
                      </button>
                      {Object.values(MBTI_GROUPS).map(group => (
                        <section key={group.id} style={{ '--mbti-group-color': group.color, '--mbti-group-soft': group.softColor } as React.CSSProperties}>
                          <div className="mbti-picker-group"><i />{group.name}</div>
                          <div className="mbti-picker-options">
                            {MBTI_TYPES.filter(type => getMbtiGroup(type).id === group.id).map(type => {
                              const personality = personalities.find(item => item.type === type)
                              return (
                                <button key={type} className={ownerMbti === type ? 'active' : ''} type="button" onClick={() => { setOwnerMbti(type); setOwnerPickerOpen(false) }}>
                                  <strong>{type}</strong>
                                  <small>{personality?.name}</small>
                                </button>
                              )
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
                <button className="link-button" onClick={() => mipet.openExternal(OWNER_MBTI_LINK)}><ExternalLink size={15} />去测试</button>
              </div>
              {ownerMbti && <div className="owner-selection-note" style={{ '--owner-color': getMbtiGroup(ownerMbti).color } as React.CSSProperties}><CheckCircle2 size={15} />将按 {ownerMbti} 为你推荐宠物人格</div>}
              <button className="primary-button full" onClick={next}>开始领养 <ArrowRight size={17} /></button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="selection-section">
            <div className="section-intro"><div className="eyebrow">STEP 02 / SPECIES</div><h2>你想和谁一起生活？</h2><p>不同物种有不同的动作风格和表情系统，选好之后还能定制外貌。</p></div>
            <div className="species-grid">
              {(Object.keys(speciesMeta) as Species[]).map(key => (
                <button
                  key={key}
                  className={`species-card ${species === key ? 'selected' : ''}`}
                  onClick={() => {
                    setSpecies(key)
                    setAppearanceMode('default')
                    setCustomImage(undefined)
                    setCustomAnimation(undefined)
                    setReferenceImage(undefined)
                    setIsAppearanceGenerating(false)
                    setAppearanceStatus('')
                  }}
                >
                  <div className="species-emoji">{speciesMeta[key].emoji}</div>
                  <div className="species-label">{speciesMeta[key].label}</div>
                  <div className="species-subtitle">{speciesMeta[key].subtitle}</div>
                  {species === key && <div className="selected-mark"><Check size={15} /></div>}
                </button>
              ))}
            </div>
            <div className="species-features">
              <div className="feature-item"><Sparkles size={14} /><span>16 种独立人格，每种有专属装饰和动作</span></div>
              <div className="feature-item"><MessageCircle size={14} /><span>能聊天、能记住你们的对话</span></div>
              <div className="feature-item"><Heart size={14} /><span>情感系统，越互动越亲密</span></div>
            </div>
            <FooterActions onBack={() => setStep(1)} onNext={next} />
          </section>
        )}

        {step === 3 && (
          <section className="selection-section">
            <div className="section-intro"><div className="eyebrow">STEP 03 / PERSONALITY</div><h2>它会是什么性格？</h2><p>性格决定了它怎么动、怎么表达情绪，以及和你相处的方式。</p></div>

            {!personalityPath && (
              <>
                <div className="personality-path-fork">
                  <button className="path-card" type="button" onClick={() => { setPersonalityPath('test'); setTestType('pet-behavior'); setTestOpen(true) }}>
                    <div className="path-card-badge">推荐</div>
                    <span className="path-card-icon">🐾</span>
                    <strong>从真实宠物出发</strong>
                    <p>观察你家猫狗的日常行为，帮它找到对应的人格</p>
                  </button>
                  <button className="path-card" type="button" onClick={() => { setPersonalityPath('test'); setTestType('user-as-pet'); setUserTestOpen(true) }}>
                    <div className="path-card-badge">推荐</div>
                    <span className="path-card-icon">💡</span>
                    <strong>从你的喜好出发</strong>
                    <p>描述你心目中理想伙伴的样子，我们来匹配</p>
                  </button>
                  <button className="path-card compact" type="button" onClick={() => setPersonalityPath('direct')}>
                    <span className="path-card-icon"><PawPrint size={22} /></span>
                    <strong>我已经想好了</strong>
                    <p>心里有数，直接从 16 种人格里挑</p>
                  </button>
                </div>
                <div className="personality-preview-strip">
                  <div className="preview-strip-pet"><PetDisplay species={species} mbti={selected.type} accent={selectedGroup.color} action="idle" /></div>
                  <div className="preview-strip-info">
                    <div className="preview-strip-tag" style={{ background: selectedGroup.softColor, color: selectedGroup.color }}>{selectedGroup.name}</div>
                    <strong>{selected.type} · {selected.name}</strong>
                    <p>性格决定了动作习惯、互动节奏和专属装饰——测试只需 2 分钟</p>
                  </div>
                </div>
              </>
            )}

            {personalityPath === 'direct' && (
              <>
                {recommendations.length > 0 && (
                  <section className="recommendation-panel">
                    <div className="recommendation-heading"><div><Sparkles size={18} /><strong>根据你的 {ownerMbti}，优先推荐</strong></div><span>{recommendations.length} 种适合长期陪伴的人格</span></div>
                    <div className="recommendation-list">
                      {recommendations.map(recommendation => {
                        const personality = personalities.find(item => item.type === recommendation.type) ?? personalities[0]
                        const group = getMbtiGroup(personality.type)
                        return <button key={recommendation.type} className={selected.type === recommendation.type ? 'selected' : ''} style={{ '--recommend-color': group.color, '--recommend-soft': group.softColor } as React.CSSProperties} onClick={() => choosePersonality(personality)}><span className="recommend-code">{recommendation.type}</span><div><strong>{personality.name}</strong><p>{recommendation.reason}</p></div><ChevronRight size={17} /></button>
                      })}
                    </div>
                  </section>
                )}
                <div className="mbti-accordion">
                  {Object.values(MBTI_GROUPS).map(group => {
                    const groupPersonalities = personalities.filter(personality => getMbtiGroup(personality.type).id === group.id)
                    const isOpen = openMbtiGroup === group.id
                    return (
                      <section key={group.id} className={`mbti-accordion-group ${isOpen ? 'open' : ''}`} style={{ '--group-color': group.color, '--group-soft': group.softColor } as React.CSSProperties}>
                        <button
                          type="button"
                          className="mbti-accordion-header"
                          onClick={() => setOpenMbtiGroup(current => current === group.id ? null : group.id)}
                          aria-expanded={isOpen}
                        >
                          <span className="mbti-accordion-title">
                            <i />
                            <strong>{group.name}</strong>
                          </span>
                          <span className="mbti-accordion-meta">
                            <small>{groupPersonalities.length} 型</small>
                            <ChevronRight size={16} />
                          </span>
                        </button>
                        {isOpen && (
                          <div className="personality-grid personality-grid-compact">
                            {groupPersonalities.map(personality => {
                              const isRecommended = recommendedTypes.has(personality.type as MbtiType)
                              return (
                                <button
                                  key={personality.type}
                                  className={`personality-card ${selected.type === personality.type ? 'selected' : ''}`}
                                  style={{ '--card-accent': group.color } as React.CSSProperties}
                                  onClick={() => choosePersonality(personality)}
                                >
                                  <div className="personality-top">
                                    <span className="type-code">{personality.type}</span>
                                    <span className={isRecommended ? 'recommend-tag' : 'card-pet'}>{isRecommended ? '推荐' : speciesMeta[species].emoji}</span>
                                  </div>
                                  <strong>{personality.name}</strong>
                                  <p>{personality.description}</p>
                                  <div className="keyword-row">{personality.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
                <FooterActions onBack={() => { setPersonalityPath(null); setTestType(null) }} onNext={next} />
              </>
            )}

            {!personalityPath && <div className="footer-actions"><button className="text-button" onClick={() => setStep(2)}>返回</button></div>}
          </section>
        )}

        {step === 4 && (
          <section className="selection-section">
            <div className="section-intro"><div className="eyebrow">STEP 04 / APPEARANCE</div><h2>它长什么样？</h2><p>AI 会根据物种和性格生成专属形象，也可以上传真实宠物照片作为参考。</p></div>
            <div className="appearance-workspace">
              <section className="appearance-preview-panel" style={previewStyle}>
                <div className={`appearance-preview-stage ${shouldShowAppearancePlaceholder ? 'is-blocked' : ''}`}>
                  {shouldShowAppearancePlaceholder ? (
                    <div className="appearance-loading">
                      <div className="appearance-loading-orb" />
                      <strong>{isAppearanceGenerating ? '形象生成中' : '等待生成结果'}</strong>
                      <span>{appearanceStatus || '已提交给生图模型，请耐心等待。'}</span>
                    </div>
                  ) : (
                    <PetDisplay species={species} mbti={selected.type} accent={selectedGroup.color} action="idle" customImage={customImage} customAnimation={customAnimation} />
                  )}
                </div>
                <div className="appearance-preview-meta"><span>{species === 'cat' ? '猫咪' : '狗狗'}</span><strong>{selected.type} · {selected.name}</strong><small>{selectedGroup.name}代表色 · 专属装饰</small></div>
              </section>
              <section className="appearance-choice-panel">
                <button className={`appearance-option-row ${appearanceMode === 'default' ? 'selected' : ''}`} type="button" onClick={() => { setAppearanceMode('default'); setCustomImage(undefined); setCustomAnimation(undefined); setReferenceImage(undefined) }}>
                  <span className="appearance-option-icon"><Sparkles size={19} /></span>
                  <div><strong>使用默认形象</strong><small>直接按当前人格生成桌宠外观和动作</small></div>
                  {appearanceMode === 'default' && <Check size={18} />}
                </button>
                <button className={`appearance-option-row ${appearanceMode === 'custom' ? 'selected' : ''}`} type="button" onClick={() => setAppearanceMode('custom')}>
                  <span className="appearance-option-icon"><Camera size={19} /></span>
                  <div><strong>上传真实宠物照片</strong><small>以你的宠物为原型，AI 生成桌宠形象</small></div>
                  {appearanceMode === 'custom' && <Check size={18} />}
                </button>
                {appearanceMode === 'custom' && (
                  <>
                    <label
                      className="dropzone"
                      onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('drag-over') }}
                      onDragLeave={event => { event.preventDefault(); event.currentTarget.classList.remove('drag-over') }}
                      onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); handlePhoto(event.dataTransfer.files?.[0]) }}
                    >
                      <input type="file" accept="image/*" onChange={event => handlePhoto(event.target.files?.[0])} />
                      {referenceImage ? (
                        <div className="dropzone-preview">
                          <img src={referenceImage} alt="宠物照片" />
                          <span>点击或拖拽更换照片</span>
                        </div>
                      ) : (
                        <div className="dropzone-empty">
                          <ImagePlus size={32} />
                          <strong>拖拽照片到这里</strong>
                          <small>或点击选择文件</small>
                        </div>
                      )}
                    </label>
                    <button
                      className="primary-button full"
                      type="button"
                      onClick={startCustomAppearanceGeneration}
                      disabled={!referenceImage || isAppearanceGenerating || isSpriteGenerating}
                    >
                      {isAppearanceGenerating ? '形象生成中…' : '开始生成形象'}
                    </button>
                  </>
                )}
                {appearanceStatus && <div className="appearance-status-line">{appearanceStatus}</div>}
              </section>
            </div>
            <FooterActions onBack={() => { setStep(3); setPersonalityPath(null); setTestType(null) }} onNext={next} />
          </section>
        )}

        {step === 5 && <section className="adopt-section"><div className="adopt-preview"><div className="generated-pet big" style={previewStyle}><PetDisplay species={species} mbti={selected.type} accent={selectedGroup.color} action="idle" customImage={customImage} customAnimation={customAnimation} /></div><div className="preview-badge" style={{ borderColor: selectedGroup.color, color: selectedGroup.color }}>{selected.type} · {selected.name} · {selectedGroup.name}</div>{appearanceMode === 'custom' && (customImage || customAnimation) && <div className="source-note">已参考你上传的真实宠物照片</div>}</div><div className="adopt-copy"><div className="eyebrow">ONE LAST THING</div><h2>给它一个名字，<br />让它真正来到你的桌面。</h2><p>它会带着 {selected.name} 的性格底色、{selectedGroup.name}的代表色和专属装饰，慢慢记住你们共同经历的每件小事。</p><input className="text-input" placeholder="给它起个名字" value={petName} onChange={e => setPetName(e.target.value)} autoFocus /><button className="primary-button full" onClick={adopt}>开始共同生活 <Sparkles size={17} /></button><button className="text-button" onClick={() => setStep(4)}>返回修改形象</button></div></section>}
        </div>
      </section>
      {testOpen && <PetMbtiTestDialog species={species} onCancel={() => { setTestOpen(false); setPersonalityPath(null); setTestType(null) }} onComplete={completePetTest} />}
      {userTestOpen && <UserPetTestDialog onCancel={() => { setUserTestOpen(false); setPersonalityPath(null); setTestType(null) }} onComplete={completeUserTest} />}
    </main>
  )
}

function FooterActions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <div className="footer-actions"><button className="text-button" onClick={onBack}>返回</button><button className="primary-button" onClick={onNext}>继续 <ArrowRight size={17} /></button></div>
}

function PetMbtiTestDialog({ species, onCancel, onComplete }: {
  species: Species
  onCancel: () => void
  onComplete: (result: PetMbtiResult) => void
}) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, TestAnswer>>({})
  const [result, setResult] = useState<PetMbtiResult | null>(null)
  const question = PET_MBTI_QUESTIONS[questionIndex]
  const answerOptions: Array<{ value: TestAnswer; label: string }> = [
    { value: -2, label: '完全不像' },
    { value: -1, label: '比较不像' },
    { value: 0, label: '不确定' },
    { value: 1, label: '比较像' },
    { value: 2, label: '非常像' }
  ]
  const dimensionMeta = [
    { key: 'EI' as const, left: 'E 外向', right: 'I 内向', max: 6 },
    { key: 'SN' as const, left: 'S 实感', right: 'N 直觉', max: 4 },
    { key: 'TF' as const, left: 'T 理性', right: 'F 感性', max: 6 },
    { key: 'JP' as const, left: 'J 规律', right: 'P 随性', max: 4 }
  ]

  function answer(value: TestAnswer) {
    const nextAnswers = { ...answers, [question.id]: value }
    setAnswers(nextAnswers)
    if (questionIndex === PET_MBTI_QUESTIONS.length - 1) {
      setResult(calculatePetMbti(nextAnswers))
    } else {
      setQuestionIndex(current => current + 1)
    }
  }

  return (
    <div className="pet-test-backdrop" role="presentation">
      <section className="pet-test-dialog" role="dialog" aria-modal="true" aria-label="宠物 MBTI 测试">
        {!result ? (
          <>
            <header className="pet-test-header"><div><Brain size={20} /><span>{species === 'cat' ? '猫咪' : '狗狗'} MBTI 测试</span></div><button onClick={onCancel} aria-label="关闭测试">×</button></header>
            <div className="pet-test-progress"><span style={{ width: `${(questionIndex + 1) / PET_MBTI_QUESTIONS.length * 100}%` }} /></div>
            <div className="pet-test-count">问题 {questionIndex + 1} / {PET_MBTI_QUESTIONS.length}</div>
            <div className="pet-question"><span>{String(question.id).padStart(2, '0')}</span><h2>{question.text}</h2><p>{question.hint}</p></div>
            <div className="answer-scale" aria-label="符合程度">
              <div className="answer-scale-labels"><span>不像它</span><span>像它</span></div>
              <div className="answer-options">{answerOptions.map(option => <button key={option.value} className={`answer-${option.value + 2}`} onClick={() => answer(option.value)}><i /><span>{option.label}</span></button>)}</div>
            </div>
            <footer className="pet-test-footer"><button disabled={questionIndex === 0} onClick={() => setQuestionIndex(current => Math.max(0, current - 1))}><ChevronLeft size={16} />上一题</button><span>请按它平时最自然的表现作答</span></footer>
          </>
        ) : (
          <div className="pet-test-result">
            <div className="result-icon" style={{ background: getMbtiGroup(result.type).softColor, color: getMbtiGroup(result.type).color }}><Check size={28} /></div>
            <span className="result-kicker">测试完成</span>
            <h2>它是 <strong style={{ color: getMbtiGroup(result.type).color }}>{result.type}</strong></h2>
            <p>{personalities.find(item => item.type === result.type)?.name} · {getMbtiGroup(result.type).name}</p>
            <div className="trait-results">
              {dimensionMeta.map(dimension => {
                const score = result.scores[dimension.key]
                const position = 50 - score / dimension.max * 50
                return <div key={dimension.key}><div><span>{dimension.left}</span><small>{result.confidence[dimension.key]}% 倾向</small><span>{dimension.right}</span></div><div className="trait-track"><i style={{ left: `${position}%`, background: getMbtiGroup(result.type).color }} /></div></div>
              })}
            </div>
            <button className="primary-button full" onClick={() => onComplete(result)}>使用这个人格并生成形象 <Sparkles size={17} /></button>
            <button className="text-button" onClick={() => { setResult(null); setQuestionIndex(0); setAnswers({}) }}>重新作答</button>
          </div>
        )}
      </section>
    </div>
  )
}

function UserPetTestDialog({ onCancel, onComplete }: {
  onCancel: () => void
  onComplete: (result: UserPetResult) => void
}) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, TestAnswer>>({})
  const [result, setResult] = useState<UserPetResult | null>(null)
  const question = USER_PET_QUESTIONS[questionIndex]
  const answerOptions: Array<{ value: TestAnswer; label: string }> = [
    { value: -2, label: '完全不想' },
    { value: -1, label: '不太想' },
    { value: 0, label: '无所谓' },
    { value: 1, label: '比较想' },
    { value: 2, label: '非常想' }
  ]
  const dimensionMeta = [
    { key: 'EI' as const, left: 'E 外向', right: 'I 内向', max: 6 },
    { key: 'SN' as const, left: 'S 实感', right: 'N 直觉', max: 4 },
    { key: 'TF' as const, left: 'T 理性', right: 'F 感性', max: 6 },
    { key: 'JP' as const, left: 'J 规律', right: 'P 随性', max: 4 }
  ]

  function answer(value: TestAnswer) {
    const nextAnswers = { ...answers, [question.id]: value }
    setAnswers(nextAnswers)
    if (questionIndex === USER_PET_QUESTIONS.length - 1) {
      setResult(calculateUserPetMbti(nextAnswers))
    } else {
      setQuestionIndex(current => current + 1)
    }
  }

  return (
    <div className="pet-test-backdrop" role="presentation">
      <section className="pet-test-dialog" role="dialog" aria-modal="true" aria-label="用户宠物人格测试">
        {!result ? (
          <>
            <header className="pet-test-header"><div><Brain size={20} /><span>找到你的理想伙伴</span></div><button onClick={onCancel} aria-label="关闭测试">×</button></header>
            <div className="pet-test-progress"><span style={{ width: `${(questionIndex + 1) / USER_PET_QUESTIONS.length * 100}%` }} /></div>
            <div className="pet-test-count">问题 {questionIndex + 1} / {USER_PET_QUESTIONS.length}</div>
            <div className="pet-question"><span>{String(question.id).padStart(2, '0')}</span><h2>{question.text}</h2><p>{question.hint}</p></div>
            <div className="answer-scale" aria-label="符合程度">
              <div className="answer-scale-labels"><span>不希望</span><span>希望</span></div>
              <div className="answer-options">{answerOptions.map(option => <button key={option.value} className={`answer-${option.value + 2}`} onClick={() => answer(option.value)}><i /><span>{option.label}</span></button>)}</div>
            </div>
            <footer className="pet-test-footer"><button disabled={questionIndex === 0} onClick={() => setQuestionIndex(current => Math.max(0, current - 1))}><ChevronLeft size={16} />上一题</button><span>凭直觉选，没有对错</span></footer>
          </>
        ) : (
          <div className="pet-test-result">
            <div className="result-icon" style={{ background: getMbtiGroup(result.type).softColor, color: getMbtiGroup(result.type).color }}><Check size={28} /></div>
            <span className="result-kicker">测试完成</span>
            <h2>你的理想伙伴是 <strong style={{ color: getMbtiGroup(result.type).color }}>{result.type}</strong></h2>
            <p>{personalities.find(item => item.type === result.type)?.name} · {getMbtiGroup(result.type).name}</p>
            <div className="trait-results">
              {dimensionMeta.map(dimension => {
                const score = result.scores[dimension.key]
                const position = 50 - score / dimension.max * 50
                return <div key={dimension.key}><div><span>{dimension.left}</span><small>{result.confidence[dimension.key]}% 倾向</small><span>{dimension.right}</span></div><div className="trait-track"><i style={{ left: `${position}%`, background: getMbtiGroup(result.type).color }} /></div></div>
              })}
            </div>
            <button className="primary-button full" onClick={() => onComplete(result)}>使用这个人格 <Sparkles size={17} /></button>
            <button className="text-button" onClick={() => { setResult(null); setQuestionIndex(0); setAnswers({}) }}>重新作答</button>
          </div>
        )}
      </section>
    </div>
  )
}

function LegacyPetWindow() {
  const mipet = getMipetBridge()
  const profile = getProfile()
  const [state, setState] = useState<PetState>(() => JSON.parse(localStorage.getItem('mipet:state') ?? '{"hunger":68,"cleanliness":86,"mood":78,"affection":12,"action":"idle"}'))
  const [message, setMessage] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [input, setInput] = useState('')
  const mbti = personalities.find(p => p.type === profile?.mbti) ?? personalities[0]
  if (!profile) return null
  const stableProfile = profile

  function act(action: PetState['action'], text: string, delta: Partial<PetState> = {}) {
    const next = { ...state, ...delta, action }
    setState(next)
    localStorage.setItem('mipet:state', JSON.stringify(next))
    setMessage(text)
    window.setTimeout(() => setMessage(''), 2600)
  }

  function feed() { act('eat', `${profile?.name}认真地吃完了这份心意。`, { hunger: Math.max(0, state.hunger - 18), mood: Math.min(100, state.mood + 4), affection: Math.min(100, state.affection + 2) }) }
  function pet() { act('pet', `${profile?.name}被摸得眯起了眼睛。`, { mood: Math.min(100, state.mood + 3), affection: Math.min(100, state.affection + 3) }) }

  async function sendChat(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content) return
    setInput('')
    setMessage(`${stableProfile.name}正在想怎么回答…`)
    try {
      const response = await fetch(`http://127.0.0.1:8787/v1/pets/${stableProfile.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { pet_id: stableProfile.id, pet_name: stableProfile.name, species: stableProfile.species, mbti: stableProfile.mbti, state, recent_messages: [] },
          event: { type: 'chat', content, metadata: {} }
        })
      })
      if (!response.ok) throw new Error('chat request failed')
      const result = await response.json() as { dialogue: string; animation: PetState['action'] }
      act(result.animation ?? 'idle', result.dialogue)
    } catch {
      const fallback = stableProfile.mbti === 'INFP'
        ? '我听到了。你可以慢慢说，我在这里。'
        : `收到。关于"${content.slice(0, 18)}"，我们可以先从最重要的一步开始。`
      act('idle', fallback)
    }
  }

  return <main className={`pet-stage action-${state.action}`} style={{ '--pet-accent': mbti.accent } as React.CSSProperties}><button className="pet-close" onClick={() => mipet.openPanel()} aria-label="打开控制面板">＋</button><div className="pet-bubble">{message || `${profile.name} · ${profile.mbti}`}</div><div className="pet-character" onDoubleClick={() => mipet.openPanel()} onClick={pet}><div className="pet-shadow" /><div className="pet-glow" /><PetDisplay species={profile.species} mbti={profile.mbti} accent={mbti.accent} action={state.action} customImage={profile.customImage} customAnimation={profile.customAnimation} /></div>{chatOpen && <form className="chat-panel" onSubmit={sendChat}><input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder={`和${profile.name}说点什么…`} /><button type="submit">发送</button></form>}<div className="pet-actions"><button onClick={() => setChatOpen(v => !v)}>聊天</button><button onClick={feed}>喂食</button><button onClick={() => act('walk', `${profile.name}在桌面上走了一圈。`)}>走走</button></div><div className="pet-stats"><span>饥饿 {state.hunger}</span><span>亲密 {state.affection}</span></div></main>
}

function PetWindow() {
  const mipet = getMipetBridge()
  const [profile, setProfile] = useState<PetProfile | null>(getProfile)
  const [state, setState] = useState<PetState>(getState)
  const [message, setMessage] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isPetHovered, setIsPetHovered] = useState(false)
  const [isHoverUiSuppressed, setIsHoverUiSuppressed] = useState(false)
  const isDraggingRef = useRef(false)
  const dragOrigin = useRef({ x: 0, y: 0 })
  const dragDistance = useRef(0)
  const passthrough = useRef<boolean | null>(null)
  const hoverLeaveTimer = useRef<number | null>(null)
  const hoverUiSuppressedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const messageTimer = useRef<number | null>(null)
  const actionTimer = useRef<number | null>(null)
  const stateRef = useRef(state)

  const mbti = personalities.find(personality => personality.type === profile?.mbti) ?? personalities[0]
  const mbtiGroup = getMbtiGroup(profile?.mbti ?? mbti.type)
  const behavior = getMbtiBehavior(profile?.mbti)
  const hoverUiVisible = isPetHovered && !isHoverUiSuppressed

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { hoverUiSuppressedRef.current = isHoverUiSuppressed }, [isHoverUiSuppressed])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await loadLatestSnapshot()
        if (cancelled || !snapshot) return
        const nextState = normalizePetState(snapshot.state)
        saveState(nextState)
        setState(nextState)
        setProfile(snapshot.profile)
      } catch (error) {
        console.warn('[MiPet] Failed to sync pet window profile:', error)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const syncPanelChanges = (event: StorageEvent) => {
      if (event.key === 'mipet:state' && event.newValue) {
        try { setState(normalizePetState(JSON.parse(event.newValue) as PetState)) } catch { /* keep current state */ }
      }
      if (event.key === 'mipet:profile' && event.newValue) {
        try { setProfile(compactProfileForStorage(JSON.parse(event.newValue) as PetProfile)) } catch { /* keep current profile */ }
      }
    }
    window.addEventListener('storage', syncPanelChanges)
    return () => window.removeEventListener('storage', syncPanelChanges)
  }, [])

  const interactionActive = hoverUiVisible || isDragging || chatOpen || controlsOpen

  useEffect(() => {
    document.documentElement.classList.add('pet-mode')

    const scheduleHide = () => {
      if (isDraggingRef.current || hoverLeaveTimer.current) return
      hoverLeaveTimer.current = window.setTimeout(() => {
        setIsPetHovered(false)
        setChatOpen(false)
        setControlsOpen(false)
        hoverLeaveTimer.current = null
      }, 220)
    }
    const updateMouseRegion = (event: PointerEvent) => {
      const hitTarget = document.elementFromPoint(event.clientX, event.clientY)
      const target = hitTarget ?? (event.target instanceof Element ? event.target : null)
      const isHoverZone = Boolean(target?.closest('[data-pet-hover-zone="true"]'))
      if (isHoverZone) {
        if (hoverLeaveTimer.current) window.clearTimeout(hoverLeaveTimer.current)
        hoverLeaveTimer.current = null
        if (!hoverUiSuppressedRef.current) setIsPetHovered(true)
        return
      }
      if (hoverUiSuppressedRef.current) setIsHoverUiSuppressed(false)
      scheduleHide()
    }
    const releaseDrag = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      mipet.endPetDrag()
      setIsDragging(false)
    }

    document.addEventListener('pointermove', updateMouseRegion)
    document.addEventListener('pointerup', releaseDrag)
    document.addEventListener('pointercancel', releaseDrag)
    window.addEventListener('blur', releaseDrag)
    document.documentElement.addEventListener('pointerleave', scheduleHide)

    return () => {
      document.documentElement.classList.remove('pet-mode')
      document.removeEventListener('pointermove', updateMouseRegion)
      document.removeEventListener('pointerup', releaseDrag)
      document.removeEventListener('pointercancel', releaseDrag)
      window.removeEventListener('blur', releaseDrag)
      document.documentElement.removeEventListener('pointerleave', scheduleHide)
      if (hoverLeaveTimer.current) window.clearTimeout(hoverLeaveTimer.current)
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        mipet.endPetDrag()
      }
    }
  }, [])

  useEffect(() => {
    if (interactionActive) {
      passthrough.current = false
      mipet.setMousePassthrough(false)
    } else {
      passthrough.current = true
      mipet.setMousePassthrough(true)
    }
  }, [interactionActive])

  useEffect(() => mipet.onWalkFinished(() => {
    setState(current => {
      const next = { ...current, action: 'idle' as const }
      saveState(next)
      if (profile) void persistPetState(profile.id, next).catch(() => undefined)
      return next
    })
  }), [])

  useEffect(() => {
    if (!profile || profile.appearanceMode === 'custom') return
    const timer = window.setInterval(() => {
      if (isDraggingRef.current || isStreaming) return
      const current = stateRef.current
      if (current.action !== 'idle') return
      const next = { ...current, action: 'yawn' as const }
      stateRef.current = next
      setState(next)
      saveState(next)
      if (actionTimer.current) window.clearTimeout(actionTimer.current)
      actionTimer.current = window.setTimeout(() => {
        setState(latest => {
          if (latest.action !== 'yawn') return latest
          const idle = { ...latest, action: 'idle' as const }
          stateRef.current = idle
          saveState(idle)
          return idle
        })
      }, 2600)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [isStreaming, profile])

  useEffect(() => {
    if (isStreaming || !message) return

    const dismiss = () => {
      setMessage('')
      setState(current => {
        const next = { ...current, action: 'idle' as const }
        localStorage.setItem('mipet:state', JSON.stringify(next))
        return next
      })
    }

    let timerId = window.setTimeout(dismiss, 5000)

    const resetTimer = () => {
      window.clearTimeout(timerId)
      timerId = window.setTimeout(dismiss, 5000)
    }

    document.addEventListener('wheel', resetTimer, { passive: true })
    document.addEventListener('mousemove', resetTimer)
    document.addEventListener('keydown', resetTimer)
    document.addEventListener('pointerdown', resetTimer)

    return () => {
      window.clearTimeout(timerId)
      document.removeEventListener('wheel', resetTimer)
      document.removeEventListener('mousemove', resetTimer)
      document.removeEventListener('keydown', resetTimer)
      document.removeEventListener('pointerdown', resetTimer)
    }
  }, [isStreaming, message])

  useEffect(() => {
    if (!profile) return
    let timeout = 0
    let disposed = false

    const schedule = () => {
      const [minimum, maximum] = behavior.autonomousDelay
      const delay = minimum + Math.random() * (maximum - minimum)
      timeout = window.setTimeout(() => {
        if (disposed) return
        if (isDragging || chatOpen) {
          schedule()
          return
        }

        const current = stateRef.current
        const roll = Math.random()
        if (current.hunger >= 76) {
          setMessage(`${profile.name} 看了看饭盆，又看了看你。`)
          if (messageTimer.current) window.clearTimeout(messageTimer.current)
          messageTimer.current = window.setTimeout(() => setMessage(''), 2800)
        } else if (roll < behavior.walkChance) {
          const [minDistance, maxDistance] = behavior.walkDistance
          const [minDuration, maxDuration] = behavior.walkDuration
          const next = { ...current, action: 'walk' as const }
          setState(next)
          saveState(next)
          void persistPetState(profile.id, next, 'walk').catch(() => undefined)
          mipet.walkPet({
            angle: Math.random() * Math.PI * 2,
            distance: minDistance + Math.random() * (maxDistance - minDistance),
            duration: minDuration + Math.random() * (maxDuration - minDuration)
          })
        } else if (roll < behavior.walkChance + behavior.attentionChance) {
          const next = { ...current, action: 'pet' as const }
          setState(next)
          saveState(next)
          setMessage(behavior.affection > 0.7 ? `${profile.name} 主动凑过来撒了个娇。` : `${profile.name} 抬头观察了你一会儿。`)
          if (actionTimer.current) window.clearTimeout(actionTimer.current)
          actionTimer.current = window.setTimeout(() => {
            setState(latest => {
              const idle = { ...latest, action: 'idle' as const }
              stateRef.current = idle
              saveState(idle)
              return idle
            })
          }, 2400 / behavior.animationSpeed)
        }
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      disposed = true
      window.clearTimeout(timeout)
    }
  }, [profile?.id, profile?.mbti, behavior, isDragging, chatOpen])

  if (!profile) return null
  const stableProfile = profile

  function suppressHoverUi() {
    if (hoverLeaveTimer.current) {
      window.clearTimeout(hoverLeaveTimer.current)
      hoverLeaveTimer.current = null
    }
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current)
      messageTimer.current = null
    }
    setMessage('')
    setChatOpen(false)
    setControlsOpen(false)
    setIsPetHovered(false)
    setIsHoverUiSuppressed(true)
  }

  function act(
    action: PetState['action'],
    text: string,
    delta: Partial<PetState> = {},
    eventType?: 'pet' | 'feed' | 'walk',
    options: { showMessage?: boolean } = {}
  ) {
    const showMessage = options.showMessage ?? true
    setState(current => {
      const next = { ...current, ...delta, action }
      saveState(next)
      void persistPetState(stableProfile.id, next, eventType).then(persisted => {
        if (!persisted) return
        setState(latest => {
          const withGrowth = {
            ...latest,
            level: persisted.level,
            xp: persisted.xp,
            evolutionStage: persisted.evolutionStage
          }
          saveState(withGrowth)
          return withGrowth
        })
      }).catch(() => undefined)
      return next
    })
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current)
      messageTimer.current = null
    }
    if (showMessage) {
      setMessage(text)
      messageTimer.current = window.setTimeout(() => setMessage(''), 2600)
    } else {
      setMessage('')
    }
    if (actionTimer.current) window.clearTimeout(actionTimer.current)
    if (action === 'eat' || action === 'pet' || action === 'yawn') {
      actionTimer.current = window.setTimeout(() => {
        setState(current => {
          const idle = { ...current, action: 'idle' as const }
          stateRef.current = idle
          saveState(idle)
          void persistPetState(stableProfile.id, idle).catch(() => undefined)
          return idle
        })
      }, action === 'eat' ? 3600 / behavior.animationSpeed : action === 'yawn' ? 2600 / behavior.animationSpeed : 2300 / behavior.animationSpeed)
    }
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragOrigin.current = { x: event.screenX, y: event.screenY }
    dragDistance.current = 0
    isDraggingRef.current = true
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    mipet.beginPetDrag()
  }

  function trackDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    dragDistance.current = Math.max(
      dragDistance.current,
      Math.hypot(event.screenX - dragOrigin.current.x, event.screenY - dragOrigin.current.y)
    )
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    isDraggingRef.current = false
    mipet.endPetDrag()
    setIsDragging(false)
  }

  function pet() {
    if (dragDistance.current > 6) {
      dragDistance.current = 0
      return
    }
    act('pet', `${stableProfile.name} 被摸得眯起了眼睛。`, {
      mood: Math.min(100, state.mood + 3),
      affection: Math.min(100, state.affection + 3)
    }, 'pet')
  }

  function feed() {
    suppressHoverUi()
    act('eat', `${stableProfile.name} 认真吃完了这份心意。`, {
      hunger: Math.max(0, state.hunger - 18),
      mood: Math.min(100, state.mood + 4),
      affection: Math.min(100, state.affection + 2)
    }, 'feed', { showMessage: false })
  }

  function walk() {
    suppressHoverUi()
    act('walk', `${stableProfile.name} 正在桌面上散步。`, {}, 'walk', { showMessage: false })
    const [minDistance, maxDistance] = behavior.walkDistance
    const [minDuration, maxDuration] = behavior.walkDuration
    mipet.walkPet({
      angle: Math.random() * Math.PI * 2,
      distance: minDistance + Math.random() * (maxDistance - minDistance),
      duration: minDuration + Math.random() * (maxDuration - minDuration)
    })
  }

  async function sendChat(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || isStreaming) return
    setInput('')
    setMessage('')
    setIsStreaming(true)
    setState(current => {
      const next = { ...current, action: 'pet' as const }
      localStorage.setItem('mipet:state', JSON.stringify(next))
      return next
    })

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch(`http://127.0.0.1:8787/v1/pets/${stableProfile.id}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            pet_id: stableProfile.id,
            pet_name: stableProfile.name,
            species: stableProfile.species,
            mbti: stableProfile.mbti,
            state,
            recent_messages: []
          },
          event: { type: 'chat', content, metadata: {} }
        }),
        signal: controller.signal
      })
      if (!response.ok) throw new Error('stream request failed')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('no reader')
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { token?: string; done?: boolean; animation?: string }
            if (data.token) {
              accumulated += data.token
              setMessage(accumulated)
            }
            if (data.done) {
              const anim = (data.animation ?? 'idle') as PetState['action']
              setState(current => {
                const next = { ...current, action: anim }
                localStorage.setItem('mipet:state', JSON.stringify(next))
                return next
              })
            }
          } catch { /* skip malformed chunks */ }
        }
      }

      setIsStreaming(false)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setIsStreaming(false)
      setMessage(`我听见啦。关于"${content.slice(0, 16)}"，等我陪你慢慢想。`)
    }
  }

  return (
    <main
      className={`pet-stage desktop-pet-stage action-${state.action} ${isDragging ? 'is-dragging' : ''} ${hoverUiVisible ? 'is-hovered' : ''}`}
      style={{ '--pet-accent': mbtiGroup.color } as React.CSSProperties}
      onContextMenu={event => {
        event.preventDefault()
        setControlsOpen(open => !open)
      }}
    >
      <button
        type="button"
        className="pet-panel-button"
        data-pet-interactive="true"
        data-pet-hover-zone="true"
        onClick={() => mipet.openPanel()}
        aria-label="打开 MiPet 面板"
        title="打开 MiPet 面板"
      >
        •••
      </button>

      {(hoverUiVisible || isDragging) && (
        <div className={`pet-bubble desktop-bubble ${isStreaming ? 'is-streaming' : ''}`} data-pet-interactive="true" data-pet-hover-zone="true">
          {!isDragging && !isStreaming && (
            <button type="button" className="bubble-close" onClick={() => setMessage('')} aria-label="关闭">&times;</button>
          )}
          {isDragging ? '带我去哪里？' : message || `${stableProfile.name} 正看着你，要聊聊天吗？`}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}

      <div
        className="pet-character desktop-pet-character"
        data-pet-interactive="true"
        data-pet-hover-zone="true"
        onPointerDown={beginDrag}
        onPointerMove={trackDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={pet}
        onDoubleClick={() => mipet.openPanel()}
        title="拖拽移动 · 单击抚摸 · 双击打开面板 · 右键互动"
      >
        <div className="pet-shadow" />
        <div className="pet-glow" />
        <PetDisplay species={stableProfile.species} mbti={stableProfile.mbti} accent={mbtiGroup.color} action={state.action} customImage={stableProfile.customImage} customAnimation={stableProfile.customAnimation} />
        <div className="pet-name-tag">{stableProfile.name} · {stableProfile.mbti}</div>
      </div>

      <div
        className={`pet-command-dock ${controlsOpen || chatOpen ? 'is-open' : ''}`}
        data-pet-interactive="true"
        data-pet-hover-zone="true"
      >
        <button type="button" onClick={() => setChatOpen(open => !open)}>聊天</button>
        <button type="button" onClick={feed}>喂食</button>
        <button type="button" onClick={walk}>散步</button>
      </div>

      {chatOpen && hoverUiVisible && (
        <form className="chat-panel desktop-chat-panel" data-pet-interactive="true" data-pet-hover-zone="true" onSubmit={sendChat}>
          <input autoFocus value={input} onChange={event => setInput(event.target.value)} placeholder={`和 ${stableProfile.name} 说点什么……`} disabled={isStreaming} />
          <button type="submit" disabled={isStreaming}>{isStreaming ? '…' : '发送'}</button>
        </form>
      )}

      <div className="pet-stats desktop-pet-stats">
        <span>饥饿 {state.hunger}</span>
        <span>亲密 {state.affection}</span>
      </div>
    </main>
  )
}

export default App
