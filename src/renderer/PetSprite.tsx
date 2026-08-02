import { useEffect, useRef, useState } from 'react'
import type { ActionId, PetAnimationClip } from '../shared/types'

interface PetSpriteProps {
  imageUrl: string
  action: ActionId
}

interface PetSpriteSheetPlayerProps {
  clip: PetAnimationClip
  action: ActionId
}

interface PetSpriteSheetStillProps {
  clip: PetAnimationClip
  frameIndex?: number
}

function useImageNaturalSize(src?: string) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!src) {
      setSize(null)
      return
    }

    const image = new window.Image()
    image.onload = () => {
      setSize({
        width: Math.max(1, image.naturalWidth || 1),
        height: Math.max(1, image.naturalHeight || 1),
      })
    }
    image.onerror = () => setSize(null)
    image.src = src
  }, [src])

  return size
}

export function PetSprite({ imageUrl, action }: PetSpriteProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let frame: number
    let start = performance.now()
    const loop = () => {
      const elapsed = performance.now() - start
      setTick(elapsed)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  const t = tick / 1000

  const breathe = Math.sin(t * 2.2) * 0.012
  const breatheY = Math.sin(t * 2.2) * 0.008

  let bodyTransform = ''
  let headTransform = ''
  let leftLegTransform = ''
  let rightLegTransform = ''
  let shadowScale = 1

  switch (action) {
    case 'idle': {
      bodyTransform = `scaleX(${1 + breathe}) scaleY(${1 + breatheY}) translateY(${Math.sin(t * 1.8) * 1.2}px)`
      headTransform = `rotate(${Math.sin(t * 0.7) * 1.5}deg) translateY(${Math.sin(t * 2.2) * 0.8}px)`
      leftLegTransform = `rotate(${Math.sin(t * 1.5) * 1.2}deg)`
      rightLegTransform = `rotate(${Math.sin(t * 1.5 + Math.PI) * 1.2}deg)`
      break
    }
    case 'walk': {
      const bounce = Math.abs(Math.sin(t * 6)) * 4
      bodyTransform = `translateY(${-bounce}px) rotate(${Math.sin(t * 6) * 2.5}deg) scaleX(${1 + breathe})`
      headTransform = `rotate(${Math.sin(t * 6) * 3}deg) translateY(${-bounce * 0.3}px)`
      leftLegTransform = `rotate(${Math.sin(t * 6) * 25}deg)`
      rightLegTransform = `rotate(${Math.sin(t * 6 + Math.PI) * 25}deg)`
      shadowScale = 1 - bounce * 0.02
      break
    }
    case 'eat': {
      const nod = Math.sin(t * 4) * 8
      bodyTransform = `scaleX(${1 + breathe}) translateY(${Math.abs(Math.sin(t * 4)) * 2}px)`
      headTransform = `rotate(${nod > 0 ? nod * 1.5 : nod * 0.5}deg) translateY(${Math.abs(nod) * 0.6}px)`
      leftLegTransform = `rotate(${Math.sin(t * 2) * 2}deg)`
      rightLegTransform = `rotate(${Math.sin(t * 2 + Math.PI) * 2}deg)`
      break
    }
    case 'pet': {
      const squish = Math.sin(t * 3) * 0.03
      bodyTransform = `scaleX(${1.02 + squish}) scaleY(${0.98 - squish}) translateY(${Math.sin(t * 3) * 2}px)`
      headTransform = `rotate(${Math.sin(t * 2) * 5}deg) translateY(${Math.sin(t * 3) * 1.5}px)`
      leftLegTransform = `rotate(${Math.sin(t * 3) * 3}deg)`
      rightLegTransform = `rotate(${Math.sin(t * 3 + 1) * 3}deg)`
      break
    }
  }

  return (
    <div ref={containerRef} className="pet-sprite-container">
      {/* Shadow */}
      <div
        className="pet-sprite-shadow"
        style={{ transform: `scaleX(${shadowScale}) scaleY(0.3)` }}
      />

      {/* Pet image with layered animation */}
      <div className="pet-sprite-body" style={{ transform: bodyTransform }}>
        {/* Head region - upper portion */}
        <div className="pet-sprite-head" style={{ transform: headTransform }}>
          <div
            className="pet-sprite-img pet-sprite-img-head"
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        </div>

        {/* Left leg region */}
        <div className="pet-sprite-leg pet-sprite-leg-left" style={{ transform: leftLegTransform }}>
          <div
            className="pet-sprite-img pet-sprite-img-leg-left"
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        </div>

        {/* Right leg region */}
        <div className="pet-sprite-leg pet-sprite-leg-right" style={{ transform: rightLegTransform }}>
          <div
            className="pet-sprite-img pet-sprite-img-leg-right"
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        </div>

        {/* Body core (torso) region */}
        <div className="pet-sprite-img pet-sprite-img-torso" style={{ backgroundImage: `url(${imageUrl})` }} />
      </div>
    </div>
  )
}

export function PetSpriteSimple({ imageUrl, action }: PetSpriteProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const naturalSize = useImageNaturalSize(imageUrl)
  const displaySize = useSpriteViewportSize(
    containerRef,
    naturalSize?.width ?? 1,
    naturalSize?.height ?? 1,
  )

  return (
    <div ref={containerRef} className="pet-sprite-simple-container">
      <div
        className="pet-sprite-simple-shadow"
        style={{ transform: 'scaleX(1)' }}
      />
      <img
        className="pet-sprite-simple-img"
        src={imageUrl}
        alt="pet"
        draggable={false}
        style={{
          width: `${displaySize.width}px`,
          height: `${displaySize.height}px`,
        }}
      />
    </div>
  )
}

function useSpriteViewportSize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  frameWidth: number,
  frameHeight: number,
) {
  const [viewportSize, setViewportSize] = useState(() => ({
    width: Math.max(1, frameWidth),
    height: Math.max(1, frameHeight),
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateViewport = () => {
      const rect = container.getBoundingClientRect()
      const maxWidth = Math.max(1, rect.width * 0.96)
      const maxHeight = Math.max(1, rect.height * 0.84)
      const aspect = frameWidth / Math.max(1, frameHeight)

      let nextWidth = maxWidth
      let nextHeight = nextWidth / aspect
      if (nextHeight > maxHeight) {
        nextHeight = maxHeight
        nextWidth = nextHeight * aspect
      }

      setViewportSize({
        width: Math.max(1, Math.round(nextWidth)),
        height: Math.max(1, Math.round(nextHeight)),
      })
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, frameHeight, frameWidth])

  return viewportSize
}

function PetSpriteSheetFrame({
  clip,
  frameIndex,
  shadowScaleX,
}: {
  clip: PetAnimationClip
  frameIndex: number
  shadowScaleX: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseNaturalSize = useImageNaturalSize(clip.baseSrc)
  const safeFrameCount = Math.max(1, clip.frameCount)
  const safeFrameIndex = Math.max(0, Math.min(frameIndex, safeFrameCount - 1))
  const columns = Math.max(1, clip.columns ?? clip.frameCount)
  const rows = Math.max(1, clip.rows ?? Math.ceil(clip.frameCount / columns))
  const columnIndex = safeFrameIndex % columns
  const rowIndex = Math.floor(safeFrameIndex / columns)
  const isOverlayClip = clip.mode === 'overlay' && Boolean(clip.baseSrc && clip.overlaySrc && clip.overlayFrameWidth && clip.overlayFrameHeight)
  const intrinsicWidth = isOverlayClip ? (baseNaturalSize?.width ?? clip.frameWidth) : clip.frameWidth
  const intrinsicHeight = isOverlayClip ? (baseNaturalSize?.height ?? clip.frameHeight) : clip.frameHeight
  const displaySize = useSpriteViewportSize(containerRef, intrinsicWidth, intrinsicHeight)
  const sheetWidth = displaySize.width * columns
  const sheetHeight = displaySize.height * rows
  const translateX = -(columnIndex * displaySize.width)
  const translateY = -(rowIndex * displaySize.height)
  const scaleX = displaySize.width / Math.max(1, clip.frameWidth)
  const scaleY = displaySize.height / Math.max(1, clip.frameHeight)
  const overlayFrameWidth = Math.max(1, Math.round((clip.overlayFrameWidth ?? 1) * scaleX))
  const overlayFrameHeight = Math.max(1, Math.round((clip.overlayFrameHeight ?? 1) * scaleY))
  const overlayLeft = Math.round((clip.overlayOffsetX ?? 0) * scaleX)
  const overlayTop = Math.round((clip.overlayOffsetY ?? 0) * scaleY)
  const overlaySheetWidth = overlayFrameWidth * columns
  const overlaySheetHeight = overlayFrameHeight * rows
  const overlayTranslateX = -(columnIndex * overlayFrameWidth)
  const overlayTranslateY = -(rowIndex * overlayFrameHeight)

  return (
    <div ref={containerRef} className="pet-sprite-sheet-container">
      <div
        className="pet-sprite-sheet-shadow"
        style={{ transform: `scaleX(${shadowScaleX})` }}
      />
      <div
        className="pet-sprite-sheet-viewport"
        style={{
          width: `${displaySize.width}px`,
          height: `${displaySize.height}px`,
        }}
      >
        {isOverlayClip ? (
          <>
            <img
              className="pet-sprite-sheet-base"
              src={clip.baseSrc}
              alt="pet base frame"
              draggable={false}
              style={{
                width: `${displaySize.width}px`,
                height: `${displaySize.height}px`,
              }}
            />
            <div
              className="pet-sprite-sheet-overlay"
              style={{
                left: `${overlayLeft}px`,
                top: `${overlayTop}px`,
                width: `${overlayFrameWidth}px`,
                height: `${overlayFrameHeight}px`,
              }}
            >
              <img
                className="pet-sprite-sheet-image"
                src={clip.overlaySrc}
                alt="pet overlay animation"
                draggable={false}
                style={{
                  width: `${overlaySheetWidth}px`,
                  height: `${overlaySheetHeight}px`,
                  transform: `translate(${overlayTranslateX}px, ${overlayTranslateY}px)`,
                }}
              />
            </div>
          </>
        ) : (
          <img
            className="pet-sprite-sheet-image"
            src={clip.src}
            alt="pet animation frame"
            draggable={false}
            style={{
              width: `${sheetWidth}px`,
              height: `${sheetHeight}px`,
              transform: `translate(${translateX}px, ${translateY}px)`,
            }}
          />
        )}
      </div>
    </div>
  )
}

export function PetSpriteSheetStill({ clip, frameIndex = 0 }: PetSpriteSheetStillProps) {
  return <PetSpriteSheetFrame clip={clip} frameIndex={frameIndex} shadowScaleX={1} />
}

export function PetSpriteSheetPlayer({ clip, action }: PetSpriteSheetPlayerProps) {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    const frameCount = Math.max(1, clip.frameCount)
    const fps = Math.max(1, clip.fps)
    setFrameIndex(0)
    let frame = 0
    const timer = window.setInterval(() => {
      frame = frame + 1
      if (clip.loop === false && frame >= frameCount) {
        window.clearInterval(timer)
        setFrameIndex(frameCount - 1)
        return
      }
      setFrameIndex(frame % frameCount)
    }, Math.round(1000 / fps))
    return () => window.clearInterval(timer)
  }, [clip.frameCount, clip.fps, clip.loop, clip.src])
  const shadowScaleX = action === 'idle' ? 0.94 + Math.sin(frameIndex * 0.8) * 0.03 : 1

  return <PetSpriteSheetFrame clip={clip} frameIndex={frameIndex} shadowScaleX={shadowScaleX} />
}
