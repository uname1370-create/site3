import { useState } from "react";
import Layout from "../components/Layout";
import { services } from "../lib/services";

export default function Admin() {
  const [pw, setPw] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [logged, setLogged] = useState(false);

  async function load() {
    const r = await fetch("/api/bookings-list", {
      headers: { "x-admin-password": pw },
    });
    if (r.ok) {
      setRows(await r.json());
      setLogged(true);
    } else {
      alert("رمز عبور نادرست است");
    }
  }

  if (!logged) {
    return (
      <Layout>
        <main className="container-lux py-20 max-w-md">
          <div className="bg-white p-7 rounded-3xl shadow-luxury">
            <h1 className="text-2xl font-bold">ورود مدیریت</h1>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="رمز عبور" className="w-full border rounded-xl p-3 mt-5" />
            <button onClick={load} className="gold-btn w-full rounded-xl py-3 mt-4">ورود</button>
          </div>
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="container-lux py-10 space-y-7">
        <h1 className="text-4xl font-black">پنل مدیریت</h1>
        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 7, 30].map((n) => (
            <div className="bg-white rounded-2xl shadow-luxury p-5" key={n}>
              <div className="text-gray-500">{n === 1 ? "امروز" : n === 7 ? "این هفته" : "این ماه"}</div>
              <div className="text-3xl text-gold font-black mt-2">
                {rows.filter((x) => new Date(x.timestamp) >= new Date(Date.now() - n * 86400000)).length}
              </div>
            </div>
          ))}
        </div>

        <section className="bg-white rounded-3xl p-5 shadow-luxury overflow-auto">
          <h2 className="font-bold mb-4">مدیریت نوبت‌ها</h2>
          <table className="w-full text-sm">
            <thead><tr><th>نام</th><th>تلفن</th><th>خدمت</th><th>مدل</th><th>رنگ</th><th>تاریخ</th><th>زمان</th></tr></thead>
            <tbody>
              {rows.slice().reverse().map((x, i) => (
                <tr className="border-t" key={i}>
                  <td className="p-2">{x.name}</td><td>{x.phone}</td><td>{x.service}</td><td>{x.style}</td><td>{x.color}</td><td>{x.date}</td><td>{new Date(x.timestamp).toLocaleTimeString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-3xl p-5 shadow-luxury">
          <h2 className="font-bold mb-4">مدیریت تصاویر</h2>
          {services.map((s) => (
            <div key={s.id} className="mb-6">
              <h3 className="font-bold">{s.title}</h3>
              {s.styles.map((st) => (
                <label key={st.id} className="block border rounded-xl p-3 mt-2 cursor-pointer">
                  {st.title}
                  <input type="file" accept="image/png" className="block mt-2" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5242880) return alert("حجم عکس نباید بیشتر از ۵ مگابایت باشد");
                    const fd = new FormData();
                    fd.append("image", file);
                    fd.append("category", s.id);
                    fd.append("name", st.id);
                    const r = await fetch("/api/upload-sample", { method: "POST", headers: { "x-admin-password": pw }, body: fd });
                    alert(r.ok ? "تصویر ذخیره شد" : "خطا در بارگذاری تصویر");
                  }} />
                </label>
              ))}
            </div>
          ))}
        </section>

        <section className="bg-white rounded-3xl p-5 shadow-luxury">
          <h2 className="font-bold mb-4">تصویر هیرو</h2>
          <input type="file" accept="image/jpeg,image/png" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.append("image", file);
            const r = await fetch("/api/upload-hero", { method: "POST", headers: { "x-admin-password": pw }, body: fd });
            alert(r.ok ? "تصویر هیرو ذخیره شد" : "خطا در بارگذاری تصویر");
          }} />
        </section>
      </main>
    </Layout>
  );
}
