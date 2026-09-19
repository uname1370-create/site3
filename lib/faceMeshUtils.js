// lib/faceMeshUtils.js
// Canonical MediaPipe Face Mesh 468 landmarks indexing
// Separated semantic groups for PMU services

export const LANDMARKS = {
  // Eyebrow — mapped to UV islands; sorted head->tail for vector strokes
  brows: {
    leftTop: [70, 63, 105, 66, 107],
    leftBottom: [55, 65, 52, 53, 46],
    rightTop: [285, 295, 282, 283, 276],
    rightBottom: [300, 293, 334, 296, 336],
  },
  // Lips — outer contour + inner mouth (stencil)
  lips: {
    outer: [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],
    inner: [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95],
  },
  // Eyes — upper lash line
  eyes: {
    leftUpper: [33, 246, 161, 160, 159, 158, 157, 173],
    rightUpper: [263, 466, 388, 387, 386, 385, 384, 398],
    leftLower: [33, 144, 145, 153, 154, 155, 133],
    rightLower: [263, 373, 374, 380, 381, 382, 362],
  }
}

// Viewport crops normalized 0..1 — used for cinematic camera
export function computeFaceCrop(landmarks) {
  if (!landmarks) return null
  let minX=1, maxX=0, minY=1, maxY=0
  landmarks.forEach(p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y })
  const padX=(maxX-minX)*0.28, padTop=(maxY-minY)*0.38, padBottom=(maxY-minY)*0.22
  let x0=Math.max(0,minX-padX), y0=Math.max(0,minY-padTop), x1=Math.min(1,maxX+padX), y1=Math.min(1,maxY+padBottom)
  const cw=x1-x0, ch=y1-y0, zoom=0.88, cx=(x0+x1)/2, cy=(y0+y1)/2
  const nw=cw*zoom, nh=ch*zoom
  return { x: cx-nw/2, y: cy-nh/2, w: nw, h: nh }
}

export function computeServiceView(service, landmarks, baseCrop) {
  if (!landmarks) return baseCrop || computeFaceCrop(landmarks)
  let idx=[]
  if (service==='brows') idx=[...LANDMARKS.brows.leftTop,...LANDMARKS.brows.leftBottom,...LANDMARKS.brows.rightTop,...LANDMARKS.brows.rightBottom,33,133,263,362]
  else if (service==='eyeliner') idx=[...LANDMARKS.eyes.leftUpper,...LANDMARKS.eyes.rightUpper,...LANDMARKS.eyes.leftLower,...LANDMARKS.eyes.rightLower]
  else if (service==='lips') idx=[...LANDMARKS.lips.outer,...LANDMARKS.lips.inner]
  else return computeFaceCrop(landmarks)

  let minX=1,maxX=0,minY=1,maxY=0
  idx.forEach(i=>{ const p=landmarks[i]; if(!p) return; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y })
  let padX, padTop, padBottom, zoom
  if (service==='brows'){ padX=(maxX-minX)*0.44; padTop=(maxY-minY)*0.90; padBottom=(maxY-minY)*0.26; zoom=0.78 }
  else if (service==='eyeliner'){ padX=(maxX-minX)*0.40; padTop=(maxY-minY)*0.55; padBottom=(maxY-minY)*0.20; zoom=0.74 }
  else { padX=(maxX-minX)*0.58; padTop=(maxY-minY)*0.72; padBottom=(maxY-minY)*0.48; zoom=0.82 } // lips
  let x0=Math.max(0,minX-padX), y0=Math.max(0,minY-padTop), x1=Math.min(1,maxX+padX), y1=Math.min(1,maxY+padBottom)
  // clamp inside base for stability
  if (baseCrop){ x0=Math.max(baseCrop.x-0.02,x0); y0=Math.max(baseCrop.y-0.02,y0); x1=Math.min(baseCrop.x+baseCrop.w+0.02,x1); y1=Math.min(baseCrop.y+baseCrop.h+0.02,y1) }
  const cw=x1-x0, ch=y1-y0, cx=(x0+x1)/2, cy=(y0+y1)/2
  const nw=cw*zoom, nh=ch*zoom
  return { x: cx-nw/2, y: cy-nh/2, w: nw, h: nh }
}

export const BROW_STYLES = [
  { id:'natural', name:'طبیعی و نرم', en:'Natural Soft', color:'#5C4033', accent:'#8B6A4F', shape:'soft' },
  { id:'microblade', name:'میکروبلیدینگ', en:'Microblade', color:'#3E2723', accent:'#6D4C41', shape:'microblade' },
  { id:'ombre', name:'سایه پودری', en:'Ombre Powder', color:'#4E342E', accent:'#A0715A', shape:'ombre' },
  { id:'feather', name:'هاشور کرکی', en:'Feather', color:'#5D4037', accent:'#8D6E63', shape:'feather' },
  { id:'bold', name:'بولد و کشیده', en:'Bold Arch', color:'#3E2723', accent:'#5D4037', shape:'bold' },
  { id:'soft-arch', name:'قوس ملایم', en:'Soft Arch', color:'#4B2E2A', accent:'#7B5E57', shape:'soft-arch' }
]
export const LIP_STYLES = [
  { id:'nude-rose', name:'نود رز', en:'Nude Rose', color:'#C99A9A', accent:'#B76E79', outline:'#A85A66' },
  { id:'cherry', name:'چری', en:'Cherry', color:'#B85A5A', accent:'#A63A3A', outline:'#8E2E2E' },
  { id:'brick', name:'آجری مخملی', en:'Brick Velvet', color:'#B06A55', accent:'#8F3F2E', outline:'#7A3426' },
  { id:'mauve', name:'موو سرد', en:'Mauve', color:'#B08A8F', accent:'#9A6A71', outline:'#7F565D' },
  { id:'peach', name:'هلویی', en:'Peach', color:'#D4A090', accent:'#C48A7A', outline:'#B86E5E' },
  { id:'berry', name:'بری تیره', en:'Berry', color:'#8B3A4A', accent:'#6B2A36', outline:'#5A2230' }
]
export const LINER_STYLES = [
  { id:'natural', name:'بن‌مژه', en:'Lash Line', color:'#1A1A1A', wing:0, thickness:1 },
  { id:'classic', name:'کلاسیک', en:'Classic', color:'#111111', wing:0.4, thickness:1.2 },
  { id:'cat', name:'گربه‌ای', en:'Cat Eye', color:'#0F0F0F', wing:0.85, thickness:1.3 },
  { id:'smoky', name:'اسموکی', en:'Smoky', color:'#2B2B2B', wing:0.45, thickness:1.6 },
  { id:'winged', name:'بال‌دار', en:'Winged', color:'#000000', wing:1.1, thickness:1.35 },
  { id:'soft-wing', name:'بال نرم', en:'Soft Wing', color:'#1E1E1E', wing:0.65, thickness:1.1 }
]

export function hexToRgba(hex,a){ let c=hex.replace('#',''); if(c.length===3)c=c.split('').map(x=>x+x).join(''); const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16); return `rgba(${r},${g},${b},${a})`}
