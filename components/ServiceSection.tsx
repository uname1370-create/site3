import Image from "next/image";
import { Style } from "../lib/services";

export default function ServiceSection({
  title,
  description,
  styles,
  onPick,
  index,
}: {
  title: string;
  description: string;
  styles: Style[];
  onPick: (s: Style) => void;
  index: number;
}) {
  return (
    <section className="service-block">
      <div className="service-heading">
        <span className="service-number">0{index}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="service-arrow">↘</span>
      </div>

      <div className="style-grid">
        {styles.map((s) => (
          <button key={s.id} onClick={() => onPick(s)} className="style-card">
            <div className="style-image">
              <Image src={s.image} alt={s.title} fill className="object-cover" />
              <div className="style-overlay" />
              <span className="style-view">انتخاب مدل ↗</span>
            </div>
            <div className="style-info">
              <div>
                <h4>{s.title}</h4>
                <p>{s.subtitle}</p>
              </div>
              <div className="color-dots">
                {s.colors.slice(0, 4).map((c) => (
                  <span key={c.hex} style={{ background: c.hex }} title={c.name} />
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
