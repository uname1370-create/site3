import './globals.css'

export const metadata = {
  title: 'Asal Rajabi — Virtual PMU Atelier | پیش‌نمایش میکاپ دائم',
  description: 'پیش‌نمایش مات و طبیعی میکروبلیدینگ، شیدینگ لب و بن‌مژه روی چهره‌ی خودت — با هوش مصنوعی 3D، کاملا داخل گوشی. 60fps, PBR, WebGL.',
  themeColor: '#0F3D2E',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover'
}

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="antialiased bg-[#FDFCFB] text-pmu-green">
        {children}
      </body>
    </html>
  )
}
