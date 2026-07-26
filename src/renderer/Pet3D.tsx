import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { ActionId, Species } from '../shared/types'
import { getMbtiBehavior } from './data/mbtiBehaviors'

interface Pet3DProps {
  species: Species
  mbti: string
  accent: string
  action: ActionId
}

interface PetRig {
  root: THREE.Group
  body: THREE.Mesh
  head: THREE.Group
  headCore: THREE.Mesh
  legs: THREE.Group[]
  ears: THREE.Group[]
  eyes: THREE.Mesh[]
  tail: THREE.Group
  bowl: THREE.Group
}

function material(color: THREE.ColorRepresentation, roughness = 0.72) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })
}

function addMesh<T extends THREE.BufferGeometry>(parent: THREE.Object3D, geometry: T, mat: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function createPet(species: Species, mbti: string, accent: string): PetRig {
  const root = new THREE.Group()
  root.position.y = -0.68
  root.rotation.y = -0.08

  const group = mbti[1] === 'N' ? 'intuitive' : 'sensing'
  const baseColor = species === 'cat'
    ? group === 'intuitive' ? '#d8d1c9' : '#c98f55'
    : group === 'intuitive' ? '#d8b47a' : '#b97846'
  const fur = material(baseColor, 0.86)
  const lightFur = material(species === 'cat' ? '#f5e9d7' : '#efd5aa', 0.9)
  const dark = material('#302b2c', 0.64)
  const accentMat = material(accent, 0.48)

  const body = addMesh(root, new THREE.SphereGeometry(1, 40, 28), fur)
  body.scale.set(species === 'cat' ? 0.86 : 0.98, 0.82, species === 'cat' ? 1.12 : 1.06)
  body.position.set(0, 0.72, -0.12)

  const chest = addMesh(root, new THREE.SphereGeometry(0.62, 30, 22), lightFur)
  chest.scale.set(0.7, 0.9, 0.18)
  chest.position.set(0, 0.7, 0.9)

  const head = new THREE.Group()
  head.position.set(0, 1.68, 0.52)
  root.add(head)
  const headCore = addMesh(head, new THREE.SphereGeometry(0.76, 40, 30), fur)
  headCore.scale.set(species === 'cat' ? 1 : 1.05, species === 'cat' ? 0.96 : 0.92, 0.92)

  const muzzle = addMesh(head, new THREE.SphereGeometry(0.38, 28, 20), lightFur)
  muzzle.scale.set(species === 'dog' ? 1.22 : 1.02, 0.64, species === 'dog' ? 0.88 : 0.55)
  muzzle.position.set(0, -0.14, 0.66)

  const nose = addMesh(head, new THREE.SphereGeometry(0.105, 20, 14), dark)
  nose.scale.set(1.1, 0.72, 0.72)
  nose.position.set(0, -0.08, species === 'dog' ? 1.02 : 0.91)

  const eyes: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const eye = addMesh(head, new THREE.SphereGeometry(0.105, 20, 14), dark)
    eye.scale.set(0.78, mbti[2] === 'F' ? 1.18 : 0.98, 0.5)
    eye.position.set(side * 0.28, 0.15, 0.69)
    eyes.push(eye)

    const shine = addMesh(head, new THREE.SphereGeometry(0.028, 12, 8), material('#ffffff', 0.25))
    shine.position.set(side * 0.255, 0.19, 0.775)
  }

  const ears: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const ear = new THREE.Group()
    ear.position.set(side * 0.48, 0.55, 0.02)
    head.add(ear)
    if (species === 'cat') {
      const outer = addMesh(ear, new THREE.ConeGeometry(0.31, 0.72, 4), fur)
      outer.rotation.y = Math.PI / 4
      outer.rotation.z = side * -0.12
      const inner = addMesh(ear, new THREE.ConeGeometry(0.16, 0.42, 4), material('#e8a8a0', 0.9))
      inner.position.set(0, -0.02, 0.18)
      inner.rotation.y = Math.PI / 4
    } else {
      const flap = addMesh(ear, new THREE.SphereGeometry(0.34, 24, 18), material('#8c5638', 0.9))
      flap.scale.set(0.68, 1.22, 0.42)
      flap.position.set(side * 0.08, -0.22, 0.02)
      flap.rotation.z = side * 0.3
    }
    ears.push(ear)
  }

  const legs: THREE.Group[] = []
  const legPositions: Array<[number, number]> = [[-0.52, 0.54], [0.52, 0.54], [-0.54, -0.53], [0.54, -0.53]]
  for (const [x, z] of legPositions) {
    const leg = new THREE.Group()
    leg.position.set(x, 0.24, z)
    root.add(leg)
    const limb = addMesh(leg, new THREE.CapsuleGeometry(0.17, 0.54, 8, 16), fur)
    limb.position.y = -0.25
    const paw = addMesh(leg, new THREE.SphereGeometry(0.22, 22, 16), lightFur)
    paw.scale.set(1.08, 0.58, 1.25)
    paw.position.set(0, -0.61, 0.1)
    legs.push(leg)
  }

  const tail = new THREE.Group()
  tail.position.set(species === 'cat' ? 0.64 : 0, 0.8, -0.96)
  root.add(tail)
  const tailMesh = addMesh(tail, new THREE.CapsuleGeometry(species === 'cat' ? 0.12 : 0.2, species === 'cat' ? 1.15 : 0.72, 10, 18), fur)
  tailMesh.position.y = species === 'cat' ? 0.46 : 0.3
  tailMesh.rotation.z = species === 'cat' ? -0.72 : 0
  tail.rotation.x = species === 'cat' ? -0.18 : -0.8

  const collar = addMesh(head, new THREE.TorusGeometry(0.48, 0.055, 10, 40), accentMat)
  collar.rotation.x = Math.PI / 2
  collar.position.set(0, -0.55, -0.08)
  const tag = addMesh(head, new THREE.OctahedronGeometry(0.11, 0), accentMat)
  tag.position.set(0, -0.65, 0.45)

  const bowl = new THREE.Group()
  bowl.visible = false
  bowl.position.set(0, -0.5, 1.25)
  root.add(bowl)
  const bowlOuter = addMesh(bowl, new THREE.CylinderGeometry(0.5, 0.38, 0.25, 36, 1, true), accentMat)
  bowlOuter.position.y = 0.1
  const food = addMesh(bowl, new THREE.CylinderGeometry(0.34, 0.34, 0.08, 32), material('#8b5132', 0.95))
  food.position.y = 0.25

  return { root, body, head, headCore, legs, ears, eyes, tail, bowl }
}

function animateRig(rig: PetRig, action: ActionId, time: number, speed: number, gesture: number) {
  const t = time * speed
  const blinkWave = Math.sin(t * 0.72) > 0.965 ? 0.08 : 1

  rig.root.position.y = -0.68
  rig.root.rotation.x = 0
  rig.root.rotation.z = 0
  rig.root.scale.setScalar(1)
  rig.head.position.set(0, 1.68, 0.52)
  rig.head.rotation.set(0, 0, 0)
  rig.body.rotation.set(0, 0, 0)
  rig.bowl.visible = false
  rig.legs.forEach(leg => leg.rotation.set(0, 0, 0))
  rig.ears.forEach(ear => ear.rotation.set(0, 0, 0))
  rig.eyes.forEach(eye => { eye.scale.y = blinkWave })

  if (action === 'idle') {
    rig.root.position.y += Math.sin(t * 1.4) * 0.035 * gesture
    rig.body.scale.y = 0.82 + Math.sin(t * 1.8) * 0.018
    rig.head.rotation.y = Math.sin(t * 0.48) * 0.13 * gesture
    rig.head.rotation.z = Math.sin(t * 0.7) * 0.035 * gesture
    rig.tail.rotation.z = Math.sin(t * 1.35) * 0.35 * gesture
    rig.ears[0].rotation.z = Math.sin(t * 0.9) * 0.06 * gesture
    rig.ears[1].rotation.z = -Math.sin(t * 1.05) * 0.06 * gesture
  } else if (action === 'walk') {
    const stride = Math.sin(t * 7.4) * 0.58 * gesture
    rig.root.position.y += Math.abs(Math.sin(t * 7.4)) * 0.09
    rig.root.rotation.z = Math.sin(t * 7.4) * 0.025
    rig.legs[0].rotation.x = stride
    rig.legs[3].rotation.x = stride
    rig.legs[1].rotation.x = -stride
    rig.legs[2].rotation.x = -stride
    rig.head.rotation.z = Math.sin(t * 7.4) * 0.035
    rig.tail.rotation.z = Math.sin(t * 3.8) * 0.48 * gesture
  } else if (action === 'eat') {
    rig.bowl.visible = true
    rig.head.position.set(0, 0.84 + Math.sin(t * 5.5) * 0.035, 1.05)
    rig.head.rotation.x = 0.72
    rig.body.rotation.x = -0.08
    rig.legs[0].rotation.x = -0.16
    rig.legs[1].rotation.x = -0.16
    rig.eyes.forEach(eye => { eye.scale.y = 0.22 })
    rig.tail.rotation.z = Math.sin(t * 1.8) * 0.16
  } else if (action === 'pet') {
    const happy = Math.sin(t * 5.8)
    rig.root.position.y += 0.03 + Math.abs(happy) * 0.05
    rig.root.scale.set(1.03 + happy * 0.015, 0.97 - happy * 0.012, 1.03)
    rig.head.rotation.z = happy * 0.1 * gesture
    rig.head.position.y = 1.62
    rig.eyes.forEach(eye => { eye.scale.y = 0.12 })
    rig.tail.rotation.z = Math.sin(t * 8.5) * 0.62 * gesture
    rig.ears[0].rotation.z = 0.12
    rig.ears[1].rotation.z = -0.12
  }
}

export function Pet3D({ species, mbti, accent, action }: Pet3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const actionRef = useRef(action)
  actionRef.current = action

  useEffect(() => {
    const visibleCanvas = canvasRef.current
    if (!visibleCanvas) return
    const visibleContext = visibleCanvas.getContext('2d', { alpha: true })
    if (!visibleContext) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100)
    camera.position.set(0, 1.05, 7.2)
    camera.lookAt(0, 0.72, 0)

    // Keep the WebGL surface off-DOM. On some Windows GPU/DWM combinations a
    // visible WebGL canvas turns the entire layered Electron window black.
    // Copying the rendered alpha frame to a regular 2D canvas keeps 3D while
    // presenting a stable transparent surface to the desktop compositor.
    const webglCanvas = document.createElement('canvas')
    const renderer = new THREE.WebGLRenderer({
      canvas: webglCanvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setClearAlpha(0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7a8fb0, 2.25))
    const key = new THREE.DirectionalLight(0xffffff, 3.6)
    key.position.set(-3.5, 6, 5)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 2.1)
    rim.position.set(4, 2.5, -2)
    scene.add(rim)

    const rig = createPet(species, mbti, accent)
    scene.add(rig.root)
    const behavior = getMbtiBehavior(mbti)
    const clock = new THREE.Clock()

    const resize = () => {
      const width = Math.max(1, visibleCanvas.clientWidth)
      const height = Math.max(1, visibleCanvas.clientHeight)
      const pixelRatio = Math.min(window.devicePixelRatio, 2)
      renderer.setSize(width, height, false)
      visibleCanvas.width = Math.round(width * pixelRatio)
      visibleCanvas.height = Math.round(height * pixelRatio)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(visibleCanvas)
    resize()

    renderer.setAnimationLoop(() => {
      animateRig(rig, actionRef.current, clock.getElapsedTime(), behavior.animationSpeed, behavior.gestureScale)
      renderer.render(scene, camera)
      visibleContext.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height)
      visibleContext.drawImage(renderer.domElement, 0, 0, visibleCanvas.width, visibleCanvas.height)
    })

    return () => {
      observer.disconnect()
      renderer.setAnimationLoop(null)
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(item => item.dispose())
        }
      })
      renderer.dispose()
    }
  }, [species, mbti, accent])

  return <canvas ref={canvasRef} className="pet-3d-canvas" aria-label={`${mbti} ${species === 'cat' ? '三维猫咪' : '三维狗狗'}`} />
}
