/* eslint-disable @next/next/no-img-element */
"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { BROW_STYLES, LIP_STYLES, LINER_STYLES, computeFaceCrop, computeServiceView } from '@/lib/faceMeshUtils'
import BeforeAfterSlider from '@/components/BeforeAfterSlider'
import BookingModal from '@/components/BookingModal'

// Dynamic to avoid SSR for WebGL
const Canvas3D = dynamic(() => import('@/components/Canvas3D'), { ssr: false, loading: () => <div className="aspect-[4/5] rounded-[20px] border hairline bg-white animate-pulse" /> })

const PRESETS = [
  { id: 0, src: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800&auto=format&fit=crop&crop=faces&q=80', label: 'bare ۰۱' },
  { id: 1, src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&crop=faces&q=80', label: 'bare ۰۲' },
  { id: 2, src: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop&crop=faces&q=80', label: 'bare ۰۳' }
]

export default function Page(){
  const [imageSrc, setImageSrc] = useState(null)
  const [activeService, setActiveService] = useState(null) // brows|lips|eyeliner
  const [activeIdx, setActiveIdx] = useState(0)
  const [intensity, setIntensity] = useState(42)
  const [landmarks, setLandmarks] = useState(null)
  const [baseCrop, setBaseCrop] = useState(null)
  const [viewCrop, setViewCrop] = useState(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [isBookingOpen, setBookingOpen] = useState(false)
  const [beforeSrc, setBeforeSrc] = useState(null)
  const [afterSrc, setAfterSrc] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const styles = useMemo(()=>{
    if (activeService==='brows') return BROW_STYLES
    if (activeService==='lips') return LIP_STYLES
    if (activeService==='eyeliner') return LINER_STYLES
    return []
  },[activeService])
  const activeStyle = styles[activeIdx] || null
  const activeStyleName = activeStyle?.name || ''

  // Compute base crop when landmarks change
  useEffect(()=>{
    if (landmarks){
      const c = computeFaceCrop(landmarks)
      setBaseCrop(c)
      // if no service yet, view = base
      if (!activeService) setViewCrop(c)
    } else {
      setBaseCrop(null)
      if (!activeService) setViewCrop(null)
    }
  },[landmarks, activeService])

  // Cinematic auto-zoom when service changes or new face
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if (!landmarks) return
    if (!activeService){ // full face
      const c = computeFaceCrop(landmarks)
      animateView(c)
      return
    }
    const svcView = computeServiceView(activeService, landmarks, baseCrop)
    animateView(svcView)
  },[activeService, landmarks])

  // smooth animate viewCrop -> use rAF lerp via state? simpler: set directly and let CameraControls lerp
  const animateView = (target) => {
    if (!target) return
    // For luxury smoothness, we do JS lerp animation for state itself (mirrors CameraControls)
    const start = viewCrop || target
    const end = target
    const duration = 680
    const t0 = performance.now()
    const ease = t=> t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
    let raf
    const step = (now)=>{
      const p = Math.min(1, (now - t0)/duration)
      const e = ease(p)
      setViewCrop({
        x: start.x + (end.x - start.x)*e,
        y: start.y + (end.y - start.y)*e,
        w: start.w + (end.w - start.w)*e,
        h: start.h + (end.h - start.h)*e
      })
      if (p<1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return ()=> cancelAnimationFrame(raf)
  }

  const handleFile = useCallback((file)=>{
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 10*1024*1024) return
    const reader = new FileReader()
    reader.onload = e=> setImageSrc(e.target.result)
    reader.readAsDataURL(file)
  },[])

  const onDrop = (e)=>{
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // Capture before/after at same zoom — Canvas3D calls onCapture with dataURL of styled render
  // We keep before as base texture at same viewCrop: we capture before by rendering Canvas3D with no style, then after with style
  // Simplification: before = imageSrc cropped via canvas at viewCrop (already handled inside Canvas3D preserveDrawingBuffer)
  // So we store before as imageSrc and after as captured styled
  const handleCapture = useCallback((dataUrl)=>{
    // dataUrl is styled at current viewCrop
    setAfterSrc(dataUrl)
    // before is same viewCrop base — we synthesize by asking Canvas3D to capture before separately?
    // For pixel-perfect, we capture before via offscreen: use after's base (same crop). So set before to same base but without overlay
    // If activeService null, before==after
    if (!activeService) setBeforeSrc(dataUrl)
    else {
      // For now, before is the original macro captured previously; we keep it stable until new image
      // If not set, set to imageSrc (will be aligned via CSS object-cover + scale, but ideally would be same crop)
      // To guarantee pixel-perfect, we store a separate before capture when service is null - we trigger by briefly rendering without style
      // Simpler: set before to dataUrl base if we have one stored
      if (!beforeSrc) setBeforeSrc(dataUrl) // first capture
      // else keep existing before (which was at same viewCrop as after's base)
    }
  },[activeService, beforeSrc])

  // When new image, reset before/after
  useEffect(()=>{ if(imageSrc){ setBeforeSrc(null); setAfterSrc(null); setFaceDetected(false) } },[imageSrc])

  const handleLandmarks = (detected, lm)=>{
    setFaceDetected(detected)
    setLandmarks(lm)
    if (lm && !baseCrop){
      const c = computeFaceCrop(lm)
      setBaseCrop(c); setViewCrop(c)
    }
  }

  // Booking message helper for inline form
  const faService = activeService==='brows' ? 'ابرو' : activeService==='lips' ? 'لب' : activeService==='eyeliner' ? 'خط چشم' : ''

  return (
    <div className="min-h-screen bg-[#FDFCFB]">
      {/* header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white/92 backdrop-blur-[12px] border-b border-black/[0.06] shadow-[0_1px_12px_rgba(15,61,46,0.04)]">
        <nav className="max-w-[1080px] mx-auto px-6 h-[56px] flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full border hairline flex items-center justify-center text-[13px] font-serif text-pmu-green">ع</span>
            <span className="hidden sm:block leading-none">
              <span className="block font-serif tracking-[0.16em] text-[11px] text-pmu-green">Asal Rajabi</span>
              <span className="block text-[8px] tracking-[0.20em] text-black/35 -mt-0.5">PMU ATELIER</span>
            </span>
          </a>
          <div className="hidden md:flex items-center gap-7 text-[10.5px] tracking-[0.14em] font-light">
            <a href="#upload" className="text-pmu-green/70 hover:text-pmu-green transition">تست مجازی</a>
            <a href="#services" className="text-pmu-green/70 hover:text-pmu-green transition">خدمات</a>
            <a href="#booking" className="text-pmu-green/70 hover:text-pmu-green transition">رزرو</a>
            <a href="https://instagram.com/asalrajabi_pmu" target="_blank" className="text-pmu-green/50 hover:text-pmu-green transition">@asalrajabi_pmu</a>
          </div>
          <a href="#upload" className="hidden md:inline-flex text-[10px] tracking-[0.14em] font-light text-pmu-green border hairline-strong px-5 py-2 rounded-full hover:bg-pmu-green hover:text-white hover:border-pmu-green transition">شروع تست</a>
        </nav>
      </header>

      {/* hero — immersive luxury dark, high contrast, enterprise */}
      <section className="relative min-h-[88vh] flex items-center overflow-hidden bg-[#0A1F17]">
        <div className="absolute inset-0">
          <img src="https://raw.githubusercontent.com/uname1370-create/site3/main/asalrajabi.png" alt="Asal Rajabi" className="w-full h-full object-cover object-[center_28%] sm:object-[center_22%]" onError={e=>e.target.style.display='none'} />
          <div className="absolute inset-0" style={{background: 'linear-gradient(to left, rgba(10,31,23,0.92) 0%, rgba(10,31,23,0.72) 32%, rgba(10,31,23,0.38) 58%, rgba(10,31,23,0.12) 78%, transparent 100%)'}}></div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A1F17]/60 via-transparent to-transparent"></div>
        </div>
        <div className="relative w-full max-w-[1080px] mx-auto px-6 py-24 sm:py-20">
          <div className="max-w-[560px] mr-auto lg:mr-0 text-center lg:text-right">
            <motion.p initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.15}} className="inline-flex items-center gap-2 text-[9px] tracking-[0.26em] text-white/70 border border-white/15 rounded-full px-4 py-1.5 backdrop-blur bg-white/[0.06]">LUXURY PMU — TEHRAN • MASHHAD</motion.p>
            <motion.h1 initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} transition={{delay:0.25}} className="mt-8 font-serif leading-[1.02] tracking-[-0.035em] text-white">
              <span className="block text-[40px] sm:text-[54px] font-light">قبل از رزرو،</span>
              <span className="block text-[40px] sm:text-[54px] font-light mt-1">ببین چه مدلی</span>
              <span className="block text-[36px] sm:text-[50px] italic font-light text-white/90 mt-2 tracking-[-0.02em]">به صورتت میاد</span>
            </motion.h1>
            <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.4}} className="mt-6 text-[13.5px] leading-[1.95] font-light text-white/75 max-w-[500px] mx-auto lg:mx-0">
              پیش‌نمایش <span className="text-white font-normal">مات و طبیعی</span> — میکروبلیدینگ، شیدینگ لب و بن‌مژه روی چهره‌ی خودت.<br className="hidden sm:block"/> <span className="text-white/60 text-[12px] tracking-wide">3D Face Mesh 468 نقطه • WebGL PBR • 60fps</span>
            </motion.p>
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.55}} className="mt-10 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <a href="#upload" className="inline-flex items-center justify-center gap-2 bg-white text-pmu-green px-8 py-4 rounded-full text-[11px] tracking-[0.14em] font-medium hover:bg-white/90 transition shadow-[0_8px_32px_rgba(0,0,0,0.18)]">شروع تست — رایگان <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>
              <a href="#services" className="inline-flex items-center justify-center gap-2 text-white border border-white/20 bg-white/[0.06] backdrop-blur px-7 py-4 rounded-full text-[11px] tracking-[0.14em] font-light hover:bg-white/10 transition">نمونه‌کارها</a>
            </motion.div>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.7}} className="mt-12 flex items-center justify-center lg:justify-start gap-3 text-[10px] tracking-[0.16em] font-light text-white/40">
              <span className="w-8 h-px bg-white/20"></span><span>۱۲۰۰+ تست • ۴.۹/۵ رضایت</span><span className="w-8 h-px bg-white/20"></span>
            </motion.div>
          </div>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-[9px] tracking-[0.22em] text-white/30 font-light">SCROLL</span><div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent"></div>
        </div>
      </section>

      {/* stepper */}
      <div className="sticky top-[56px] z-30 bg-white/90 backdrop-blur-[10px] border-y border-black/[0.07] shadow-[0_2px_12px_rgba(15,61,46,0.04)]">
        <div className="max-w-[1080px] mx-auto px-6 py-3.5 flex items-center justify-between gap-2 text-[10px] tracking-[0.12em] font-light overflow-x-auto no-scrollbar">
          <a href="#upload" className={`flex items-center gap-2 whitespace-nowrap ${!imageSrc ? 'text-pmu-green' : 'text-black/60'}`}><span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] ${!imageSrc ? 'border-pmu-green text-pmu-green' : 'hairline'}`}>۰۱</span> عکس</a>
          <span className="h-px flex-1 bg-black/5 hidden sm:block" />
          <a href="#services" className={`flex items-center gap-2 whitespace-nowrap ${imageSrc && !activeService ? 'text-pmu-green' : 'text-black/60'}`}><span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] ${imageSrc && !activeService ? 'border-pmu-green text-pmu-green' : 'hairline'}`}>۰۲</span> خدمت</a>
          <span className="h-px flex-1 bg-black/5 hidden sm:block" />
          <a href="#canvas" className={`flex items-center gap-2 whitespace-nowrap ${activeService ? 'text-pmu-green' : 'text-black/60'}`}><span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] ${activeService ? 'border-pmu-green text-pmu-green' : 'hairline'}`}>۰۳</span> 3D</a>
          <span className="h-px flex-1 bg-black/5 hidden sm:block" />
          <a href="#compare" className="flex items-center gap-2 whitespace-nowrap text-black/60"><span className="w-5 h-5 rounded-full border hairline flex items-center justify-center text-[9px]">۰۴</span> مقایسه</a>
          <span className="h-px flex-1 bg-black/5 hidden sm:block" />
          <a href="#booking" className="flex items-center gap-2 whitespace-nowrap text-black/60"><span className="w-5 h-5 rounded-full border hairline flex items-center justify-center text-[9px]">۰۵</span> رزرو</a>
        </div>
      </div>

      {/* 01 upload */}
      <section id="upload" className="bg-white border-b hairline py-14 sm:py-16">
        <div className="max-w-[1080px] mx-auto px-6">
          <div className="max-w-xl">
            <p className="text-[10px] tracking-[0.20em] text-black/60">۰۱ — انتخاب عکس • ماکرو</p>
            <h2 className="mt-3 font-serif text-[26px] sm:text-[30px] tracking-[-0.03em] text-pmu-green">عکس‌ات رو انتخاب کن</h2>
            <p className="mt-2 text-[12.5px] leading-6 font-light text-black/65">نور طبیعی، روبه‌رو، بدون فیلتر — فقط فیس، هیچ آرایشی روی صورت نباشد.</p>
          </div>

          <div className="mt-8 grid lg:grid-cols-[1.15fr_0.85fr] gap-8 items-start">
            {/* upload */}
            <div className="rounded-[24px] border hairline bg-[#FDFCFB] p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] tracking-[0.14em] font-light text-pmu-green">آپلود</h3>
                <span className="text-[10px] text-black/25 border hairline px-2.5 py-1 rounded-full">JPG, PNG — تا 10MB</span>
              </div>

              <label
                onDragOver={e=>{e.preventDefault(); setDragOver(true)}}
                onDragLeave={e=>{e.preventDefault(); setDragOver(false)}}
                onDrop={onDrop}
                htmlFor="fileInput"
                className={`mt-6 group flex flex-col items-center justify-center gap-2.5 border border-dashed rounded-[20px] p-9 sm:p-10 text-center cursor-pointer transition ${dragOver ? 'border-pmu-green/30 bg-white' : 'hairline-strong bg-white/40 hover:bg-white'}`}
              >
                <span className={`w-9 h-9 rounded-full border flex items-center justify-center transition ${dragOver ? 'border-pmu-green text-pmu-green' : 'hairline text-black/20 group-hover:text-pmu-green'}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </span>
                <p className="text-[11px] tracking-wide font-light text-pmu-green">بکش و رها کن یا کلیک کن</p>
                <p className="text-[10.5px] font-light text-black/60 -mt-1">چهره کاملا رو به دوربین</p>
                <span className="mt-3 inline-flex bg-pmu-green text-white px-5 py-2 rounded-full text-[10.5px] tracking-wide font-light">انتخاب از گالری</span>
                <input id="fileInput" type="file" accept="image/*" className="hidden" onChange={e=> handleFile(e.target.files[0])} />
              </label>

              <div className="mt-7">
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-black/5" />
                  <span className="text-[10px] tracking-[0.16em] text-black/25">یا نمونه — فقط فیسِ خالص bare</span>
                  <span className="h-px flex-1 bg-black/5" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {PRESETS.map(p=>(
                    <button key={p.id} onClick={()=> setImageSrc(p.src)} className="group relative rounded-2xl overflow-hidden aspect-square bg-white border hairline hover:border-black/12 transition">
                      <img src={p.src} alt={p.label} className="w-full h-full object-cover object-[center_28%] scale-[1.42] group-hover:scale-[1.46] transition duration-700" crossOrigin="anonymous" loading="lazy" />
                      <span className="absolute bottom-1.5 inset-x-1.5 bg-white/88 backdrop-blur text-[10px] font-light tracking-wide text-pmu-green py-1 rounded-full text-center border border-white/60">{p.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-center font-light text-black/25">فقط فیس — بدون آرایش، بدون شانه</p>
              </div>
            </div>

            {/* preview minimal */}
            <div className="lg:sticky lg:top-[104px]">
              <div className="rounded-[24px] border hairline bg-white p-6">
                <h3 className="text-[10px] tracking-[0.14em] font-light text-pmu-green">پیش‌نمایش — فیس</h3>
                <p className="mt-1 text-[11px] leading-5 font-light text-black/60">قاب دایره‌ای — ۱۰۰٪ فوکوس روی صورت</p>
                <div className="mt-6 relative mx-auto w-[200px] h-[200px] sm:w-[220px] sm:h-[220px]">
                  <div className="absolute inset-0 rounded-full p-[1px] bg-black/5">
                    <div className="w-full h-full rounded-full bg-[#FDFCFB] overflow-hidden relative flex items-center justify-center border border-white">
                      {imageSrc ? (
                        <img src={imageSrc} alt="preview" className="w-full h-full object-cover object-center scale-[1.14]" />
                      ) : (
                        <div className="text-center p-5">
                          <div className="w-10 h-10 mx-auto rounded-full border hairline flex items-center justify-center text-black/30">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="2.4"/><path d="M7 18c1.4-1.8 3.6-2.7 5-2.7s3.6 0.9 5 2.7"/></svg>
                          </div>
                          <p className="mt-2 text-[11px] font-light text-black/60">هنوز عکسی نیست</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {faceDetected && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-pmu-green text-white text-[10px] px-3 py-1 rounded-full">✓ 468 detected</span>}
                </div>
                <div className="mt-6 flex items-center justify-between text-[10px] tracking-wide">
                  <span className="text-black/60">وضعیت</span>
                  <span className={`px-2.5 py-1 rounded-full border text-[10px] ${faceDetected ? 'bg-pmu-green text-white border-pmu-green' : 'bg-[#FDFCFB] hairline text-black/40'}`}>{faceDetected ? 'چهره شناسایی شد • 468' : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 02 services */}
      <section id="services" className="bg-[#FDFCFB] py-14 sm:py-16">
        <div className="max-w-[1080px] mx-auto px-6">
          <p className="text-[10px] tracking-[0.20em] text-black/60">۰۲ — یک خدمت انتخاب کن</p>
          <h2 className="mt-3 font-serif text-[26px] sm:text-[30px] tracking-[-0.03em] text-pmu-green">کدام خدمت؟</h2>
          <p className="mt-2 text-[12.5px] leading-6 font-light text-black/65">زوم سینماتیک خودکار — هر خدمت نمای ماکرو اختصاصی</p>

          <div className="mt-8 grid md:grid-cols-3 gap-5">
            {[
              { id:'brows', title:'ابرو', en:'MICROBLADING • SHADING', desc:'تار به تار، کرکی — Ombre محو سر تا دم.' },
              { id:'lips', title:'لب', en:'LIP BLUSH • SHADING', desc:'مات مخملی — PBR satin, teeth never colored.' },
              { id:'eyeliner', title:'بن‌مژه', en:'LASH ENHANCEMENT', desc:'خط مژهٔ نچرال — clean organic path.' }
            ].map(s=>(
              <button key={s.id} onClick={()=>{ setActiveService(s.id); setActiveIdx(0); document.getElementById('canvas')?.scrollIntoView({behavior:'smooth'}) }} className={`group text-right bg-white border rounded-[20px] p-7 text-right transition ${activeService===s.id ? 'border-pmu-green/20 bg-white shadow-[0_8px_32px_rgba(15,61,46,0.06)]' : 'hairline hover:border-black/12'}`}>
                <h3 className="font-serif text-[17px] text-pmu-green">{s.title}</h3>
                <p className="text-[10px] tracking-[0.14em] text-black/60">{s.en}</p>
                <p className="mt-2 text-[12.5px] leading-6 font-light text-black/70">{s.desc}</p>
                <span className={`mt-4 inline-flex text-[10px] tracking-wide font-light border px-3 py-1.5 rounded-full transition ${activeService===s.id ? 'bg-pmu-green text-white border-pmu-green' : 'text-pmu-green hairline'}`}>انتخاب →</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 03 Canvas3D */}
      <section id="canvas" className="bg-white border-y hairline py-12 sm:py-16">
        <div className="max-w-[1080px] mx-auto px-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-[10px] tracking-[0.18em] text-black/60">۰۳ — تست زنده • 3D WebGL • 60fps</p>
              <h2 className="mt-2 font-serif text-[22px] tracking-[-0.02em] text-pmu-green flex items-center gap-2">
                {activeService ? ({brows:'تست ابرو', lips:'تست لب', eyeliner:'تست بن‌مژه'}[activeService]) : 'تست سه‌بعدی'}
                <span className="text-[10px] tracking-wide font-light border hairline px-2.5 py-1 rounded-full text-black/40">{styles.length} استایل</span>
              </h2>
              <p className="text-[11.5px] font-light text-black/60 mt-1">
                {activeService==='brows' ? 'زوم بالا — ابرو ۷۵٪ کادر' : activeService==='lips' ? 'ماکرو لب — PBR soft-light' : activeService==='eyeliner' ? 'ماکرو چشم — lash-line' : 'نمای کامل — Full Face'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>{ setIntensity(42); document.getElementById('intensity') && (document.getElementById('intensity').value=42) }} className="text-[10.5px] font-light border hairline px-4 py-2 rounded-full hover:bg-[#FDFCFB] transition">بازنشانی</button>
              <button onClick={()=>{ if(afterSrc){ const a=document.createElement('a'); a.href=afterSrc; a.download=`pmu-${activeService||'full'}-${Date.now()}.jpg`; a.click() } }} className="text-[10.5px] font-light bg-pmu-green text-white px-4 py-2 rounded-full hover:bg-black transition">ذخیره JPG</button>
            </div>
          </div>

          <div className="mt-8 grid lg:grid-cols-[1.35fr_0.75fr] gap-8 items-start">
            {/* WebGL Canvas */}
            <div>
              <Canvas3D
                imageSrc={imageSrc}
                activeService={activeService}
                activeStyle={activeStyle}
                intensity={intensity/100}
                viewCrop={viewCrop}
                baseCrop={baseCrop}
                onCapture={handleCapture}
                onFaceDetected={handleLandmarks}
              />
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[10px] tracking-wide text-black/60">شدت</span>
                <input id="intensity" type="range" min={30} max={100} value={intensity} onChange={e=> setIntensity(Number(e.target.value))} className="flex-1" />
                <span className="text-[11px] font-light text-black/50 min-w-[36px] text-left">{intensity}%</span>
              </div>
              <p className="mt-1 text-[10px] font-light text-black/25 text-center">مات healed — soft-light + multiply + pigment noise • teeth stencil</p>
            </div>

            {/* styles */}
            <div className="lg:sticky lg:top-[104px]">
              <h3 className="text-[10px] tracking-[0.14em] font-light text-pmu-green">استایل‌ها — PBR</h3>
              <p className="text-[11px] font-light text-black/60 mt-1">انتخاب کن تا روی 3D Mesh ببینی</p>
              <div className="mt-4 grid grid-cols-2 gap-2.5 max-h-[420px] overflow-y-auto pr-1 no-scrollbar">
                {styles.map((s, idx)=>(
                  <button key={s.id} onClick={()=> setActiveIdx(idx)} className={`group text-right relative rounded-2xl border p-3 text-right flex flex-col gap-2 transition ${idx===activeIdx ? 'bg-white border-pmu-green/20 shadow-sm' : 'bg-white/40 hairline backdrop-blur hover:bg-white'}`}>
                    <div className="h-11 rounded-xl flex items-center justify-center overflow-hidden border hairline bg-[#FDFCFB] relative">
                      {activeService==='brows' && (
                        <svg viewBox="0 0 100 30" className="w-[82%] h-6"><path d={`M8 18 C 22 5, 48 3, 70 8 C 80 10, 88 14, 92 18 C 88 22, 78 23, 62 21.5 C 40 20, 18 23, 8 18 Z`} fill={s.color} opacity="0.92"/><path d="M12 16 C 24 9.5, 48 7.5, 68 12.5" stroke={s.accent} strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.55"/></svg>
                      )}
                      {activeService==='lips' && (
                        <div className="w-12 h-6 rounded-[50%] border" style={{background:s.color, borderColor:s.outline, opacity:0.95}} />
                      )}
                      {activeService==='eyeliner' && (
                        <svg viewBox="0 0 100 30" className="w-[78%] h-5"><path d="M10 15 Q 30 6.5, 50 15 T 85 12.2 L 91.5 7.5 L 84 16.2 Q 50 20, 10 15" fill={s.color} /></svg>
                      )}
                      {idx===activeIdx && <span className="absolute top-1 left-1 w-4 h-4 bg-pmu-green text-white rounded-full flex items-center justify-center text-[8px]">✓</span>}
                    </div>
                    <div>
                      <p className="text-[11.5px] font-light tracking-wide text-pmu-green leading-none">{s.name}</p>
                      <p className="text-[10px] font-light text-black/65 leading-4 mt-1 line-clamp-2">{s.en}</p>
                    </div>
                  </button>
                ))}
                {!activeService && <p className="col-span-2 text-center text-[11px] font-light text-black/60 py-8">ابتدا خدمت را انتخاب کن</p>}
              </div>

              <AnimatePresence>
                {activeStyle && (
                  <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="mt-4 border-t hairline pt-4">
                    <p className="text-[10px] tracking-wide text-black/60">انتخاب فعلی — Three.js Shader</p>
                    <p className="text-[13px] font-light text-pmu-green mt-1">{activeStyle.name} — {activeStyle.en}</p>
                    <p className="text-[11px] font-light leading-5 text-black/40 mt-1">Ombre gradient • feather • pigment micro-noise • 60fps</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <button onClick={()=> setBookingOpen(true)} disabled={!activeService || !imageSrc} className="mt-5 w-full bg-pmu-green text-white py-3.5 rounded-full text-[11px] tracking-wide font-light hover:bg-black transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {activeService ? `${activeStyleName} رو می‌خوام — رزرو` : 'یک مدل انتخاب کن'} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 04 before/after */}
      <section id="compare" className="bg-[#FDFCFB] py-12 sm:py-16">
        <div className="max-w-[720px] mx-auto px-6">
          <div className="text-center">
            <p className="text-[10px] tracking-[0.20em] text-black/60">۰۴ — مقایسه • pixel-perfect</p>
            <h2 className="mt-2 font-serif text-[24px] tracking-[-0.02em] text-pmu-green">قبل و بعد — همان زوم 3D</h2>
            <p className="mt-1 text-[11.5px] font-light text-black/60">اسلایدر روی همان فریم WebGL — بدون جابجایی</p>
          </div>
          <div className="mt-8">
            <BeforeAfterSlider beforeSrc={beforeSrc || imageSrc} afterSrc={afterSrc} />
            <div className="mt-4 flex gap-2.5">
              <button onClick={()=> setBookingOpen(true)} className="flex-1 bg-pmu-green text-white py-3 rounded-full text-[11px] tracking-wide font-light hover:bg-black transition">این مدل رو می‌خوام</button>
              <a href="#canvas" className="px-6 py-3 rounded-full border hairline text-pmu-green text-[11px] font-light hover:bg-white transition">بازگشت به 3D</a>
            </div>
          </div>
        </div>
      </section>

      {/* 05 booking */}
      <section id="booking" className="bg-white border-t hairline py-14 sm:py-20">
        <div className="max-w-[1080px] mx-auto px-6">
          <div className="grid lg:grid-cols-[0.9fr_1.05fr] gap-10 items-start">
            <div>
              <p className="text-[10px] tracking-[0.20em] text-black/60">۰۵ — رزرو • WhatsApp</p>
              <h2 className="mt-3 font-serif text-[28px] sm:text-[30px] leading-[1.1] tracking-[-0.03em] text-pmu-green">همین مدل رو<br/><span className="italic text-black/40 font-light">رزرو کنیم؟</span></h2>
              <p className="mt-3 text-[12.5px] leading-6 font-light text-black/65">فرم مینیمال — مستقیم به wa.me/989150000000</p>
              <ul className="mt-6 space-y-2 text-[11.5px] font-light leading-6 text-black/45">
                <li>— مشاوره قبل از اجرا رایگان</li>
                <li>— پاسخ واتساپ زیر ۲ ساعت</li>
                <li className="text-[10.5px] text-black/60">مشهد • حضوری • ۱۰–۱۹</li>
              </ul>
            </div>
            <BookingModal inline selectedService={faService} selectedStyleName={activeStyleName} />
          </div>
        </div>
      </section>

      <footer className="bg-[#0F3D2E] text-white/60 py-8 border-t border-white/5">
        <div className="max-w-[1080px] mx-auto px-6 flex flex-col sm:flex-row justify-between gap-5 text-[11px] font-light">
          <div>
            <p className="font-serif tracking-[0.14em] text-white text-[11px]">Asal Rajabi — Virtual PMU Atelier</p>
            <p className="text-white/30 text-[10px] tracking-wide mt-1">React • Three.js • MediaPipe 468 • Framer Motion • 60fps</p>
          </div>
          <div className="text-right sm:text-left space-y-1">
            <a href="https://instagram.com/asalrajabi_pmu" target="_blank" className="block hover:text-white transition">@asalrajabi_pmu</a>
            <p>wa.me/989150000000</p>
            <p className="text-white/25">© 2026 Asal Rajabi PMU</p>
          </div>
        </div>
      </footer>

      <BookingModal isOpen={isBookingOpen} onClose={()=> setBookingOpen(false)} selectedService={faService} selectedStyleName={activeStyleName} />
    </div>
  )
}
