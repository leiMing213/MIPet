import { useMemo, useState } from 'react'
import { ArrowRight, Check, ExternalLink, ImagePlus, PawPrint, Sparkles } from 'lucide-react'
import type { PetProfile, PetState, Species } from '../shared/types'
import { personalities, type Personality } from './data/personalities'
import { speciesMeta } from './data/pets'

const OWNER_MBTI_LINK = 'https://www.16personalities.com/ch'

function saveProfile(profile: PetProfile) {
  localStorage.setItem('mipet:profile', JSON.stringify(profile))
}

function getProfile(): PetProfile | null {
  const raw = localStorage.getItem('mipet:profile')
  return raw ? JSON.parse(raw) as PetProfile : null
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

  function adopt() {
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
    saveProfile(profile)
    localStorage.setItem('mipet:state', JSON.stringify({ hunger: 68, cleanliness: 86, mood: 78, affection: 12, action: 'idle' } satisfies PetState))
    window.mipet.openPet(profile)
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
        : `收到。关于“${content.slice(0, 18)}”，我们可以先从最重要的一步开始。`
      act('idle', fallback)
    }
  }

  return <main className={`pet-stage action-${state.action}`} style={{ '--pet-accent': mbti.accent } as React.CSSProperties}><button className="pet-close" onClick={() => window.mipet.openPanel()} aria-label="打开控制面板">＋</button><div className="pet-bubble">{message || `${profile.name} · ${profile.mbti}`}</div><div className="pet-character" onDoubleClick={() => window.mipet.openPanel()} onClick={pet}><div className="pet-shadow" /><div className="pet-glow" />{profile.customImage ? <img src={profile.customImage} alt={profile.name} className="pet-custom" /> : <div className="pet-emoji">{petEmoji}</div>}</div>{chatOpen && <form className="chat-panel" onSubmit={sendChat}><input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder={`和${profile.name}说点什么…`} /><button type="submit">发送</button></form>}<div className="pet-actions"><button onClick={() => setChatOpen(v => !v)}>聊天</button><button onClick={feed}>喂食</button><button onClick={clean}>清理</button><button onClick={() => act('walk', `${profile.name}在桌面上走了一圈。`)}>走走</button></div><div className="pet-stats"><span>饥饿 {state.hunger}</span><span>清洁 {state.cleanliness}</span><span>亲密 {state.affection}</span></div></main>
}

export default App
