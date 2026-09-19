"use client"
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * BookingModal — Minimal luxury + WhatsApp wa.me/989150000000
 * Collects Name, Phone, Service, Date, Notes
 * Formats Persian message, encodes, opens wa.me
 */
export default function BookingModal({ isOpen, onClose, selectedService, selectedStyleName, inline = false }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState('')
  const [service, setService] = useState(selectedService || '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // sync when selectedService changes externally
  if (selectedService && service !== selectedService && !inline) {
    // do not cause render loop — only set if empty
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    const svc = service || selectedService
    if (!name.trim() || !phone.trim() || !svc) { setError('نام، موبایل و خدمت الزامی است'); return }
    const digits = phone.replace(/\s/g, '')
    if (!/^09\d{9}$/.test(digits)) { setError('موبایل معتبر نیست — 09xx xxx xxxx'); return }

    const style = selectedStyleName || '—'
    const msg = `سلام عسل جان 🌸%0Aمن ${encodeURIComponent(name)} هستم.%0Aبرای ${encodeURIComponent(svc)} — مدل "${encodeURIComponent(style)}" رو پسندیدم.%0Aتاریخ: ${encodeURIComponent(date || 'توافقی')}%0Aشماره: ${encodeURIComponent(digits)}%0A${note ? '%0Aتوضیح: ' + encodeURIComponent(note) : ''}%0A%0Aعکس قبل/بعد ذخیره شد.`
    const waNumber = '989150000000'
    const url = `https://wa.me/${waNumber}?text=${msg}`
    window.open(url, '_blank')
    if (!inline) onClose?.()
  }

  const form = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] tracking-[0.14em] font-light text-pmu-green">فرم رزرو — واتساپ</h3>
        <span className="text-[10px] border hairline px-2.5 py-1 rounded-full bg-white text-black/35">
          {selectedStyleName ? `${selectedService || service} — ${selectedStyleName}` : 'خدمتی انتخاب نشده'}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3.5">
        <label className="block">
          <span className="text-[10px] tracking-wide text-black/40">نام *</span>
          <input value={name} onChange={e=>setName(e.target.value)} required placeholder="سارا احمدی" className="mt-1.5 w-full bg-white border hairline rounded-xl px-3.5 py-3 text-[13px] placeholder:text-black/20 focus:border-black/15 outline-none font-extralight" />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-wide text-black/40">موبایل *</span>
          <input value={phone} onChange={e=>setPhone(e.target.value)} required type="tel" dir="ltr" placeholder="09xx xxx xxxx" pattern="09[0-9]{9}" className="mt-1.5 w-full bg-white border hairline rounded-xl px-3.5 py-3 text-[13px] placeholder:text-black/20 focus:border-black/15 outline-none text-left font-extralight" style={{direction:'ltr'}} />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-wide text-black/40">تاریخ</span>
          <input value={date} onChange={e=>setDate(e.target.value)} type="date" className="mt-1.5 w-full bg-white border hairline rounded-xl px-3.5 py-3 text-[13px] focus:border-black/15 outline-none font-extralight" />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-wide text-black/40">خدمت</span>
          <select value={service || selectedService || ''} onChange={e=>setService(e.target.value)} className="mt-1.5 w-full bg-white border hairline rounded-xl px-3.5 py-3 text-[13px] focus:border-black/15 outline-none font-extralight">
            <option value="">— انتخاب —</option>
            <option value="ابرو">ابرو — Eyebrow</option>
            <option value="لب">لب — Lips</option>
            <option value="خط چشم">خط چشم — Eyeliner</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] tracking-wide text-black/40">توضیح</span>
        <textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} placeholder="مدل مورد علاقه، رنگ پوست..." className="mt-1.5 w-full bg-white border hairline rounded-xl px-3.5 py-3 text-[13px] placeholder:text-black/20 focus:border-black/15 outline-none resize-none font-extralight" />
      </label>

      {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}

      <label className="flex items-start gap-2">
        <input type="checkbox" required className="mt-1 w-3.5 h-3.5 rounded border-black/10" />
        <span className="text-[11px] leading-5 font-extralight text-black/40">پیش‌نمایش تقریبی است، طراحی نهایی با متخصص.</span>
      </label>

      <button type="submit" className="w-full bg-pmu-green text-white py-3.5 rounded-full text-[11px] tracking-[0.14em] font-light hover:bg-black transition">رزرو نوبت → واتساپ</button>
      <p className="text-[10px] text-center font-extralight text-black/25">هدایت به wa.me/989150000000 — بدون پرداخت آنلاین</p>
    </form>
  )

  if (inline) {
    return <div className="rounded-[20px] border hairline bg-[#FDFCFB] p-6 sm:p-7">{form}</div>
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} className="fixed inset-0 z-50 bg-[#0F3D2E]/20 backdrop-blur-[6px]" />
          <motion.div initial={{opacity:0, y:16}} animate={{opacity:1, y:0}} exit={{opacity:0, y:16}} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-[560px] rounded-[24px] bg-[#FDFCFB] border hairline p-6 sm:p-7 max-h-[90vh] overflow-y-auto shadow-[0_24px_64px_rgba(15,61,46,0.12)]">
              <div className="flex items-center justify-between mb-4">
                <p className="font-serif text-pmu-green">رزرو نوبت</p>
                <button onClick={onClose} className="w-8 h-8 rounded-full border hairline flex items-center justify-center text-black/40 hover:text-pmu-green">✕</button>
              </div>
              {form}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
