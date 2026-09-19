# Virtual PMU Atelier — Asal Rajabi

Production-grade 3D AR Web App — Luxury Permanent Makeup try-on.

**Stack:** Next.js 14 (App Router) • React 18 • Three.js + React Three Fiber + Drei • MediaPipe Face Mesh 468 • Framer Motion • Tailwind CSS

**Features:**
- 3D Face Mesh + PBR PMU rendering (brows ombre, lips soft-light with teeth stencil, eyeliner lash-line)
- Cinematic 3D camera auto-zoom per service (brows 75%, lips macro, eyeliner eye, full)
- Pixel-perfect Before/After slider (same WebGL frame)
- Ultra-minimal Chanel/Tom Ford glassmorphism, Playfair + Vazirmatn RTL
- WhatsApp booking → `wa.me/989150000000`

**Structure:**
```
app/page.jsx              — luxury UI & state
app/layout.jsx            — root layout
app/globals.css           — tailwind + luxury tokens
components/Canvas3D.jsx   — Three.js / MediaPipe 3D Mesh & shader blending
components/CameraControls.jsx — dynamic 3D camera auto-zoom
components/BeforeAfterSlider.jsx — synchronized comparison
components/BookingModal.jsx — WhatsApp booking
lib/faceMeshUtils.js      — landmarks, crops, styles
```

**Run:**
```bash
npm install
npm run dev    # http://localhost:3000
npm run build && npm start
```

Legacy single-file `index.html` (vanilla Canvas) remains for reference.
