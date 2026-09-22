import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs/promises";
import path from "path";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "رمز عبور نادرست است" });
  }

  try {
    res.json(JSON.parse(await fs.readFile(path.join(process.cwd(), "data/bookings.json"), "utf8")));
  } catch {
    res.status(500).json({ error: "خطا در خواندن نوبت‌ها" });
  }
}
