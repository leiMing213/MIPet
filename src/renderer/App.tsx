import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
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
  ShowerHead,
  Smile,
  Sparkles,
  Utensils,
  UserRound
} from 'lucide-react'
import type { PetProfile, PetSnapshot, PetState, Species } from '../shared/types'
import { personalities, type Personality } from './data/personalities'
import { speciesMeta } from './data/pets'
import { getMbtiBehavior } from './data/mbtiBehaviors'
import { Pet3D } from './Pet3D'

const OWNER_MBTI_LINK = 'https://www.16personalities.com/ch'
const API_BASE = 'http://127.0.0.1:8787'

type DashboardView = 'home' | 'chat' | 'profile'
type CareAction = 'pet' | 'feed' | 'clean' | 'walk'

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

function saveProfile(profile: PetProfile) {
  localStorage.setItem('mipet:profile', JSON.stringify(profile))
}

function getProfile(): PetProfile | null {
  const raw = localStorage.getItem('mipet:profile')
  return raw ? JSON.parse(raw) as PetProfile : null
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

async function persistPetState(petId: string, state: PetState, eventType?: 'pet' | 'feed' | 'clean' | 'walk'): Promise<PetState | null> {
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
  return mode === 'pet' ? <PetWindow /> : <MainWindow />
}

function MainWindow() {
  const cachedProfile = getProfile()
  const [profile, setProfile] = useState<PetProfile | null>(cachedProfile)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await loadLatestSnapshot()
      if (cancelled) return
      if (snapshot) {
        saveProfile(snapshot.profile)
        saveState(normalizePetState(snapshot.state))
        setProfile(snapshot.profile)
        if (window.mipet) void window.mipet.openPet(snapshot.profile)
      } else if (cachedProfile) {
        void saveSnapshot({ profile: cachedProfile, state: getState() }).catch(() => undefined)
        if (window.mipet) void window.mipet.openPet(cachedProfile)
      }
      setLoading(false)
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
  const petEmoji = speciesMeta[profile.species].emoji

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
      clean: `${profile.name}现在干干净净的`,
      walk: `${profile.name}准备去桌面散散步`
    }
    const current = getState()
    const next: PetState = action === 'feed'
      ? { ...current, hunger: Math.max(0, current.hunger - 18), mood: Math.min(100, current.mood + 4), affection: Math.min(100, current.affection + 2), action: 'eat' }
      : action === 'clean'
        ? { ...current, cleanliness: Math.min(100, current.cleanliness + 20), affection: Math.min(100, current.affection + 2), action: 'pet' }
        : action === 'walk'
          ? { ...current, mood: Math.min(100, current.mood + 2), action: 'walk' }
          : { ...current, mood: Math.min(100, current.mood + 3), affection: Math.min(100, current.affection + 3), action: 'pet' }

    saveState(next)
    setState(next)
    flash(labels[action])
    if (action === 'walk' && window.mipet) {
      const behavior = getMbtiBehavior(profile.mbti)
      const [minDistance, maxDistance] = behavior.walkDistance
      const [minDuration, maxDuration] = behavior.walkDuration
      window.mipet.walkPet({
        direction: Math.random() > 0.5 ? 1 : -1,
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
  const growthLabels: Record<string, string> = { chat: '聊了一会儿', pet: '摸了摸它', feed: '喂了一顿', clean: '收拾干净', walk: '一起散步' }

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
          <span className="sidebar-avatar">{profile.customImage ? <img src={profile.customImage} alt="" /> : petEmoji}</span>
          <div><strong>{profile.name}</strong><small><i />正在桌面陪你</small></div>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div><p>{profile.ownerName ? `${profile.ownerName}，` : ''}{pageTitle}</p><span>{view === 'home' ? '这里是你们共同生活的管理台。' : view === 'chat' ? '不用想好话题，随便说点什么就行。' : '名字和外形随时都可以调整。'}</span></div>
          <button className="desktop-return-button" onClick={() => window.mipet.openPet(profile)}><MonitorUp size={17} />回到桌面</button>
        </header>

        {view === 'home' && (
          <div className="dashboard-content home-dashboard">
            <section className="pet-summary-card">
              <div className="summary-copy"><span className="status-kicker">今日状态</span><h1>{state.mood >= 75 ? '心情很好，' : '安安静静，'}<br />正在等你。</h1><p>{feedback || `${profile.name}今天已经在桌面陪着你了。想起它的时候，过来摸摸就好。`}</p><button onClick={() => setView('chat')}>去说句话 <ChevronRight size={16} /></button></div>
              <div className="summary-pet" style={{ '--pet-accent': mbti.accent } as React.CSSProperties}>
                <div className="summary-pet-floor" />
                {profile.customImage ? <img src={profile.customImage} alt={profile.name} /> : <span>{petEmoji}</span>}
                <small>Lv.{state.level} · {mbti.name}</small>
              </div>
            </section>

            <section className="state-card">
              <div className="card-heading"><div><span>生活状态</span><small>照顾得很不错</small></div><Heart size={19} /></div>
              <StatusRow label="饱腹" value={100 - state.hunger} tone="orange" />
              <StatusRow label="清洁" value={state.cleanliness} tone="blue" />
              <StatusRow label="心情" value={state.mood} tone="green" />
              <StatusRow label="亲密" value={state.affection} tone="pink" />
            </section>

            <section className="care-card">
              <div className="card-heading"><div><span>现在做点什么</span><small>操作会同步到桌面宠物</small></div></div>
              <div className="care-actions">
                <button data-testid="care-feed" onClick={() => care('feed')}><span className="care-icon food"><Utensils size={20} /></span><strong>喂食</strong><small>饥饿 -18</small></button>
                <button data-testid="care-clean" onClick={() => care('clean')}><span className="care-icon clean"><ShowerHead size={20} /></span><strong>清洁</strong><small>清洁 +20</small></button>
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
              <div className="conversation-person"><span>{profile.customImage ? <img src={profile.customImage} alt="" /> : petEmoji}</span><div><strong>{profile.name}</strong><small>{profile.mbti} · {mbti.name}</small></div></div>
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
              <div className="profile-portrait" style={{ '--pet-accent': mbti.accent } as React.CSSProperties}>{profile.customImage ? <img src={profile.customImage} alt={profile.name} /> : <span>{petEmoji}</span>}<small>{profile.species === 'cat' ? '猫咪' : '狗狗'} · {profile.mbti}</small></div>
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
  const [step, setStep] = useState(existing ? 2 : 1)
  const [ownerName, setOwnerName] = useState(existing?.ownerName ?? '')
  const [ownerMbti, setOwnerMbti] = useState(existing?.ownerMbti ?? '')
  const [species, setSpecies] = useState<Species>(existing?.species ?? 'cat')
  const [selected, setSelected] = useState<Personality>(personalities.find(p => p.type === existing?.mbti) ?? personalities[0])
  const [appearanceMode, setAppearanceMode] = useState<'default' | 'custom'>(existing?.appearanceMode ?? 'default')
  const [customImage, setCustomImage] = useState(existing?.customImage)
  const [appearanceStatus, setAppearanceStatus] = useState('')
  const [petName, setPetName] = useState(existing?.name ?? '')
  const [ownerError, setOwnerError] = useState('')

  const previewStyle = useMemo(() => ({ '--pet-accent': selected.accent } as React.CSSProperties), [selected.accent])

  function next() {
    if (step === 1 && !ownerName.trim()) {
      setOwnerError('先告诉我应该怎么称呼你')
      return
    }
    setOwnerError('')
    setStep(s => Math.min(5, s + 1))
  }

  async function pollAppearanceTask(taskId: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 3000))
      try {
        const response = await fetch(`http://127.0.0.1:8787/v1/pets/appearance/appearance/tasks/${encodeURIComponent(taskId)}`)
        if (!response.ok) throw new Error('task query failed')
        const result = await response.json() as { status: string; image_url?: string; progress?: number; message?: string }
        setAppearanceStatus(result.message ?? `正在生成专属形象（${result.progress ?? 0}%）`)
        if (result.status === 'completed' && result.image_url) {
          setCustomImage(result.image_url)
          setAppearanceStatus('专属形象生成完成')
          return
        }
        if (result.status === 'failed') {
          setAppearanceStatus(result.message ?? '图片生成失败，已保留原图预览')
          return
        }
      } catch {
        setAppearanceStatus('任务查询暂时失败，将继续保留原图预览')
        continue
      }
    }
    setAppearanceStatus('生成时间较长，可稍后重新上传或查询任务')
  }

  function handlePhoto(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const imageDataUrl = String(reader.result)
      setCustomImage(imageDataUrl)
      setAppearanceMode('custom')
      setAppearanceStatus('正在结合 MBTI 生成专属形象…')
      try {
        const response = await fetch('http://127.0.0.1:8787/v1/pets/appearance/appearance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_data_url: imageDataUrl,
            prompt: `Create a polished desktop pet portrait based on this ${species} photo. Preserve the animal's recognizable fur colors, markings, face shape and eyes. Personality: ${selected.type}, ${selected.name}. ${selected.description}. Make it warm, high-quality, clean background, centered, suitable for a transparent desktop companion.`,
          }),
        })
        if (!response.ok) throw new Error('appearance request failed')
        const result = await response.json() as { status: string; image_url?: string; task_id?: string; progress?: number; message?: string }
        if (result.task_id && !result.image_url) void pollAppearanceTask(result.task_id)
        if (result.image_url) {
          setCustomImage(result.image_url)
          setAppearanceStatus('专属形象生成完成')
        } else {
          setAppearanceStatus(`${result.message ?? `图片生成任务已提交（${result.progress ?? 0}%）`}${result.task_id ? ` · ${result.task_id}` : ''}`)
        }
      } catch {
        setAppearanceStatus('已保留原图预览，图像服务暂时不可用')
      }
    }
    reader.readAsDataURL(file)
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
      createdAt: existing?.createdAt ?? new Date().toISOString()
    }
    const state = existing ? getState() : { ...DEFAULT_PET_STATE }
    saveProfile(profile)
    saveState(state)
    try {
      await saveSnapshot({ profile, state })
    } finally {
      onComplete(profile)
      await window.mipet.openPet(profile)
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
          {['认识你', '选择物种', '选择人格', '生成形象', '领养'].map((label, index) => <div className={`progress-item ${step >= index + 1 ? 'active' : ''}`} key={label}><span>{index + 1}</span>{label}</div>)}
        </div>

        {step === 1 && <section className="onboarding-grid"><div className="hero-copy"><div className="eyebrow">WELCOME TO MIPET</div><h1>先让它知道，<br /><em>应该怎么称呼你。</em></h1><p>你的宠物会记住这个名字。你的 MBTI 可以填写、跳转测试，也可以暂时跳过。</p><div className="hero-pet"><div className="hero-glow" /><div className="hero-emoji">🐈</div><div className="hero-caption">"我还不知道你，但我会慢慢认识你。"</div></div></div><div className="form-panel"><label>你的昵称</label><input className="text-input" placeholder="例如：小米同学" value={ownerName} onChange={e => setOwnerName(e.target.value)} autoFocus />{ownerError && <div className="error-text">{ownerError}</div>}<label className="spaced-label">你的 MBTI <span>可选</span></label><div className="owner-mbti-row"><input className="text-input" placeholder="例如：INFP" value={ownerMbti} onChange={e => setOwnerMbti(e.target.value.toUpperCase())} /><button className="link-button" onClick={() => window.mipet.openExternal(OWNER_MBTI_LINK)}><ExternalLink size={15} />去测试</button></div><button className="primary-button full" onClick={next}>开始领养 <ArrowRight size={17} /></button></div></section>}

        {step === 2 && <section className="selection-section"><div className="section-intro"><div className="eyebrow">STEP 02 / SPECIES</div><h2>你想和谁一起生活？</h2><p>先选择它的物种，之后你仍然可以为它定制独特的外貌。</p></div><div className="species-grid">{(Object.keys(speciesMeta) as Species[]).map(key => <button key={key} className={`species-card ${species === key ? 'selected' : ''}`} onClick={() => setSpecies(key)}><div className="species-emoji">{speciesMeta[key].emoji}</div><div className="species-label">{speciesMeta[key].label}</div><div className="species-subtitle">{speciesMeta[key].subtitle}</div>{species === key && <div className="selected-mark"><Check size={15} /></div>}</button>)}</div><FooterActions onBack={() => setStep(1)} onNext={next} /></section>}

        {step === 3 && <section className="selection-section"><div className="section-intro"><div className="eyebrow">STEP 03 / PERSONALITY</div><h2>选择它的灵魂底色</h2><p>16种人格都拥有待机、走路、进食、被抚摸四个基础动作，但它们表达方式不同。</p></div><div className="personality-grid">{personalities.map(personality => <button key={personality.type} className={`personality-card ${selected.type === personality.type ? 'selected' : ''}`} style={{ '--card-accent': personality.accent } as React.CSSProperties} onClick={() => setSelected(personality)}><div className="personality-top"><span className="type-code">{personality.type}</span><span className="card-pet">{speciesMeta[species].emoji}</span></div><strong>{personality.name}</strong><p>{personality.description}</p><div className="keyword-row">{personality.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div></button>)}</div><FooterActions onBack={() => setStep(2)} onNext={next} /></section>}

        {step === 4 && <section className="selection-section"><div className="section-intro"><div className="eyebrow">STEP 04 / APPEARANCE</div><h2>决定它以什么样子出现</h2><p>可以直接使用参考形象，也可以上传真实的猫狗照片，让它保留原来的特征。</p></div><div className="appearance-grid"><button className={`appearance-card ${appearanceMode === 'default' ? 'selected' : ''}`} onClick={() => setAppearanceMode('default')}><div className="generated-pet" style={previewStyle}><div className="generated-orb" /><div className="generated-emoji">{speciesMeta[species].emoji}</div></div><div className="appearance-title">使用默认形象</div><div className="appearance-desc">{selected.type} · {speciesMeta[species].label}</div></button><label className={`appearance-card upload-card ${appearanceMode === 'custom' ? 'selected' : ''}`}><input type="file" accept="image/*" onChange={e => handlePhoto(e.target.files?.[0])} />{customImage ? <img src={customImage} alt="已上传宠物" className="uploaded-preview" /> : <div className="upload-placeholder"><ImagePlus size={32} /><span>上传真实宠物照片</span><small>生成后保留毛色、斑纹与眼睛</small></div>}<div className="appearance-title">上传我的宠物</div><div className="appearance-desc">Image-2 专属形象生成</div>{appearanceStatus && <div className="appearance-desc">{appearanceStatus}</div>}</label></div><FooterActions onBack={() => setStep(3)} onNext={next} /></section>}

        {step === 5 && <section className="adopt-section"><div className="adopt-preview"><div className="generated-pet big" style={previewStyle}>{customImage ? <img src={customImage} alt="你的宠物" className="custom-pet-image" /> : <><div className="generated-orb" /><div className="generated-emoji">{speciesMeta[species].emoji}</div></>}</div><div className="preview-badge">{selected.type} · {selected.name}</div></div><div className="adopt-copy"><div className="eyebrow">ONE LAST THING</div><h2>给它一个名字，<br />让它真正来到你的桌面。</h2><p>它会带着 {selected.name} 的性格底色，慢慢记住你们共同经历的每件小事。</p><input className="text-input" placeholder="给它起个名字" value={petName} onChange={e => setPetName(e.target.value)} autoFocus /><button className="primary-button full" onClick={adopt}>开始共同生活 <Sparkles size={17} /></button><button className="text-button" onClick={() => setStep(4)}>返回修改形象</button></div></section>}
      </section>
    </main>
  )
}

function FooterActions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <div className="footer-actions"><button className="text-button" onClick={onBack}>返回</button><button className="primary-button" onClick={onNext}>继续 <ArrowRight size={17} /></button></div>
}

function LegacyPetWindow() {
  const profile = getProfile()
  const [state, setState] = useState<PetState>(() => JSON.parse(localStorage.getItem('mipet:state') ?? '{"hunger":68,"cleanliness":86,"mood":78,"affection":12,"action":"idle"}'))
  const [message, setMessage] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [input, setInput] = useState('')
  const petEmoji = profile?.species === 'dog' ? '🐕' : '🐈'
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
  function clean() { act('pet', `${profile?.name}假装刚才什么都没有发生。`, { cleanliness: Math.min(100, state.cleanliness + 20), affection: Math.min(100, state.affection + 2) }) }

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

  return <main className={`pet-stage action-${state.action}`} style={{ '--pet-accent': mbti.accent } as React.CSSProperties}><button className="pet-close" onClick={() => window.mipet.openPanel()} aria-label="打开控制面板">＋</button><div className="pet-bubble">{message || `${profile.name} · ${profile.mbti}`}</div><div className="pet-character" onDoubleClick={() => window.mipet.openPanel()} onClick={pet}><div className="pet-shadow" /><div className="pet-glow" />{profile.customImage ? <img src={profile.customImage} alt={profile.name} className="pet-custom" /> : <div className="pet-emoji">{petEmoji}</div>}</div>{chatOpen && <form className="chat-panel" onSubmit={sendChat}><input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder={`和${profile.name}说点什么…`} /><button type="submit">发送</button></form>}<div className="pet-actions"><button onClick={() => setChatOpen(v => !v)}>聊天</button><button onClick={feed}>喂食</button><button onClick={clean}>清理</button><button onClick={() => act('walk', `${profile.name}在桌面上走了一圈。`)}>走走</button></div><div className="pet-stats"><span>饥饿 {state.hunger}</span><span>清洁 {state.cleanliness}</span><span>亲密 {state.affection}</span></div></main>
}

function PetWindow() {
  const [profile, setProfile] = useState<PetProfile | null>(getProfile)
  const [state, setState] = useState<PetState>(getState)
  const [message, setMessage] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isPetHovered, setIsPetHovered] = useState(false)
  const dragOrigin = useRef({ x: 0, y: 0 })
  const dragDistance = useRef(0)
  const passthrough = useRef<boolean | null>(null)
  const hoverLeaveTimer = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messageTimer = useRef<number | null>(null)
  const actionTimer = useRef<number | null>(null)
  const stateRef = useRef(state)

  const mbti = personalities.find(personality => personality.type === profile?.mbti) ?? personalities[0]
  const behavior = getMbtiBehavior(profile?.mbti)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const syncPanelChanges = (event: StorageEvent) => {
      if (event.key === 'mipet:state' && event.newValue) {
        try { setState(normalizePetState(JSON.parse(event.newValue) as PetState)) } catch { /* keep current state */ }
      }
      if (event.key === 'mipet:profile' && event.newValue) {
        try { setProfile(JSON.parse(event.newValue) as PetProfile) } catch { /* keep current profile */ }
      }
    }
    window.addEventListener('storage', syncPanelChanges)
    return () => window.removeEventListener('storage', syncPanelChanges)
  }, [])

  const interactionActive = isPetHovered || isDragging

  useEffect(() => {
    document.documentElement.classList.add('pet-mode')

    const scheduleHide = () => {
      if (isDragging || hoverLeaveTimer.current) return
      hoverLeaveTimer.current = window.setTimeout(() => {
        setIsPetHovered(false)
        setChatOpen(false)
        setControlsOpen(false)
        hoverLeaveTimer.current = null
      }, 220)
    }
    const updateMouseRegion = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const isHoverZone = Boolean(target?.closest('[data-pet-hover-zone="true"]'))
      if (isHoverZone) {
        if (hoverLeaveTimer.current) window.clearTimeout(hoverLeaveTimer.current)
        hoverLeaveTimer.current = null
        setIsPetHovered(true)
        return
      }
      scheduleHide()
    }
    const releaseDrag = () => {
      window.mipet.endPetDrag()
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
      window.mipet.endPetDrag()
    }
  }, [isDragging])

  useEffect(() => {
    if (interactionActive) {
      passthrough.current = false
      window.mipet.setMousePassthrough(false)
    } else {
      passthrough.current = true
      window.mipet.setMousePassthrough(true)
    }
  }, [interactionActive])

  useEffect(() => window.mipet.onWalkFinished(() => {
    setState(current => {
      const next = { ...current, action: 'idle' as const }
      saveState(next)
      if (profile) void persistPetState(profile.id, next).catch(() => undefined)
      return next
    })
  }), [])

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
          window.mipet.walkPet({
            direction: Math.random() > 0.5 ? 1 : -1,
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

  function act(action: PetState['action'], text: string, delta: Partial<PetState> = {}, eventType?: 'pet' | 'feed' | 'clean' | 'walk') {
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
    setMessage(text)
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(''), 2600)
    if (actionTimer.current) window.clearTimeout(actionTimer.current)
    if (action === 'eat' || action === 'pet') {
      actionTimer.current = window.setTimeout(() => {
        setState(current => {
          const idle = { ...current, action: 'idle' as const }
          stateRef.current = idle
          saveState(idle)
          void persistPetState(stableProfile.id, idle).catch(() => undefined)
          return idle
        })
      }, action === 'eat' ? 3600 / behavior.animationSpeed : 2300 / behavior.animationSpeed)
    }
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragOrigin.current = { x: event.screenX, y: event.screenY }
    dragDistance.current = 0
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    window.mipet.beginPetDrag()
  }

  function trackDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return
    dragDistance.current = Math.max(
      dragDistance.current,
      Math.hypot(event.screenX - dragOrigin.current.x, event.screenY - dragOrigin.current.y)
    )
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.mipet.endPetDrag()
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
    act('eat', `${stableProfile.name} 认真吃完了这份心意。`, {
      hunger: Math.max(0, state.hunger - 18),
      mood: Math.min(100, state.mood + 4),
      affection: Math.min(100, state.affection + 2)
    }, 'feed')
  }

  function clean() {
    act('pet', `${stableProfile.name} 又变得干干净净了。`, {
      cleanliness: Math.min(100, state.cleanliness + 20),
      affection: Math.min(100, state.affection + 2)
    }, 'clean')
  }

  function walk() {
    act('walk', `${stableProfile.name} 正在桌面上散步。`, {}, 'walk')
    const [minDistance, maxDistance] = behavior.walkDistance
    const [minDuration, maxDuration] = behavior.walkDuration
    window.mipet.walkPet({
      direction: Math.random() > 0.5 ? 1 : -1,
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
      className={`pet-stage desktop-pet-stage action-${state.action} ${isDragging ? 'is-dragging' : ''} ${isPetHovered ? 'is-hovered' : ''}`}
      style={{ '--pet-accent': mbti.accent } as React.CSSProperties}
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
        onClick={() => window.mipet.openPanel()}
        aria-label="打开 MiPet 面板"
        title="打开 MiPet 面板"
      >
        •••
      </button>

      {(isPetHovered || isDragging) && (
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
        onDoubleClick={() => window.mipet.openPanel()}
        title="拖拽移动 · 单击抚摸 · 双击打开面板 · 右键互动"
      >
        <div className="pet-shadow" />
        <div className="pet-glow" />
        <Pet3D species={stableProfile.species} mbti={stableProfile.mbti} accent={mbti.accent} action={state.action} />
        <div className="pet-name-tag">{stableProfile.name} · {stableProfile.mbti}</div>
      </div>

      <div
        className={`pet-command-dock ${controlsOpen || chatOpen ? 'is-open' : ''}`}
        data-pet-interactive="true"
        data-pet-hover-zone="true"
      >
        <button type="button" onClick={() => setChatOpen(open => !open)}>聊天</button>
        <button type="button" onClick={feed}>喂食</button>
        <button type="button" onClick={clean}>清理</button>
        <button type="button" onClick={walk}>散步</button>
      </div>

      {chatOpen && isPetHovered && (
        <form className="chat-panel desktop-chat-panel" data-pet-interactive="true" data-pet-hover-zone="true" onSubmit={sendChat}>
          <input autoFocus value={input} onChange={event => setInput(event.target.value)} placeholder={`和 ${stableProfile.name} 说点什么……`} disabled={isStreaming} />
          <button type="submit" disabled={isStreaming}>{isStreaming ? '…' : '发送'}</button>
        </form>
      )}

      <div className="pet-stats desktop-pet-stats">
        <span>饥饿 {state.hunger}</span>
        <span>清洁 {state.cleanliness}</span>
        <span>亲密 {state.affection}</span>
      </div>
    </main>
  )
}

export default App
