// 免費、喺手機本機計：由 cut 好嘅衫相搵出主要顏色
const PALETTE = [
  ['白', '#f7f7f5'], ['米白', '#efe6d6'], ['奶茶', '#d8c3a5'], ['卡其', '#c3a77a'], ['啡', '#7b5235'], ['深啡', '#4a3020'],
  ['黑', '#1d1d1f'], ['深灰', '#4b4b4f'], ['灰', '#8e8e93'], ['淺灰', '#c7c7cc'],
  ['紅', '#d32f2f'], ['酒紅', '#7b1f2e'], ['粉紅', '#f48fb1'], ['玫紅', '#d14d76'], ['藕粉', '#d8a7a7'], ['淺粉', '#f8d3dc'], ['珊瑚', '#ff7f6e'],
  ['橙', '#f57c00'], ['黃', '#fbc02d'], ['淺黃', '#fff1a8'], ['芥末黃', '#c9a227'],
  ['綠', '#388e3c'], ['軍綠', '#5b6236'], ['薄荷綠', '#a8e6cf'], ['墨綠', '#1f4d3a'],
  ['藍', '#1e63c6'], ['淺藍', '#9cc7f0'], ['牛仔藍', '#4a6e96'], ['海軍藍', '#1f2d4d'], ['天藍', '#5bc0eb'],
  ['紫', '#7e57c2'], ['淺紫', '#cdb4e8'],
].map(([name, hex]) => ({ name, hex, lab: rgbToLab(...hexToRgb(hex)) }));

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function rgbToLab(r, g, b) {
  const f = (c) => {
    c /= 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g3(x); y = g3(y); z = g3(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function nearest(lab) {
  let best = PALETTE[0], bd = Infinity;
  for (const p of PALETTE) {
    const d = (p.lab[0] - lab[0]) ** 2 + (p.lab[1] - lab[1]) ** 2 + (p.lab[2] - lab[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// canvas：去咗背嘅相（有 alpha）。回傳最多 3 個 { name, hex }
export function dominantColors(canvas, max = 3) {
  const s = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * s));
  const h = Math.max(1, Math.round(canvas.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const groups = new Map();
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue; // 只計件衫本身
    const p = nearest(rgbToLab(d[i], d[i + 1], d[i + 2]));
    let g = groups.get(p.name);
    if (!g) groups.set(p.name, (g = { name: p.name, n: 0, r: 0, g: 0, b: 0 }));
    g.n++; g.r += d[i]; g.g += d[i + 1]; g.b += d[i + 2];
    total++;
  }
  if (!total) return [];
  return [...groups.values()]
    .sort((a, b) => b.n - a.n)
    .filter((g, i) => i === 0 || g.n / total > 0.12)
    .slice(0, max)
    .map((g) => ({ name: g.name, hex: toHex(g.r / g.n, g.g / g.n, g.b / g.n) }));
}
