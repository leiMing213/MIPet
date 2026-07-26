import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ExternalLink, ImagePlus, PawPrint, Sparkles } from 'lucide-react'
import type { PetProfile, PetSnapshot, PetState, Species } from '../shared/types'
import { personalities, type Personality } from './data/personalities'
import { speciesMeta } from './data/pets'
import { getMbtiBehavior } from './data/mbtiBehaviors'
import { Pet3D } from './Pet3D'

const OWNER_MBTI_LINK = 'https://www.16personalities.com/ch'
const API_BASE = 'http://127.0.0.1:8787'

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
  return mode === 'pet' ? <PetWindow /> : <Onboarding />
}

function Onboarding() {
  const existing = getProfile()
  const [step, setStep] = useState(existing ? 5 : 1)
  const [ownerName, setOwnerName] = useState(existing?.ownerName ?? '')
  const [ownerMbti, setOwnerMbti] = useState(existing?.ownerMbti ?? '')
  const [species, setSpecies] = useState<Species>(existing?.species ?? 'cat')
  const [selected, setSelected] = useState<Personality>(personalities.find(p => p.type === existing?.mbti) ?? personalities[0])
  const [appearanceMode, setAppearanceMode] = useState<'default' | 'custom'>(existing?.appearanceMode ?? 'default')
  const [customImage, setCustomImage] = useState(existing?.customImage)
  const [appearanceStatus, setAppearanceStatus] = useState('')
  const [petName, setPetName] = useState(existing?.name ?? '')
  const [ownerError, setOwnerError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await loadLatestSnapshot()
      if (cancelled) return
      if (snapshot) {
        saveProfile(snapshot.profile)
        saveState(normalizePetState(snapshot.state))
        if (!existing) {
          window.location.reload()
          return
        }
        void window.mipet.openPet(snapshot.profile)
        return
      }
      if (existing) {
        // First run after the database upgrade: migrate the old local cache into SQLite.
        void saveSnapshot({ profile: existing, state: getState() }).catch(() => undefined)
        void window.mipet.openPet(existing)
      }
    })()
    return () => { cancelled = true }
  }, [])

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
      id: crypto.randomUUID(),
      name: petName.trim() || `${selected.name}的小伙伴`,
      species,
      mbti: selected.type,
      ownerName: ownerName.trim(),
      ownerMbti: ownerMbti || null,
      appearanceMode,
      customImage,
      createdAt: new Date().toISOString()
    }
    const state = { ...DEFAULT_PET_STATE }
    saveProfile(profile)
    saveState(state)
    try {
      await saveSnapshot({ profile, state })
    } finally {
      await window.mipet.openPet(profile)
    }
  }

  return (
    <main className="app-shell">
      <section className="onboarding-shell">
        <header className="brand-header">
          <div className="brand-mark"><PawPrint size={22} /></div>
          <div><div className="brand-name">MiPet</div><div className="brand-tagline">每只宠物都该有个灵魂</div></div>
          <div className="header-badge"><Sparkles size={15} /> AI桌面宠物</div>
        </header>

        <div className="progress-row">
          {['认识你', '选择物种', '选择人格', '生成形象', '领养'].map((label, index) => <div className={`progress-item ${step >= index + 1 ? 'active' : ''}`} key={label}><span>{index + 1}</span>{label}</div>)}
        </div>

        {step === 1 && <section className="onboarding-grid"><div className="hero-copy"><div className="eyebrow">WELCOME TO MIPET</div><h1>先让它知道，<br /><em>应该怎么称呼你。</em></h1><p>你的宠物会记住这个名字。你的 MBTI 可以填写、跳转测试，也可以暂时跳过。</p><div className="hero-pet"><div className="hero-glow" /><div className="hero-emoji">🐈</div><div className="hero-caption">“我还不知道你，但我会慢慢认识你。”</div></div></div><div className="form-panel"><label>你的昵称</label><input className="text-input" placeholder="例如：小米同学" value={ownerName} onChange={e => setOwnerName(e.target.value)} autoFocus />{ownerError && <div className="error-text">{ownerError}</div>}<label className="spaced-label">你的 MBTI <span>可选</span></label><div className="owner-mbti-row"><input className="text-input" placeholder="例如：INFP" value={ownerMbti} onChange={e => setOwnerMbti(e.target.value.toUpperCase())} /><button className="link-button" onClick={() => window.mipet.openExternal(OWNER_MBTI_LINK)}><ExternalLink size={15} />去测试</button></div><button className="primary-button full" onClick={next}>开始领养 <ArrowRight size={17} /></button></div></section>}

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

function PetWindow() {
  const profile = getProfile()
  const [state, setState] = useState<PetState>(getState)
  const [message, setMessage] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const dragOrigin = useRef({ x: 0, y: 0 })
  const dragDistance = useRef(0)
  const passthrough = useRef<boolean | null>(null)
  const messageTimer = useRef<number | null>(null)
  const actionTimer = useRef<number | null>(null)
  const stateRef = useRef(state)

  const mbti = personalities.find(personality => personality.type === profile?.mbti) ?? personalities[0]
  const behavior = getMbtiBehavior(profile?.mbti)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    document.documentElement.classList.add('pet-mode')

    const updateMouseRegion = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const isInteractive = Boolean(target?.closest('[data-pet-interactive="true"]'))
      if (passthrough.current === !isInteractive) return
      passthrough.current = !isInteractive
      window.mipet.setMousePassthrough(!isInteractive)
    }
    const releaseDrag = () => {
      window.mipet.endPetDrag()
      setIsDragging(false)
    }

    document.addEventListener('pointermove', updateMouseRegion)
    document.addEventListener('pointerup', releaseDrag)
    document.addEventListener('pointercancel', releaseDrag)
    window.addEventListener('blur', releaseDrag)
    window.mipet.setMousePassthrough(true)

    return () => {
      document.documentElement.classList.remove('pet-mode')
      document.removeEventListener('pointermove', updateMouseRegion)
      document.removeEventListener('pointerup', releaseDrag)
      document.removeEventListener('pointercancel', releaseDrag)
      window.removeEventListener('blur', releaseDrag)
      window.mipet.endPetDrag()
    }
  }, [])

  useEffect(() => window.mipet.onWalkFinished(() => {
    setState(current => {
      const next = { ...current, action: 'idle' as const }
      saveState(next)
      if (profile) void persistPetState(profile.id, next).catch(() => undefined)
      return next
    })
  }), [])

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
    if (!content) return
    setInput('')
    setMessage(`${stableProfile.name} 正在想怎么回答……`)
    try {
      const response = await fetch(`http://127.0.0.1:8787/v1/pets/${stableProfile.id}/decision`, {
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
        })
      })
      if (!response.ok) throw new Error('chat request failed')
      const result = await response.json() as { dialogue: string; animation: PetState['action']; fallback?: boolean }
      act(result.animation ?? 'idle', result.fallback ? `（离线回应）${result.dialogue}` : result.dialogue)
    } catch {
      act('idle', `我听见啦。关于“${content.slice(0, 16)}”，等我陪你慢慢想。`)
    }
  }

  return (
    <main
      className={`pet-stage desktop-pet-stage action-${state.action} ${isDragging ? 'is-dragging' : ''}`}
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
        onClick={() => window.mipet.openPanel()}
        aria-label="打开 MiPet 面板"
        title="打开 MiPet 面板"
      >
        •••
      </button>

      {(message || isDragging) && (
        <div className="pet-bubble desktop-bubble">
          {isDragging ? '带我去哪里？' : message}
        </div>
      )}

      <div
        className="pet-character desktop-pet-character"
        data-pet-interactive="true"
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
      >
        <button type="button" onClick={() => setChatOpen(open => !open)}>聊天</button>
        <button type="button" onClick={feed}>喂食</button>
        <button type="button" onClick={clean}>清理</button>
        <button type="button" onClick={walk}>散步</button>
      </div>

      {chatOpen && (
        <form className="chat-panel desktop-chat-panel" data-pet-interactive="true" onSubmit={sendChat}>
          <input autoFocus value={input} onChange={event => setInput(event.target.value)} placeholder={`和 ${stableProfile.name} 说点什么……`} />
          <button type="submit">发送</button>
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
