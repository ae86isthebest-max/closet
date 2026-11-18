// 「搵範圍」模組：喺手機本機用 ISNet 模型分出主體（件衫）
// 之後 P 圖功能（去背、換背景）都可以重用呢度。
import * as ort from 'onnxruntime-web/wasm';

const MODEL_URL = new URL('./models/isnet-small.onnx', document.baseURI).href;
const ORT_PATH = new URL('./vendor/ort/', document.baseURI).href;
const MODEL_CACHE = 'closet-models-v1';
const RES = 1024;

let sessionPromise = null;

async function fetchWithProgress(url, onProgress) {
  // 第一次下載後放入 Cache Storage，之後離線都用得
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) {
      onProgress?.(1);
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch (_) {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('下載模型失敗 (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 44342436;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(0.99, got / total));
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  try {
    await cache?.put(
      url,
      new Response(buf.slice(), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
  } catch (_) {
    /* 空間唔夠都照用 */
  }
  onProgress?.(1);
  return buf;
}

export async function isModelCached() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    return !!(await cache.match(MODEL_URL));
  } catch (_) {
    return false;
  }
}

export function loadModel(onProgress) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort.env.wasm.wasmPaths = ORT_PATH;
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;
      const bytes = await fetchWithProgress(MODEL_URL, onProgress);
      return ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

// ---------- 小工具 ----------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function loadImage(blob, maxSide = 1600) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s);
    const h = Math.round(img.naturalHeight * s);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- AI 去背 ----------
// 回傳 Uint8ClampedArray（長度 w*h），0 = 背景，255 = 主體
export async function aiMask(canvas, onProgress) {
  const session = await loadModel(onProgress);
  const { width: w, height: h } = canvas;
  const small = makeCanvas(RES, RES);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, RES, RES);
  const px = sctx.getImageData(0, 0, RES, RES).data;
  const stride = RES * RES;
  const input = new Float32Array(3 * stride);
  for (let i = 0, j = 0; j < stride; i += 4, j++) {
    input[j] = (px[i] - 128) / 256;
    input[j + stride] = (px[i + 1] - 128) / 256;
    input[j + 2 * stride] = (px[i + 2] - 128) / 256;
  }
  const feeds = { input: new ort.Tensor('float32', input, [1, 3, RES, RES]) };
  const out = await session.run(feeds, ['output']);
  const pred = out.output.data;
  // 輸出放大返原圖尺寸
  const mimg = sctx.createImageData(RES, RES);
  for (let j = 0, i = 0; j < stride; j++, i += 4) {
    const v = Math.max(0, Math.min(255, pred[j] * 255));
    mimg.data[i] = mimg.data[i + 1] = mimg.data[i + 2] = v;
    mimg.data[i + 3] = 255;
  }
  sctx.putImageData(mimg, 0, 0);
  const big = makeCanvas(w, h);
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const bd = bctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8ClampedArray(w * h);
  for (let j = 0, i = 0; j < mask.length; j++, i += 4) {
    // 收緊少少半透明位，令邊緣乾淨但保留柔邊
    const a = bd[i] / 255;
    mask[j] = Math.round(255 * Math.min(1, Math.max(0, (a - 0.08) / 0.84)));
  }
  removeSpecks(mask, w, h);
  return mask;
}

// ---------- 快速模式：淨色背景（唔使下載模型）----------
export function quickMask(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  // 由四邊抽樣背景顏色
  const samples = [];
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    samples.push([d[i], d[i + 1], d[i + 2]]);
  };
  for (let x = 0; x < w; x += 4) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 4) {
    push(0, y);
    push(w - 1, y);
  }
  const med = [0, 1, 2].map((k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const dists = samples
    .map((s) => Math.hypot(s[0] - med[0], s[1] - med[1], s[2] - med[2]))
    .sort((a, b) => a - b);
  const thr = Math.max(28, dists[Math.floor(dists.length * 0.9)] * 1.6);
  const isBg = (p) => {
    const i = p * 4;
    return Math.hypot(d[i] - med[0], d[i + 1] - med[1], d[i + 2] - med[2]) < thr;
  };
  // 由邊緣 flood fill
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (bg[p] || !isBg(p)) continue;
    bg[p] = 1;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  const mask = new Uint8ClampedArray(w * h);
  for (let p = 0; p < mask.length; p++) mask[p] = bg[p] ? 0 : 255;
  removeSpecks(mask, w, h);
  return blurMask(mask, w, h, 2);
}

// 刪走好細嘅碎片（例如床單上嘅線頭）
function removeSpecks(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  let fgTotal = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] < 128 || seen[p]) continue;
    const pix = [];
    const st = [p];
    seen[p] = 1;
    while (st.length) {
      const q = st.pop();
      pix.push(q);
      const x = q % w;
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w];
      for (const n of nb) {
        if (n >= 0 && n < mask.length && !seen[n] && mask[n] >= 128) {
          seen[n] = 1;
          st.push(n);
        }
      }
    }
    fgTotal += pix.length;
    comps.push(pix);
  }
  const minSize = Math.max(50, fgTotal * 0.01);
  for (const c of comps) {
    if (c.length < minSize) for (const q of c) mask[q] = 0;
  }
}

function blurMask(mask, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += mask[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += mask[y * w + Math.min(w - 1, x + r + 1)] - mask[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// 將 mask 套落相度，cut 出主體，並裁到剛好大小
export function cutout(canvas, mask, pad = 0.04) {
  const { width: w, height: h } = canvas;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = mask[y * w + x];
      src.data[(y * w + x) * 4 + 3] = a;
      if (a > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // 搵唔到主體
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  x0 = Math.max(0, x0 - p);
  y0 = Math.max(0, y0 - p);
  x1 = Math.min(w - 1, x1 + p);
  y1 = Math.min(h - 1, y1 + p);
  const full = makeCanvas(w, h);
  full.getContext('2d').putImageData(src, 0, 0);
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(full, -x0, -y0);
  return out;
}

export function maskCoverage(mask) {
  let s = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) s++;
  return s / mask.length;
}

// mask <-> PNG（用灰階 PNG 儲存，方便之後再修）
export function maskToCanvas(mask, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let j = 0, i = 0; j < mask.length; j++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = mask[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function blobToMask(blob, w, h) {
  const c = await loadImage(blob, Math.max(w, h));
  const ctx = makeCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const m = new Uint8ClampedArray(w * h);
  for (let j = 0, i = 0; j < m.length; j++, i += 4) m[j] = d[i];
  return m;
}

export function canvasToBlob(canvas, type = 'image/png', q = 0.9) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q),
  );
}

export function scaled(canvas, maxSide, bg) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = makeCanvas(Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}
