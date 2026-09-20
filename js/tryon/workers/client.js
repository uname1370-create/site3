// ---------------------------------------------------------------------------
// workers/client.js — tiny request/response client for tryon.worker.js.
// One shared worker; any failure marks it dead and callers fall back to the
// inline (main-thread) path — the UI can never hard-fail because of it.
// ---------------------------------------------------------------------------

let worker = null;
let dead = false;
let seq = 0;
const pending = new Map();

/** True only when the platform can run the worker at all. */
export function workerAvailable() {
  return (
    !dead &&
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof ImageBitmap !== "undefined"
  );
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./tryon.worker.js", import.meta.url).href, { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data || {};
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else {
        const err = new Error(m.message || "worker error");
        if (m.code) err.code = m.code; // AnalysisError code from the worker
        p.reject(err);
      }
    };
    worker.onerror = (e) => {
      dead = true;
      const msg = String((e && e.message) || "worker crashed");
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(msg));
      }
      pending.clear();
    };
  }
  return worker;
}

/**
 * Send a message to the shared worker.
 * @param {object} msg
 * @param {Transferable[]} [transfer]
 * @param {number} [timeoutMs]
 */
export function postWorker(msg, transfer, timeoutMs = 30000) {
  if (!workerAvailable()) return Promise.reject(new Error("worker unavailable"));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("worker timeout"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage({ ...msg, id }, transfer || []);
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      dead = true;
      reject(e);
    }
  });
}
