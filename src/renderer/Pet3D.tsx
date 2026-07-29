import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { ActionId, Species } from '../shared/types'
import { getMbtiBehavior } from './data/mbtiBehaviors'
import { getMbtiGroup, isMbtiType, MBTI_DECORATIONS, type MbtiType } from './data/mbti'
import { getMipetBridge } from './mipetBridge'

interface Pet3DProps {
  species: Species
  mbti: string
  accent: string
  action: ActionId
}

interface LegRig {
  root: THREE.Group
  upper: THREE.Group
  lower: THREE.Group
  paw: THREE.Group
  base: THREE.Vector3
  side: number
  front: number
}

interface PetRig {
  root: THREE.Group
  body: THREE.Mesh
  chest: THREE.Mesh
  head: THREE.Group
  headCore: THREE.Mesh
  muzzle: THREE.Mesh
  legs: LegRig[]
  ears: THREE.Group[]
  eyes: THREE.Mesh[]
  eyeHighlights: THREE.Mesh[]
  brows: THREE.Mesh[]
  whiskers: THREE.Mesh[]
  eyeBaseScaleY: number
  tail: THREE.Group
  bowl: THREE.Group
  nameplate: THREE.Group
  decoration: THREE.Group
  rootBaseY: number
  bodyBaseScale: THREE.Vector3
  headBase: THREE.Vector3
}

function petMaterial(color: THREE.ColorRepresentation, roughness = 0.74, metalness = 0.02) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat: 0.18,
    clearcoatRoughness: 0.72
  })
}

function addMesh<T extends THREE.BufferGeometry>(
  parent: THREE.Object3D,
  geometry: T,
  mat: THREE.Material,
  position?: [number, number, number],
  scale?: [number, number, number]
) {
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (position) mesh.position.set(...position)
  if (scale) mesh.scale.set(...scale)
  parent.add(mesh)
  return mesh
}

function createLabelTexture(mbti: string, label: string, accent: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 208
  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(255, 255, 255, 0.94)'
  roundRect(context, 18, 18, 476, 172, 42)
  context.fill()
  context.lineWidth = 10
  context.strokeStyle = accent
  context.stroke()
  context.fillStyle = accent
  context.font = '700 76px Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(mbti.toUpperCase(), 256, 84)
  context.fillStyle = '#3c3442'
  context.font = '500 30px Arial, sans-serif'
  context.fillText(label, 256, 146)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function starShape(radius = 0.2, inset = 0.09, points = 5) {
  const shape = new THREE.Shape()
  for (let index = 0; index < points * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / points
    const currentRadius = index % 2 === 0 ? radius : inset
    const x = Math.cos(angle) * currentRadius
    const y = Math.sin(angle) * currentRadius
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

function addStar(parent: THREE.Object3D, mat: THREE.Material, size: number, position: [number, number, number], rotationZ = 0) {
  const mesh = addMesh(parent, new THREE.ExtrudeGeometry(starShape(size, size * 0.44), { depth: size * 0.16, bevelEnabled: true, bevelSize: size * 0.015, bevelThickness: size * 0.02 }), mat, position)
  mesh.rotation.z = rotationZ
  mesh.rotation.x = -0.05
  return mesh
}

function addRod(parent: THREE.Object3D, mat: THREE.Material, radius: number, length: number, position: [number, number, number], rotation: [number, number, number]) {
  const rod = addMesh(parent, new THREE.CylinderGeometry(radius, radius, length, 12), mat, position)
  rod.rotation.set(...rotation)
  return rod
}

function createNameplate(mbti: string, label: string, accent: string) {
  const group = new THREE.Group()
  group.position.set(0, -0.54, 0.78)
  const texture = createLabelTexture(mbti, label, accent)
  if (texture) {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false })
    const plate = addMesh(group, new THREE.PlaneGeometry(0.72, 0.29), material)
    plate.castShadow = false
    plate.receiveShadow = false
  }
  const ring = addMesh(group, new THREE.TorusGeometry(0.11, 0.014, 8, 28), petMaterial(accent, 0.42), [0, 0.2, -0.03])
  ring.rotation.x = Math.PI / 2
  return group
}

function addDecoration(root: THREE.Group, type: MbtiType, species: Species, accent: string) {
  const decoration = new THREE.Group()
  const accentMat = petMaterial(accent, 0.5)
  const warmMat = petMaterial('#ffd86b', 0.44, 0.08)
  const darkMat = petMaterial('#22252c', 0.62)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#dff6ff',
    transparent: true,
    opacity: 0.55,
    roughness: 0.18,
    metalness: 0,
    transmission: 0.2,
    clearcoat: 0.7
  })
  const accessory = MBTI_DECORATIONS[type].accessory

  if (accessory === 'crown') {
    decoration.position.set(0, 0.74, 0.03)
    const band = addMesh(decoration, new THREE.CylinderGeometry(0.34, 0.37, 0.18, 5, 1, true), warmMat)
    band.rotation.y = Math.PI / 5
    for (const x of [-0.23, 0, 0.23]) addMesh(decoration, new THREE.ConeGeometry(0.11, 0.3, 4), warmMat, [x, 0.22, 0.03])
  } else if (accessory === 'glasses' || accessory === 'goggles') {
    decoration.position.set(0, 0.13, 0.71)
    const radius = accessory === 'goggles' ? 0.18 : 0.14
    const tube = accessory === 'goggles' ? 0.025 : 0.015
    for (const side of [-1, 1]) {
      const lens = addMesh(decoration, new THREE.TorusGeometry(radius, tube, 12, 40), accessory === 'goggles' ? accentMat : darkMat, [side * 0.25, 0.02, 0.02])
      lens.rotation.y = side * 0.08
      if (accessory === 'goggles') addMesh(decoration, new THREE.CircleGeometry(radius * 0.82, 24), glassMat, [side * 0.25, 0.02, 0.012])
    }
    addRod(decoration, darkMat, 0.013, 0.19, [0, 0.02, 0.02], [0, 0, Math.PI / 2])
    if (accessory === 'goggles') addRod(decoration, darkMat, 0.018, 0.86, [0, 0.01, -0.03], [0, Math.PI / 2, 0])
  } else if (accessory === 'cape') {
    decoration.position.set(0, -0.08, -0.48)
    const cape = addMesh(decoration, new THREE.ConeGeometry(0.82, 1.25, 4, 1, true), new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.62, side: THREE.DoubleSide, transparent: true, opacity: 0.82 }))
    cape.scale.set(1.18, 0.8, 0.28)
    cape.rotation.y = Math.PI / 4
    cape.position.y = -0.28
  } else if (accessory === 'antenna') {
    decoration.position.set(0, 0.66, 0.04)
    for (const side of [-1, 1]) {
      addRod(decoration, accentMat, 0.018, 0.58, [side * 0.18, 0.23, 0], [0.18, 0, side * -0.45])
      addMesh(decoration, new THREE.SphereGeometry(0.075, 16, 12), warmMat, [side * 0.32, 0.5, 0.03])
    }
  } else if (accessory === 'crystal') {
    decoration.position.set(0, 0.31, 0.72)
    const crystal = addMesh(decoration, new THREE.OctahedronGeometry(0.18, 1), glassMat)
    crystal.scale.set(0.72, 1.18, 0.52)
  } else if (accessory === 'flower') {
    decoration.position.set(-0.48, 0.45, 0.24)
    for (let index = 0; index < 6; index += 1) {
      const petal = addMesh(decoration, new THREE.SphereGeometry(0.09, 16, 12), accentMat, [Math.cos(index) * 0.11, Math.sin(index) * 0.11, 0])
      petal.scale.set(0.72, 1.12, 0.24)
      petal.rotation.z = index
    }
    addMesh(decoration, new THREE.SphereGeometry(0.055, 14, 10), warmMat)
  } else if (accessory === 'medal') {
    decoration.position.set(0, -0.42, 0.66)
    const ribbon = addMesh(decoration, new THREE.ConeGeometry(0.14, 0.32, 3), accentMat, [0, 0.14, -0.02])
    ribbon.rotation.z = Math.PI
    addMesh(decoration, new THREE.CylinderGeometry(0.13, 0.13, 0.035, 32), warmMat, [0, -0.04, 0.03], [1, 1, 0.45]).rotation.x = Math.PI / 2
  } else if (accessory === 'star') {
    decoration.position.set(0.46, 0.45, 0.22)
    addStar(decoration, warmMat, 0.2, [0, 0, 0], 0.12)
  } else if (accessory === 'tie') {
    decoration.position.set(0, -0.42, 0.66)
    const knot = addMesh(decoration, new THREE.OctahedronGeometry(0.09, 0), accentMat, [0, 0.08, 0])
    knot.scale.set(1, 0.72, 0.5)
    const tie = addMesh(decoration, new THREE.ConeGeometry(0.12, 0.46, 3), accentMat, [0, -0.17, 0])
    tie.rotation.z = Math.PI
  } else if (accessory === 'kerchief') {
    decoration.position.set(0, -0.33, 0.57)
    const scarf = addMesh(decoration, new THREE.ConeGeometry(0.42, 0.36, 3), accentMat)
    scarf.rotation.z = Math.PI
    scarf.scale.set(1.2, 0.78, 0.16)
  } else if (accessory === 'cap' || accessory === 'beret') {
    decoration.position.set(accessory === 'beret' ? -0.08 : 0, 0.59, 0.08)
    const top = addMesh(decoration, new THREE.SphereGeometry(accessory === 'beret' ? 0.39 : 0.34, 32, 18), accentMat)
    top.scale.set(accessory === 'beret' ? 1.08 : 1, accessory === 'beret' ? 0.24 : 0.38, accessory === 'beret' ? 0.86 : 0.78)
    top.rotation.z = accessory === 'beret' ? 0.18 : 0
    if (accessory === 'cap') addMesh(decoration, new THREE.BoxGeometry(0.46, 0.07, 0.28), accentMat, [0, -0.08, 0.26], [1, 1, 0.8])
    else addMesh(decoration, new THREE.SphereGeometry(0.045, 12, 8), warmMat, [-0.05, 0.13, 0.02])
  } else if (accessory === 'bow') {
    decoration.position.set(0, 0.47, 0.5)
    for (const side of [-1, 1]) {
      const loop = addMesh(decoration, new THREE.ConeGeometry(0.16, 0.24, 4), accentMat, [side * 0.13, 0, 0])
      loop.rotation.z = side * Math.PI / 2
      loop.scale.set(1.0, 0.82, 0.52)
    }
    addMesh(decoration, new THREE.SphereGeometry(0.075, 16, 12), warmMat)
  } else if (accessory === 'bandana') {
    decoration.position.set(0, 0.3, 0.52)
    const band = addMesh(decoration, new THREE.BoxGeometry(0.72, 0.13, 0.08), accentMat)
    band.rotation.x = 0.04
    const tail = addMesh(decoration, new THREE.ConeGeometry(0.12, 0.28, 3), accentMat, [0.46, -0.07, -0.02])
    tail.rotation.z = -0.65
  } else {
    decoration.position.set(0, 0.28, 0.45)
    addStar(decoration, warmMat, 0.12, [-0.36, 0.32, 0.02], 0.1)
    addStar(decoration, accentMat, 0.16, [0.42, 0.18, 0], -0.15)
    addStar(decoration, warmMat, 0.09, [0.24, 0.52, -0.02], 0.45)
  }

  decoration.rotation.y = species === 'dog' ? 0.03 : -0.02
  root.add(decoration)
  return decoration
}

function createLeg(parent: THREE.Object3D, x: number, z: number, fur: THREE.Material, lightFur: THREE.Material): LegRig {
  const root = new THREE.Group()
  root.position.set(x, 0.45, z)
  parent.add(root)

  const upper = new THREE.Group()
  root.add(upper)
  const upperMesh = addMesh(upper, new THREE.CapsuleGeometry(0.14, 0.32, 8, 16), fur, [0, -0.16, 0])
  upperMesh.rotation.x = 0.04

  const lower = new THREE.Group()
  lower.position.y = -0.36
  upper.add(lower)
  addMesh(lower, new THREE.CapsuleGeometry(0.12, 0.28, 8, 16), fur, [0, -0.14, 0.02])

  const paw = new THREE.Group()
  paw.position.set(0, -0.33, 0.08)
  lower.add(paw)
  addMesh(paw, new THREE.SphereGeometry(0.2, 22, 16), lightFur, [0, -0.02, 0.06], [1.18, 0.52, 1.42])
  for (const toeX of [-0.08, 0, 0.08]) {
    addMesh(paw, new THREE.SphereGeometry(0.026, 10, 8), fur, [toeX, 0.01, 0.22], [1, 0.55, 0.7])
  }

  return { root, upper, lower, paw, base: root.position.clone(), side: Math.sign(x), front: z > 0 ? 1 : -1 }
}

function createPet(species: Species, mbti: string, accent: string): PetRig {
  const normalized = isMbtiType(mbti) ? mbti.toUpperCase() as MbtiType : 'INFP'
  const rootBaseY = -0.72
  const root = new THREE.Group()
  root.position.y = rootBaseY
  root.rotation.y = -0.08

  const group = getMbtiGroup(normalized)
  const isIntuitive = normalized[1] === 'N'
  const baseColor = species === 'cat'
    ? isIntuitive ? '#d8d1c9' : '#c98f55'
    : isIntuitive ? '#d9b476' : '#b97846'
  const fur = petMaterial(baseColor, 0.88)
  const sideFur = petMaterial(species === 'cat' ? '#bfa995' : '#9a613e', 0.86)
  const lightFur = petMaterial(species === 'cat' ? '#f6ead8' : '#efd4a8', 0.92)
  const pink = petMaterial('#e9a9a4', 0.84)
  const dark = petMaterial('#2d2930', 0.58)
  const accentMat = petMaterial(accent || group.color, 0.46)

  const shadow = addMesh(root, new THREE.CircleGeometry(1.32, 48), new THREE.MeshBasicMaterial({ color: '#1c1f28', transparent: true, opacity: 0.16, depthWrite: false }), [0, -0.02, 0.05], [1.1, 0.58, 1])
  shadow.rotation.x = -Math.PI / 2
  shadow.castShadow = false
  shadow.receiveShadow = false

  const body = addMesh(root, new THREE.SphereGeometry(1, 56, 36), fur, [0, 0.75, -0.14])
  body.scale.set(species === 'cat' ? 0.82 : 0.96, 0.78, species === 'cat' ? 1.16 : 1.08)
  const bodyBaseScale = body.scale.clone()

  const backPatch = addMesh(root, new THREE.SphereGeometry(0.82, 36, 24), sideFur, [0, 0.88, -0.49], [species === 'cat' ? 0.72 : 0.82, 0.5, 0.42])
  backPatch.rotation.x = -0.18

  const chest = addMesh(root, new THREE.SphereGeometry(0.58, 32, 22), lightFur, [0, 0.69, 0.82], [0.74, 0.88, 0.2])
  const chestTuft = addMesh(root, new THREE.ConeGeometry(0.23, 0.34, 3), lightFur, [0, 0.2, 0.91], [0.9, 1.05, 0.28])
  chestTuft.rotation.z = Math.PI

  const head = new THREE.Group()
  const headBase = new THREE.Vector3(0, 1.66, 0.5)
  head.position.copy(headBase)
  root.add(head)
  const headCore = addMesh(head, new THREE.SphereGeometry(0.76, 56, 36), fur)
  headCore.scale.set(species === 'cat' ? 1 : 1.05, species === 'cat' ? 0.94 : 0.9, 0.92)

  const muzzle = addMesh(head, new THREE.SphereGeometry(0.38, 32, 22), lightFur, [0, -0.16, 0.65])
  muzzle.scale.set(species === 'dog' ? 1.28 : 1.02, 0.62, species === 'dog' ? 0.92 : 0.54)
  const chin = addMesh(head, new THREE.SphereGeometry(0.21, 20, 14), lightFur, [0, -0.34, 0.62], [1.15, 0.5, 0.42])
  const nose = addMesh(head, new THREE.SphereGeometry(0.108, 24, 16), dark, [0, -0.08, species === 'dog' ? 1.02 : 0.9], [1.1, 0.72, 0.72])
  const mouth = addRod(head, dark, 0.012, 0.2, [0, -0.24, species === 'dog' ? 0.96 : 0.84], [Math.PI / 2, 0, 0])
  mouth.scale.x = 0.8

  const eyes: THREE.Mesh[] = []
  const eyeHighlights: THREE.Mesh[] = []
  const brows: THREE.Mesh[] = []
  const eyeBaseScaleY = normalized[2] === 'F' ? 1.16 : 0.96
  for (const side of [-1, 1]) {
    const eye = addMesh(head, new THREE.SphereGeometry(0.11, 22, 14), dark, [side * 0.29, 0.15, 0.68], [0.78, eyeBaseScaleY, 0.48])
    eyes.push(eye)
    const shine = addMesh(head, new THREE.SphereGeometry(0.027, 12, 8), petMaterial('#ffffff', 0.2), [side * 0.255, 0.2, 0.76])
    shine.castShadow = false
    eyeHighlights.push(shine)
    const brow = addMesh(head, new THREE.BoxGeometry(0.19, 0.028, 0.026), dark, [side * 0.29, 0.32, 0.62])
    brow.rotation.z = side * (normalized[2] === 'T' ? -0.16 : 0.08)
    brows.push(brow)
  }

  const whiskers: THREE.Mesh[] = []
  if (species === 'cat') {
    for (const side of [-1, 1]) {
      for (const [index, y] of [0.01, -0.07, -0.15].entries()) {
        const whisker = addRod(head, dark, 0.006, 0.54, [side * 0.38, y, 0.79], [Math.PI / 2, 0, side * (Math.PI / 2 + (index - 1) * 0.16)])
        whisker.castShadow = false
        whiskers.push(whisker)
      }
    }
  }

  const ears: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const ear = new THREE.Group()
    ear.position.set(side * 0.48, 0.54, 0)
    head.add(ear)
    if (species === 'cat') {
      const outer = addMesh(ear, new THREE.ConeGeometry(0.32, 0.74, 4), fur)
      outer.rotation.y = Math.PI / 4
      outer.rotation.z = side * -0.13
      const inner = addMesh(ear, new THREE.ConeGeometry(0.17, 0.42, 4), pink, [0, -0.02, 0.17])
      inner.rotation.y = Math.PI / 4
    } else {
      const flap = addMesh(ear, new THREE.SphereGeometry(0.33, 28, 20), sideFur, [side * 0.08, -0.24, 0.03], [0.72, 1.26, 0.4])
      flap.rotation.z = side * 0.34
      flap.rotation.x = 0.08
    }
    ears.push(ear)
  }

  const legs = [
    createLeg(root, -0.5, 0.5, fur, lightFur),
    createLeg(root, 0.5, 0.5, fur, lightFur),
    createLeg(root, -0.54, -0.48, fur, lightFur),
    createLeg(root, 0.54, -0.48, fur, lightFur)
  ]

  const tail = new THREE.Group()
  tail.position.set(species === 'cat' ? 0.62 : 0, 0.82, -0.95)
  root.add(tail)
  const tailMesh = addMesh(tail, new THREE.CapsuleGeometry(species === 'cat' ? 0.11 : 0.19, species === 'cat' ? 1.18 : 0.68, 12, 20), fur)
  tailMesh.position.y = species === 'cat' ? 0.46 : 0.28
  tailMesh.rotation.z = species === 'cat' ? -0.74 : 0
  tail.rotation.x = species === 'cat' ? -0.16 : -0.82

  const collar = addMesh(head, new THREE.TorusGeometry(0.49, 0.055, 10, 44), accentMat, [0, -0.55, -0.08])
  collar.rotation.x = Math.PI / 2

  const nameplate = createNameplate(normalized, MBTI_DECORATIONS[normalized].label, accent || group.color)
  head.add(nameplate)

  const decoration = addDecoration(head, normalized, species, accent || group.color)

  const bowl = new THREE.Group()
  bowl.visible = false
  bowl.position.set(0, -0.48, 1.32)
  root.add(bowl)
  const bowlOuter = addMesh(bowl, new THREE.CylinderGeometry(0.5, 0.38, 0.25, 40, 1, true), accentMat, [0, 0.1, 0])
  bowlOuter.rotation.y = 0.06
  addMesh(bowl, new THREE.CylinderGeometry(0.34, 0.34, 0.08, 32), petMaterial('#8b5132', 0.96), [0, 0.25, 0])
  for (const x of [-0.12, 0.04, 0.17]) addMesh(bowl, new THREE.SphereGeometry(0.04, 10, 8), petMaterial('#7a4129', 0.94), [x, 0.32, 0.06])

  return { root, body, chest, head, headCore, muzzle, legs, ears, eyes, eyeHighlights, brows, whiskers, eyeBaseScaleY, tail, bowl, nameplate, decoration, rootBaseY, bodyBaseScale, headBase }
}

function dampNumber(current: number, target: number, lambda: number, delta: number) {
  return THREE.MathUtils.damp(current, target, lambda, delta)
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number) {
  current.x = dampNumber(current.x, target.x, lambda, delta)
  current.y = dampNumber(current.y, target.y, lambda, delta)
  current.z = dampNumber(current.z, target.z, lambda, delta)
}

function dampEuler(current: THREE.Euler, target: THREE.Euler, lambda: number, delta: number) {
  current.x = dampNumber(current.x, target.x, lambda, delta)
  current.y = dampNumber(current.y, target.y, lambda, delta)
  current.z = dampNumber(current.z, target.z, lambda, delta)
}

function animateRig(rig: PetRig, action: ActionId, elapsed: number, delta: number, speed: number, gesture: number, lookX: number, lookY: number) {
  const t = elapsed * speed
  const blinkWave = Math.sin(t * 0.7) > 0.965 || Math.sin(t * 1.11 + 1.8) > 0.982 ? 0.08 : 1
  const rootPosition = new THREE.Vector3(0, rig.rootBaseY, 0)
  const rootRotation = new THREE.Euler(0, -0.08, 0)
  const rootScale = new THREE.Vector3(1, 1, 1)
  const bodyScale = rig.bodyBaseScale.clone()
  const bodyRotation = new THREE.Euler(0, 0, 0)
  const headPosition = rig.headBase.clone()
  const headRotation = new THREE.Euler(lookY * 0.055, lookX * 0.1, 0)
  const tailRotation = new THREE.Euler(rig.tail.rotation.x, 0, 0)
  const bowlVisible = action === 'eat'

  if (action === 'idle') {
    rootPosition.y += Math.sin(t * 1.28) * 0.032 * gesture
    bodyScale.y += Math.sin(t * 1.8) * 0.02
    headRotation.y += Math.sin(t * 0.45) * 0.11 * gesture
    headRotation.z += Math.sin(t * 0.68) * 0.035 * gesture
    tailRotation.z = Math.sin(t * 1.24) * 0.36 * gesture
  } else if (action === 'walk') {
    const cadence = t * 7.2
    rootPosition.y += Math.abs(Math.sin(cadence)) * 0.075
    rootRotation.z = Math.sin(cadence) * 0.03
    rootRotation.x = Math.sin(cadence * 0.5) * 0.018
    bodyRotation.z = Math.sin(cadence) * 0.018
    headRotation.z += -Math.sin(cadence) * 0.035
    headRotation.y += Math.sin(cadence * 0.5) * 0.06
    tailRotation.z = Math.sin(t * 3.6) * 0.48 * gesture
  } else if (action === 'eat') {
    const nibble = Math.sin(t * 5.4)
    headPosition.set(0, 1.03 + nibble * 0.022, 0.98)
    headRotation.x = 0.74 + nibble * 0.025
    headRotation.y = lookX * 0.02
    bodyRotation.x = -0.07
    bodyScale.z += 0.025
    tailRotation.z = Math.sin(t * 1.7) * 0.14
  } else if (action === 'pet') {
    const happy = Math.sin(t * 5.6)
    const bounce = Math.abs(happy)
    rootPosition.y += 0.025 + bounce * 0.052
    rootScale.set(1.025 + happy * 0.012, 0.985 - happy * 0.01, 1.025)
    headPosition.y -= 0.04
    headRotation.z += happy * 0.105 * gesture
    headRotation.x -= 0.08
    tailRotation.z = Math.sin(t * 8.2) * 0.62 * gesture
  }

  rig.bowl.visible = bowlVisible
  dampVector(rig.root.position, rootPosition, 9, delta)
  dampEuler(rig.root.rotation, rootRotation, 9, delta)
  dampVector(rig.root.scale, rootScale, 9, delta)
  dampVector(rig.body.scale, bodyScale, 8, delta)
  dampEuler(rig.body.rotation, bodyRotation, 8, delta)
  dampVector(rig.head.position, headPosition, action === 'eat' ? 11 : 8, delta)
  dampEuler(rig.head.rotation, headRotation, action === 'eat' ? 12 : 8, delta)
  dampEuler(rig.tail.rotation, tailRotation, 7, delta)

  rig.legs.forEach((leg, index) => {
    const frontBackOffset = leg.front > 0 ? 0 : Math.PI
    const diagonalOffset = index === 0 || index === 3 ? 0 : Math.PI
    const phase = t * 7.2 + diagonalOffset
    const lift = Math.max(0, Math.sin(phase)) * 0.14
    const swing = Math.sin(phase) * 0.5 * gesture
    const targetRoot = leg.base.clone()
    const upperRot = new THREE.Euler(0, 0, 0)
    const lowerRot = new THREE.Euler(0, 0, 0)
    const pawRot = new THREE.Euler(0, 0, 0)

    if (action === 'walk') {
      targetRoot.y += lift
      targetRoot.z += Math.cos(phase) * 0.05
      upperRot.x = swing
      lowerRot.x = -swing * 0.45 + lift * 1.8
      pawRot.x = -lift * 1.2
    } else if (action === 'eat') {
      if (leg.front > 0) {
        upperRot.x = -0.22
        lowerRot.x = 0.22
        targetRoot.z += 0.05
      } else {
        upperRot.x = 0.12
      }
    } else if (action === 'pet') {
      targetRoot.y += Math.abs(Math.sin(t * 5.6 + frontBackOffset)) * 0.025
      upperRot.x = Math.sin(t * 5.6 + frontBackOffset) * 0.1
    }

    dampVector(leg.root.position, targetRoot, 12, delta)
    dampEuler(leg.upper.rotation, upperRot, 12, delta)
    dampEuler(leg.lower.rotation, lowerRot, 12, delta)
    dampEuler(leg.paw.rotation, pawRot, 12, delta)
  })

  rig.ears.forEach((ear, index) => {
    const side = index === 0 ? -1 : 1
    const twitch = Math.sin(t * (index === 0 ? 0.86 : 1.03)) * 0.045 * gesture
    const target = new THREE.Euler(0, 0, twitch * side)
    if (action === 'pet') target.z += side * -0.1
    if (action === 'walk') target.x = Math.sin(t * 7.2 + index) * 0.035
    dampEuler(ear.rotation, target, 8, delta)
  })

  rig.decoration.rotation.z = dampNumber(rig.decoration.rotation.z, action === 'walk' ? Math.sin(t * 7.2) * 0.035 : Math.sin(t * 0.8) * 0.012, 8, delta)
  rig.nameplate.rotation.z = dampNumber(rig.nameplate.rotation.z, action === 'walk' ? -Math.sin(t * 7.2) * 0.04 : Math.sin(t * 1.2) * 0.015, 7, delta)

  const lookStrength = action === 'eat' || action === 'pet' ? 0.18 : 1
  rig.eyes.forEach((eye, index) => {
    const side = index === 0 ? -1 : 1
    const eyeTarget = new THREE.Vector3(
      side * 0.29 + lookX * 0.045 * lookStrength,
      0.15 + lookY * 0.055 * lookStrength,
      0.68
    )
    dampVector(eye.position, eyeTarget, 20, delta)
    eye.scale.y = dampNumber(eye.scale.y, rig.eyeBaseScaleY * (action === 'eat' || action === 'pet' ? 0.18 : blinkWave), 20, delta)
    const highlight = rig.eyeHighlights[index]
    dampVector(highlight.position, new THREE.Vector3(side * 0.255 + lookX * 0.045 * lookStrength, 0.2 + lookY * 0.055 * lookStrength, 0.76), 20, delta)
    highlight.visible = eye.scale.y > rig.eyeBaseScaleY * 0.22
  })
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
    camera.position.set(0, 1.08, 7.3)
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7789ad, 2.6))
    const key = new THREE.DirectionalLight(0xffffff, 4.4)
    key.position.set(-3.5, 6, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xd7f0ff, 1.35)
    fill.position.set(2.8, 3.2, 3.4)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 2.3)
    rim.position.set(4.2, 2.8, -2.4)
    scene.add(rim)

    const rig = createPet(species, mbti, accent)
    scene.add(rig.root)
    const behavior = getMbtiBehavior(mbti)
    const clock = new THREE.Clock()
    const targetLook = new THREE.Vector2()
    const currentLook = new THREE.Vector2()

    let cursorPollInFlight = false
    const mipet = getMipetBridge()
    const updateGlobalLookTarget = async () => {
      if (cursorPollInFlight) return
      cursorPollInFlight = true
      try {
        const point = await mipet.getCursorPosition()
        const bounds = visibleCanvas.getBoundingClientRect()
        const centerX = window.screenX + bounds.left + bounds.width / 2
        const centerY = window.screenY + bounds.top + bounds.height * 0.42
        targetLook.set(
          THREE.MathUtils.clamp((point.x - centerX) / Math.max(1, bounds.width * 1.8), -1, 1),
          THREE.MathUtils.clamp((centerY - point.y) / Math.max(1, bounds.height * 1.8), -1, 1)
        )
      } finally {
        cursorPollInFlight = false
      }
    }
    void updateGlobalLookTarget()
    const cursorTimer = window.setInterval(() => void updateGlobalLookTarget(), 50)

    const updateLocalLookTarget = (event: PointerEvent) => {
      const bounds = visibleCanvas.getBoundingClientRect()
      const centerX = bounds.left + bounds.width / 2
      const centerY = bounds.top + bounds.height * 0.42
      targetLook.set(
        THREE.MathUtils.clamp((event.clientX - centerX) / Math.max(1, bounds.width * 1.8), -1, 1),
        THREE.MathUtils.clamp((centerY - event.clientY) / Math.max(1, bounds.height * 1.8), -1, 1)
      )
    }
    window.addEventListener('pointermove', updateLocalLookTarget)

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

    let rafId = 0
    const renderFrame = () => {
      const delta = Math.min(clock.getDelta(), 0.05)
      currentLook.lerp(targetLook, 0.14)
      animateRig(
        rig,
        actionRef.current,
        clock.elapsedTime,
        delta,
        behavior.animationSpeed,
        behavior.gestureScale,
        currentLook.x,
        currentLook.y
      )
      renderer.render(scene, camera)
      visibleContext.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height)
      visibleContext.drawImage(renderer.domElement, 0, 0, visibleCanvas.width, visibleCanvas.height)
      rafId = window.requestAnimationFrame(renderFrame)
    }
    renderFrame()

    return () => {
      observer.disconnect()
      window.clearInterval(cursorTimer)
      window.removeEventListener('pointermove', updateLocalLookTarget)
      window.cancelAnimationFrame(rafId)
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(item => {
            const maybeMapped = item as THREE.Material & { map?: THREE.Texture | null }
            maybeMapped.map?.dispose()
            item.dispose()
          })
        }
      })
      renderer.dispose()
    }
  }, [species, mbti, accent])

  return <canvas ref={canvasRef} className="pet-3d-canvas" aria-label={`${mbti} ${species === 'cat' ? '三维猫咪' : '三维狗狗'}`} />
}
