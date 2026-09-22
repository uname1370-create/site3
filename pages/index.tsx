import { useState } from "react";
import Layout from "../components/Layout";
import ServiceSection from "../components/ServiceSection";
import PreviewStudio from "../components/PreviewStudio";
import { services } from "../lib/services";

export default function Home() {
  const [mode, setMode] = useState("both");

  return (
    <Layout>
      <main className={"mode-" + mode}>
        <section className="hero">
          <div className="hero-glow" />
          <div className="container-lux hero-grid">
            <div className="hero-copy">
              <div className="eyebrow"><span /> PERMANENT MAKEUP STUDIO</div>
              <h1>زیباییِ تو،<br /><em>با ظرافت</em> طراحی می‌شود.</h1>
              <p className="hero-lead">میکروبلیدینگ، خط چشم و شیدینگ لب با رویکردی ظریف، طبیعی و متناسب با فرم چهره.</p>
              <div className="hero-actions">
                <a className="gold-btn hero-btn" href="#services">مشاهده خدمات <span>←</span></a>
                <a className="text-link" href="#ai-preview">پیش‌نمایش هوش مصنوعی <span>↗</span></a>
              </div>
              <div className="hero-meta">
                <div><strong>۰۳</strong><span>خدمت تخصصی</span></div>
                <div><strong>۱۰۰٪</strong><span>طراحی شخصی</span></div>
                <div><strong>PMU</strong><span>با دقت و ظرافت</span></div>
              </div>
            </div>

            <div className="hero-visual">
              <div className="hero-image-wrap">
                <img src="/hero.jpg" alt="نمونه کار عسل رجبی" className="hero-image" />
                <div className="hero-image-fallback">تصویر اصلی را از پنل مدیریت انتخاب کنید</div>
              </div>
              <div className="hero-badge">
                <span className="badge-line" />
                <strong>Beauty<br />with intention</strong>
                <small>مشهد · برج پاژ</small>
              </div>
            </div>
          </div>
        </section>

        <section className="intro-strip">
          <div className="container-lux intro-inner">
            <span className="intro-kicker">01 / THE STUDIO</span>
            <p>هر چهره یک فرم منحصربه‌فرد دارد؛ هدف ما ساختن نتیجه‌ای است که بخشی از چهره شما باشد، نه یک ظاهر مصنوعی.</p>
            <a href="/about">بیشتر درباره من <span>↗</span></a>
          </div>
        </section>

        <section id="services" className="services-area container-lux">
          <div className="section-heading">
            <div>
              <span className="eyebrow"><span /> SERVICES</span>
              <h2>خدمات تخصصی</h2>
            </div>
            <p>انتخابی دقیق برای ابرو، چشم و لب؛ با تمرکز روی فرم طبیعی و هارمونی چهره.</p>
          </div>

          {services.map((s, index) => (
            <ServiceSection
              key={s.id}
              index={index + 1}
              title={s.title}
              description={s.description}
              styles={s.styles}
              onPick={() => document.getElementById("ai-preview")?.scrollIntoView({ behavior: "smooth" })}
            />
          ))}
        </section>

        <section className="preview-intro">
          <div className="container-lux preview-intro-inner">
            <div>
              <span className="eyebrow light"><span /> AI BEAUTY PREVIEW</span>
              <h2>قبل از تصمیم،<br /><em>نتیجه را تصور کن.</em></h2>
            </div>
            <p>عکس خود را بارگذاری کنید، مدل و رنگ را انتخاب کنید و یک پیش‌نمایش اولیه از نتیجه دریافت کنید.</p>
          </div>
        </section>

        <section id="ai-preview" className="ai-section">
          <div className="container-lux">
            <PreviewStudio />
          </div>
        </section>

        <section className="location-section">
          <div className="container-lux location-card">
            <div>
              <span className="eyebrow"><span /> VISIT THE STUDIO</span>
              <h2>وقتشه برای خودت<br /><em>یک انتخاب زیبا</em> داشته باشی.</h2>
            </div>
            <div className="location-info">
              <p>مشهد، برج پاژ</p>
              <a href="tel:09058674412">۰۹۰۵۸۶۷۴۴۱۲</a>
              <a className="gold-btn" href="/booking">رزرو نوبت <span>↗</span></a>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
