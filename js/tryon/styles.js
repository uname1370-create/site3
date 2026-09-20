// ---------------------------------------------------------------------------
// styles.js — public style catalog (UI-facing). Brow/liner engines carry
// their own style tables (brow/model.js, liner/analyze.js); this maps the
// UI ids and holds the lip palette.
// ---------------------------------------------------------------------------

import { BROW_STYLES } from "./brow/model.js";
import { LINER_STYLES } from "./liner/analyze.js";

export { BROW_STYLES, LINER_STYLES };

export const LIP_STYLES = [
  { id: "nude", name: "نود رزی", hint: "ساتین ملایم", color: "#C9897B", finish: "satin" },
  { id: "coral", name: "کالباسی", hint: "مات مرجانی", color: "#D07060", finish: "matte" },
  { id: "brick", name: "آجری", hint: "ولوت گرم", color: "#A24B3A", finish: "matte" },
  { id: "pink", name: "صورتی مخملی", hint: "ساتین مخمل", color: "#C45C78", finish: "satin" },
  { id: "berry", name: "بری تیره", hint: "عمیق و غنی", color: "#7A2E44", finish: "satin" },
];

export const SERVICES = {
  brow: { label: "میکروبلیدینگ", list: Object.values(BROW_STYLES) },
  lip: { label: "شیدینگ لب", list: LIP_STYLES },
  liner: { label: "خط چشم", list: Object.values(LINER_STYLES) },
};

export const LINER_STYLE_MAP = {};
for (const s of Object.values(LINER_STYLES)) LINER_STYLE_MAP[s.id] = s.id;
