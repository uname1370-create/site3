import Link from "next/link";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" className="site-shell">
      <header className="site-header">
        <div className="container-lux header-inner">
          <Link href="/" className="brand" aria-label="عسل رجبی PMU">
            <span className="brand-mark">AR</span>
            <span>
              <strong>عسل رجبی</strong>
              <small>PERMANENT MAKEUP</small>
            </span>
          </Link>

          <nav className="desktop-nav" aria-label="منوی اصلی">
            <Link href="/">خانه</Link>
            <Link href="/about">درباره من</Link>
            <Link href="/booking">رزرو نوبت</Link>
          </nav>

          <Link href="/booking" className="header-cta">
            رزرو نوبت <span>↗</span>
          </Link>
        </div>
      </header>

      {children}

      <footer className="site-footer">
        <div className="container-lux footer-grid">
          <div>
            <div className="footer-brand">عسل رجبی <span>PMU</span></div>
            <p>زیبایی طبیعی، طراحی دقیق و نتیجه‌ای متناسب با چهره شما.</p>
          </div>
          <div className="footer-links">
            <Link href="/about">درباره من</Link>
            <Link href="/booking">رزرو نوبت</Link>
            <a href="https://www.instagram.com/asalrajabi_pmu/" target="_blank" rel="noreferrer">اینستاگرام</a>
          </div>
          <div className="footer-contact">
            <span>مشهد، برج پاژ</span>
            <a href="tel:09058674412">۰۹۰۵۸۶۷۴۴۱۲</a>
          </div>
        </div>
        <div className="container-lux footer-bottom">© عسل رجبی PMU — تمامی حقوق محفوظ است.</div>
      </footer>
    </div>
  );
}
