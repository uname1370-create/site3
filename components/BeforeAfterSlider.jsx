/* eslint-disable @next/next/no-img-element */
"use client"
import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'

/**
 * BeforeAfterSlider — Pixel-perfect synchronized comparison
 * - beforeSrc & afterSrc MUST be rendered at identical viewCrop / camera zoom
 * - draggable handle, touch + mouse, 60fps, no layout shift
 * - consumes dataURLs captured at same frame (Canvas3D preserveDrawingBuffer)
 */
export default function BeforeAfterSlider({ beforeSrc, afterSrc, className = '' }) {
  const [pct, setPct] = useState(50)
  const wrapRef = useRef(null)
  const isDragging = useRef(false)

  const updateFromClientX = useCallback((clientX) => {
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const p = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setPct(p)
  }, [])

  const handlePointerDown = (e) => {
    isDragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    updateFromClientX(e.clientX)
  }
  const handlePointerMove = (e) => {
    if (!isDragging.current && e.buttons !== 1) return
    updateFromClientX(e.clientX)
  }
  const handlePointerUp = () => { isDragging.current = false }

  const handleTouchMove = (e) => {
    const t = e.touches[0]
    if (!t) return
    updateFromClientX(t.clientX)
  }

  if (!beforeSrc || !afterSrc) {
    return (
      <div className={`rounded-[20px] border hairline bg-white p-8 text-center ${className}`}>
        <p className="text-sm font-extralight text-black/30">ابتدا عکس انتخاب و استایل اعمال کنید</p>
        <p className="text-xs font-extralight text-black/20 mt-1">اسلایدر با همان زوم ماکرو هم‌تراز می‌شود</p>
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      <div
        ref={wrapRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchMove={handleTouchMove}
        className="relative rounded-[16px] overflow-hidden bg-[#FDFCFB] aspect-[4/5] sm:aspect-[4/3.2] select-none touch-manipulation border hairline"
        style={{ cursor: 'ew-resize' }}
      >
        {/* BEFORE — base cropped macro, same viewCrop as after */}
        <img src={beforeSrc} alt="before — bare" className="absolute inset-0 w-full h-full object-cover object-center" draggable={false} />

        {/* AFTER — clipped to pct, pixel-perfect aligned because both are same camera frame */}
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <img
            src={afterSrc}
            alt="after — styled"
            className="absolute inset-0 w-full h-full object-cover object-center max-w-none"
            style={{ width: wrapRef.current ? `${wrapRef.current.clientWidth}px` : '100%', height: '100%', left: 0 }}
            draggable={false}
          />
        </div>

        {/* Labels — luxury minimal */}
        <span className="absolute top-3 right-3 bg-white/90 backdrop-blur text-pmu-green text-[10px] tracking-wide font-light px-2.5 py-1 rounded-full border border-black/5">قبل — bare</span>
        <span className="absolute top-3 left-3 bg-pmu-green text-white text-[10px] tracking-wide font-light px-2.5 py-1 rounded-full">بعد — مات</span>

        {/* Handle — glass + motion */}
        <motion.div
          className="absolute top-0 bottom-0 w-px bg-white/90"
          style={{ left: `${pct}%` }}
          animate={{ left: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-11 h-11 rounded-full bg-white/95 backdrop-blur border border-black/5 shadow-[0_4px_16px_rgba(0,0,0,0.08)] flex items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-pmu-green flex items-center justify-center text-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"><path d="M8 12h8" /><path d="M10 8l-2 4 2 4" /><path d="M14 8l2 4-2 4" /></svg>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Invisible range for accessibility */}
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          aria-label="مقایسه قبل و بعد"
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] font-extralight text-black/30">
        <span>← بکش برای مقایسه</span>
        <span className="tabular-nums">{Math.round(pct)}٪</span>
      </div>
    </div>
  )
}
