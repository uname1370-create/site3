import { useState } from "react";
import { services } from "../lib/services";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

export default function PreviewStudio() {
  const [service, setService] = useState(services[0]);
  const [style, setStyle] = useState<any>(null);
  const [color, setColor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setErr("");
    if (!file) return setErr("لطفاً عکس چهره را انتخاب کنید");
    if (file.size > 5242880) return setErr("حجم عکس نباید بیشتر از ۵ مگابایت باشد");
    if (!["image/jpeg", "image/png"].includes(file.type)) return setErr("فقط عکس JPG و PNG قابل قبول است");
    if (!style || !color) return setErr("مدل و رنگ را انتخاب کنید");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("service", service.title);
      fd.append("style", style.title);
      fd.append("color", color);
      const r = await fetch("/api/preview", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error();
      setUrl(j.url);
    } catch {
      setErr("خطا در پردازش تصویر. لطفاً دوباره امتحان کنید");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-studio">
      <div className="ai-controls">
        <div className="ai-step">
          <span>01</span>
          <div><small>انتخاب خدمت</small><strong>{service.title}</strong></div>
        </div>

        <div className="service-pills">
          {services.map((s) => (
            <button key={s.id} onClick={() => { setService(s); setStyle(null); setColor(""); }} className={service.id === s.id ? "active" : ""}>{s.title}</button>
          ))}
        </div>

        <div className="ai-step">
          <span>02</span>
          <div><small>انتخاب مدل</small><strong>{style?.title || "یک مدل انتخاب کنید"}</strong></div>
        </div>

        <div className="mini-style-grid">
          {service.styles.map((s) => (
            <button key={s.id} onClick={() => { setStyle(s); setColor(s.colors[0].name); }} className={style?.id === s.id ? "selected" : ""}>
              <span>{s.title}</span><small>{s.subtitle}</small>
            </button>
          ))}
        </div>

        {style && (
          <div className="color-picker">
            <small>03 / رنگ پیشنهادی</small>
            <div>{style.colors.map((c: any) => (
              <button key={c.hex} onClick={() => setColor(c.name)} className={color === c.name ? "selected" : ""}>
                <i style={{ background: c.hex }} />{c.name}
              </button>
            ))}</div>
          </div>
        )}

        <label className="upload-box">
          <input type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <span className="upload-icon">＋</span>
          <strong>{file ? file.name : "عکس چهره خود را انتخاب کنید"}</strong>
          <small>JPG یا PNG · حداکثر ۵ مگابایت</small>
        </label>

        {err && <p className="form-error">{err}</p>}
        <button disabled={busy} onClick={run} className="gold-btn ai-run">{busy ? "در حال ساخت پیش‌نمایش..." : "ساخت پیش‌نمایش ↗"}</button>
      </div>

      <div className="ai-result">
        <div className="result-top"><span>PREVIEW</span><span>{url ? "RESULT" : "READY"}</span></div>
        {url && file ? (
          <>
            <div className="compare-frame">
              <ReactCompareSlider itemOne={<ReactCompareSliderImage src={URL.createObjectURL(file)} alt="قبل" />} itemTwo={<ReactCompareSliderImage src={url} alt="بعد" />} />
            </div>
            <div className="result-actions">
              <a download href={url}>دانلود نتیجه</a>
              <a className="gold-btn" target="_blank" rel="noreferrer" href={"https://wa.me/989058674412?text=" + encodeURIComponent("سلام، می‌خوام نوبت بگیرم\nخدمت: " + service.title + "\nمدل: " + style.title + "\nرنگ: " + color)}>رزرو در واتساپ ↗</a>
            </div>
          </>
        ) : (
          <div className="result-empty">
            <div className="result-mark">AR</div>
            <strong>پیش‌نمایش شما اینجا نمایش داده می‌شود</strong>
            <span>یک عکس، مدل و رنگ انتخاب کنید.</span>
          </div>
        )}
      </div>
    </div>
  );
}
