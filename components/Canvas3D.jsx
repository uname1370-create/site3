"use client"
import { useEffect, useRef, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LANDMARKS, hexToRgba } from '@/lib/faceMeshUtils'
import CameraControls from './CameraControls'

/**
 * Canvas3D — Production WebGL + MediaPipe 468 Face Mesh
 * - Orthographic canonical face plane (2 units) + image texture
 * - PMU overlays as shader meshes mapped via landmark UVs
 * - PBR soft-light + procedural pigment + teeth stencil
 * - 60fps, DPR-aware, mobile touch, preserveDrawingBuffer for pixel-perfect BA
 */

// ---------- helpers ----------
function useFaceLandmarker() {
  const [landmarker, setLandmarker] = useState(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm')
        const fm = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5
        })
        if (!cancelled) { setLandmarker(fm); setReady(true) }
      } catch (e) {
        console.warn('[PMU] MediaPipe GPU fail, fallback CPU', e)
        try {
          const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
          const fileset2 = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm')
          const fm2 = await FaceLandmarker.createFromOptions(fileset2, {
            baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
            runningMode: 'IMAGE', numFaces: 1
          })
          if (!cancelled) { setLandmarker(fm2); setReady(true) }
        } catch (e2) { console.error('[PMU] FaceLandmarker failed', e2) }
      }
    }
    init()
    return () => { cancelled = true }
  }, [])
  return { landmarker, ready }
}

function useImageTexture(src) {
  const [tex, setTex] = useState(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  useEffect(() => {
    if (!src) { setTex(null); return }
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    let cancelled = false
    loader.load(src, (t) => {
      if (cancelled) return
      t.colorSpace = THREE.SRGBColorSpace
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.anisotropy = 4
      setTex(t)
      const img = t.image
      if (img) setSize({ w: img.width || img.naturalWidth || 800, h: img.height || img.naturalHeight || 1000 })
    }, undefined, () => setTex(null))
    return () => { cancelled = true }
  }, [src])
  return { texture: tex, size }
}

// Convert normalized landmark to plane local coords (-1..1)
// Plane is 2x2 centered at 0,0; UV 0..1 maps to -1..1; y flipped
function landmarkToLocal(p, viewCrop) {
  // viewCrop is used for camera, not UV — for overlay we map via UV then let camera handle zoom
  // So local = (p.x - 0.5)*2, -(p.y-0.5)*2
  // This keeps overlay locked to face regardless of camera
  return new THREE.Vector2((p.x - 0.5) * 2, -(p.y - 0.5) * 2)
}

// ---------- Pigment procedural ----------
function usePigmentTexture() {
  return useMemo(() => {
    if (typeof document === 'undefined') return null
    const s = 128
    const c = document.createElement('canvas'); c.width = s; c.height = s
    const x = c.getContext('2d')
    x.clearRect(0,0,s,s)
    for (let i=0;i<220;i++){ const px=Math.random()*s, py=Math.random()*s, r=Math.random()*0.7+0.2, a=Math.random()*0.16+0.04; x.fillStyle=`rgba(48,26,18,${a})`; x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill() }
    for (let i=0;i<70;i++){ const px=Math.random()*s, py=Math.random()*s, r=Math.random()*0.5+0.2; x.fillStyle=`rgba(255,235,225,${Math.random()*0.06+0.02})`; x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill() }
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(4,4)
    return tex
  }, [])
}

// ---------- Face Plane ----------
function FacePlane({ texture, size }) {
  const { viewport } = useThree()
  // keep aspect: plane scale to cover viewport while preserving image aspect
  const aspect = size.w / size.h
  const vpAspect = viewport.width / viewport.height
  const scaleX = aspect > vpAspect ? viewport.width : viewport.height * aspect
  const scaleY = aspect > vpAspect ? viewport.width / aspect : viewport.height
  return (
    <mesh scale={[scaleX, scaleY, 1]}>
      <planeGeometry args={[2, 2, 1, 1]} />
      {texture ? <meshBasicMaterial map={texture} toneMapped={false} /> : <meshBasicMaterial color="#FDFCFB" />}
    </mesh>
  )
}

// ---------- Brows — vector alpha strokes + ombre ----------
// Extracted top-level to satisfy Rules of Hooks
function BrowShape({ top, bottom, isRight, style, alpha, pigmentTex }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    if (top.length===0) return s
    s.moveTo(top[0].x, top[0].y)
    for (let i=1;i<top.length;i++){ const p0=top[i-1], p1=top[i]; const mx=(p0.x+p1.x)/2, my=(p0.y+p1.y)/2; s.quadraticCurveTo(p0.x, p0.y, mx, my) }
    s.lineTo(top[top.length-1].x, top[top.length-1].y)
    const rev = [...bottom].reverse()
    s.lineTo(rev[0].x, rev[0].y)
    for (let i=1;i<rev.length;i++){ const p0=rev[i-1], p1=rev[i]; const mx=(p0.x+p1.x)/2, my=(p0.y+p1.y)/2; s.quadraticCurveTo(p0.x, p0.y, mx, my) }
    s.closePath()
    return s
  }, [top,bottom])

  const strokes = useMemo(() => {
    const segs = []
    const total = 14
    for (let i=0;i<total;i++){
      const t=i/(total-1)
      const idxF=t*(top.length-1), low=Math.floor(idxF), high=Math.ceil(idxF), f=idxF-low
      const a=top[low], b=top[Math.min(high, top.length-1)]
      const bx=a.x*(1-f)+b.x*f, by=a.y*(1-f)+b.y*f
      let angle = t<0.22 ? 72 - t*85 : t<0.68 ? 42 - (t-0.22)*38 : 24 - (t-0.68)*38
      const rad = angle*Math.PI/180 * (isRight?1:-1)
      let lenF = t<0.18 ? 0.52+t*1.8 : t<0.62 ? 0.85+Math.sin((t-0.18)/0.44*Math.PI)*0.32 : 0.95-(t-0.62)*1.15
      lenF=Math.max(0.38,lenF)
      const len=0.045*lenF
      const ex=bx+Math.cos(rad)*len, ey=by+Math.sin(rad)*len*0.6
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(bx,by,0.01), new THREE.Vector3((bx+ex)/2, (by+ey)/2+0.006,0.01), new THREE.Vector3(ex,ey,0.01)])
      segs.push(curve)
    }
    return segs
  }, [top,isRight])

  return (
    <group>
      <mesh position={[0,0,0.005]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={style.color} transparent opacity={alpha*0.14} depthWrite={false} />
      </mesh>
      <mesh position={[0,0,0.01]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={style.color} transparent opacity={alpha*0.42} depthWrite={false} blending={THREE.CustomBlending} blendSrc={THREE.SrcAlphaFactor} blendDst={THREE.OneMinusSrcAlphaFactor} />
      </mesh>
      {pigmentTex && (
        <mesh position={[0,0,0.012]}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial map={pigmentTex} transparent opacity={0.14} depthWrite={false} blending={THREE.MultiplyBlending} />
        </mesh>
      )}
      {strokes.map((c,i)=>(
        <mesh key={i} position={[0,0,0.015]}>
          <tubeGeometry args={[c, 8, 0.003, 4, false]} />
          <meshBasicMaterial color={style.color} transparent opacity={alpha*0.22} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function BrowMesh({ landmarks, style, intensity, pigmentTex }) {
  const points = useMemo(() => {
    if (!landmarks) return null
    const toLocal = (i) => landmarkToLocal(landmarks[i])
    const leftTop = LANDMARKS.brows.leftTop.map(toLocal)
    const leftBottom = LANDMARKS.brows.leftBottom.map(toLocal)
    const rightTop = LANDMARKS.brows.rightTop.map(toLocal)
    const rightBottom = LANDMARKS.brows.rightBottom.map(toLocal)
    const sortHeadTail = (arr, isRight) => [...arr].sort((a,b)=> isRight ? a.x - b.x : b.x - a.x)
    return {
      left: { top: sortHeadTail(leftTop,false), bottom: sortHeadTail(leftBottom,false) },
      right: { top: sortHeadTail(rightTop,true), bottom: sortHeadTail(rightBottom,true) }
    }
  }, [landmarks])

  if (!points) return null
  const alpha = Math.min(0.48, Math.max(0.30, 0.28 + intensity * 0.22))
  return (
    <group>
      <BrowShape top={points.left.top} bottom={points.left.bottom} isRight={false} style={style} alpha={alpha} pigmentTex={pigmentTex} />
      <BrowShape top={points.right.top} bottom={points.right.bottom} isRight={true} style={style} alpha={alpha} pigmentTex={pigmentTex} />
    </group>
  )
}

// ---------- Lips — PBR soft-light + teeth stencil (hole) ----------
function LipMesh({ landmarks, style, intensity, pigmentTex }) {
  const shape = useMemo(() => {
    if (!landmarks) return null
    const toLocal = (i) => landmarkToLocal(landmarks[i])
    const outerPts = LANDMARKS.lips.outer.map(toLocal)
    const innerPts = LANDMARKS.lips.inner.map(toLocal)
    const s = new THREE.Shape()
    s.moveTo(outerPts[0].x, outerPts[0].y)
    for(let i=1;i<outerPts.length;i++){ const p0=outerPts[i-1], p1=outerPts[i]; const mx=(p0.x+p1.x)/2, my=(p0.y+p1.y)/2; s.quadraticCurveTo(p0.x,p0.y,mx,my) }
    s.closePath()
    const hole = new THREE.Path()
    hole.moveTo(innerPts[0].x, innerPts[0].y)
    for(let i=1;i<innerPts.length;i++){ const p0=innerPts[i-1], p1=innerPts[i]; const mx=(p0.x+p1.x)/2, my=(p0.y+p1.y)/2; hole.quadraticCurveTo(p0.x,p0.y,mx,my) }
    hole.closePath()
    s.holes.push(hole)
    return s
  }, [landmarks])

  const alpha = Math.min(0.50, Math.max(0.30, 0.30 + intensity * 0.20))

  // Custom soft-light shader — satin healed look, bump via noise
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(style.color) },
      uAlpha: { value: alpha },
      uPigment: { value: pigmentTex },
      uTime: { value: 0 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; uniform sampler2D uPigment; varying vec2 vUv;
      // soft-light blend
      vec3 softLight(vec3 base, vec3 blend){ return mix( 2.0*base*blend + base*base*(1.0-2.0*blend), sqrt(base)*(2.0*blend-1.0)+2.0*base*(1.0-blend), step(0.5, blend) ); }
      void main(){
        vec3 base = uColor;
        // pigment noise
        vec3 noise = texture2D(uPigment, vUv*6.0).rgb;
        float n = (noise.r+noise.g+noise.b)/3.0;
        base = mix(base, base*0.96 + vec3(0.04,0.02,0.02)*n, 0.12);
        // vertical gradient lips — darker outline, natural center
        float gy = smoothstep(0.0,1.0, vUv.y);
        base = mix(base*0.94, base*1.02, 0.5+0.5*sin(gy*3.14));
        // soft-light over skin — simulate healed matte
        vec3 skin = vec3(0.96,0.90,0.88);
        vec3 blended = softLight(skin, base);
        float feather = smoothstep(0.0,0.08, vUv.x) * smoothstep(1.0,0.92, vUv.x) * smoothstep(0.0,0.08, vUv.y) * smoothstep(1.0,0.92, vUv.y);
        gl_FragColor = vec4(blended, uAlpha * feather);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending
  }), [style.color, alpha, pigmentTex])

  if (!shape) return null

  // fallback for non-shader: simple
  return (
    <group>
      <mesh position={[0,0,0.02]}>
        <shapeGeometry args={[shape]} />
        <primitive object={material} attach="material" />
      </mesh>
      {/* multiply depth second pass */}
      <mesh position={[0,0,0.021]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={style.color} transparent opacity={alpha*0.18} blending={THREE.MultiplyBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ---------- Eyeliner — lash-line enhancement ----------
function EyelinerMesh({ landmarks, style, intensity }) {
  const curves = useMemo(() => {
    if (!landmarks) return []
    const toLocal = (i)=> landmarkToLocal(landmarks[i])
    const left = LANDMARKS.eyes.leftUpper.map(toLocal)
    const right = LANDMARKS.eyes.rightUpper.map(toLocal)
    const mk = (pts) => {
      const pts3 = pts.map(p=> new THREE.Vector3(p.x, p.y, 0))
      return new THREE.CatmullRomCurve3(pts3)
    }
    return [mk(left), mk(right)]
  }, [landmarks])

  if (curves.length===0) return null
  const alpha = style.wing===0 ? Math.min(0.42, Math.max(0.30,0.30+intensity*0.12)) : Math.min(0.50, Math.max(0.32,0.32+intensity*0.18))
  return (
    <group>
      {curves.map((c,i)=>(
        <group key={i}>
          <mesh position={[0,0,0.02]}>
            <tubeGeometry args={[c, 24, style.wing===0 ? 0.004 : 0.006, 6, false]} />
            <meshBasicMaterial color={style.color} transparent opacity={alpha} depthWrite={false} blending={THREE.MultiplyBlending} />
          </mesh>
          <mesh position={[0,0,0.021]}>
            <tubeGeometry args={[c, 24, style.wing===0 ? 0.006 : 0.009, 6, false]} />
            <meshBasicMaterial color={style.color} transparent opacity={alpha*0.22} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- Main ----------
export default function Canvas3D({ imageSrc, activeService, activeStyle, intensity = 0.42, viewCrop, baseCrop, onCapture, onFaceDetected, className='' }) {
  const { landmarker } = useFaceLandmarker()
  const { texture, size } = useImageTexture(imageSrc)
  const pigmentTex = usePigmentTexture()
  const [landmarks, setLandmarks] = useState(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const glRef = useRef()

  // detect when image or landmarker ready
  useEffect(() => {
    if (!landmarker || !imageSrc) { setLandmarks(null); setFaceDetected(false); return }
    // need offscreen image for detection
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      try {
        const result = landmarker.detect(img)
        if (result.faceLandmarks && result.faceLandmarks.length>0){
          setLandmarks(result.faceLandmarks[0])
          setFaceDetected(true)
          onFaceDetected?.(true, result.faceLandmarks[0])
        } else { setLandmarks(null); setFaceDetected(false); onFaceDetected?.(false,null) }
      } catch(e){ console.warn('[PMU] detect fail',e); setLandmarks(null); setFaceDetected(false) }
    }
    img.onerror = () => { setLandmarks(null); setFaceDetected(false) }
    img.src = imageSrc
  }, [landmarker, imageSrc, onFaceDetected])

  // capture for Before/After — preserveDrawingBuffer ensures pixel-perfect same zoom
  const handleCreated = ({ gl }) => {
    glRef.current = gl
    gl.setClearColor('#FDFCFB', 1)
  }
  useEffect(() => {
    if (!glRef.current || !texture) return
    // slight delay to allow render
    const id = setTimeout(() => {
      try {
        const url = glRef.current.domElement.toDataURL('image/jpeg', 0.92)
        onCapture?.(url)
      } catch {}
    }, 120)
    return () => clearTimeout(id)
  }, [texture, landmarks, activeService, activeStyle, intensity, viewCrop, onCapture])

  return (
    <div className={`relative rounded-[20px] overflow-hidden bg-[#FDFCFB] border hairline ${className}`} style={{ aspectRatio: '4 / 5' }}>
      <Canvas
        orthographic
        camera={{ position: [0,0,5], zoom: 1, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, Math.min(2.5, typeof window !== 'undefined' ? window.devicePixelRatio : 2)]}
        onCreated={handleCreated}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <CameraControls viewCrop={viewCrop} baseCrop={baseCrop} isActive={!!viewCrop} />
        <ambientLight intensity={1} />
        <FacePlane texture={texture} size={size} />
        {landmarks && activeService==='brows' && activeStyle && (
          <BrowMesh landmarks={landmarks} style={activeStyle} intensity={intensity} pigmentTex={pigmentTex} />
        )}
        {landmarks && activeService==='lips' && activeStyle && (
          <LipMesh landmarks={landmarks} style={activeStyle} intensity={intensity} pigmentTex={pigmentTex} />
        )}
        {landmarks && activeService==='eyeliner' && activeStyle && (
          <EyelinerMesh landmarks={landmarks} style={activeStyle} intensity={intensity} />
        )}
        {/* fallback if no landmarks — simple decal */}
        {!landmarks && activeStyle && activeService && (
          <FallbackMesh service={activeService} style={activeStyle} intensity={intensity} />
        )}
      </Canvas>

      {!imageSrc && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[4px] p-6 text-center pointer-events-none">
          <p className="text-[11.5px] font-extralight text-black/35">عکس‌ات رو انتخاب کن — ماکرو فقط روی فیس فوکوس می‌کند</p>
        </div>
      )}
      {imageSrc && !faceDetected && landmarks===null && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] px-3 py-1.5 rounded-full">
          چهره واضح نبود — نمای تقریبی فعال است
        </div>
      )}
      <div className="absolute top-3 right-3 bg-white/80 backdrop-blur text-[10px] tracking-wide px-2.5 py-1 rounded-full border hairline">
        {faceDetected ? '✓ 468 landmarks' : '… تحلیل'}
      </div>
    </div>
  )
}

function FallbackMesh({ service, style, intensity }){
  // ultra-minimal fallback for when MediaPipe not ready — centered decal
  const alpha = 0.38
  if (service==='brows'){
    return (
      <group>
        <mesh position={[-0.35,0.42,0.02]}><planeGeometry args={[0.42,0.08]} /><meshBasicMaterial color={style.color} transparent opacity={alpha} /></mesh>
        <mesh position={[0.35,0.42,0.02]}><planeGeometry args={[0.42,0.08]} /><meshBasicMaterial color={style.color} transparent opacity={alpha} /></mesh>
      </group>
    )
  }
  if (service==='lips'){
    return <mesh position={[0,-0.38,0.02]}><circleGeometry args={[0.18,32]} /><meshBasicMaterial color={style.color} transparent opacity={alpha} /></mesh>
  }
  return (
    <group>
      <mesh position={[-0.32,0.18,0.02]}><planeGeometry args={[0.28,0.012]} /><meshBasicMaterial color={style.color} transparent opacity={alpha} /></mesh>
      <mesh position={[0.32,0.18,0.02]}><planeGeometry args={[0.28,0.012]} /><meshBasicMaterial color={style.color} transparent opacity={alpha} /></mesh>
    </group>
  )
}
