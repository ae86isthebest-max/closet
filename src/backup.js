// 備份：將所有衫同配搭打包成一個 zip，存去「檔案」/ iCloud Drive
import * as db from './db.js';
import { makeZip, readZip, crc32 } from './zip.js';

const BLOBS = { orig: 'orig.jpg', cutout: 'cutout.png', thumb: 'thumb.png', mask: 'mask.png' };
const TYPES = { orig: 'image/jpeg', cutout: 'image/png', thumb: 'image/png', mask: 'image/png' };

export async function buildBackup(onProgress) {
  const items = await db.getAll('items');
  const outfits = await db.getAll('outfits');
  const files = [];
  const meta = [];
  let n = 0;
  for (const it of items) {
    if (it.status === 'processing') continue;
    const m = { ...it };
    for (const k of Object.keys(BLOBS)) {
      delete m[k];
      if (it[k]) {
        const crc = crc32(new Uint8Array(await it[k].arrayBuffer()));
        files.push({ name: `items/${it.id}/${BLOBS[k]}`, data: it[k], crc, size: it[k].size });
      }
    }
    meta.push(m);
    onProgress?.(++n / items.length);
  }
  const data = { app: 'closet', version: 1, exported: Date.now(), items: meta, outfits };
  files.unshift({ name: 'data.json', data: new TextEncoder().encode(JSON.stringify(data)) });
  const zip = makeZip(files);
  const d = new Date();
  const name = `衣櫃備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
  return new File([zip], name, { type: 'application/zip' });
}

export async function saveFile(file) {
  const name = file.name;
  // iPhone：用分享表 →「儲存到檔案」
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
}

export async function importBackup(file) {
  const entries = await readZip(file);
  const raw = entries.get('data.json');
  if (!raw) throw new Error('唔係衣櫃備份檔');
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.app !== 'closet') throw new Error('唔係衣櫃備份檔');
  let n = 0;
  for (const m of data.items) {
    const it = { ...m };
    for (const [k, fname] of Object.entries(BLOBS)) {
      const b = entries.get(`items/${m.id}/${fname}`);
      if (b) it[k] = new Blob([b.slice()], { type: TYPES[k] });
    }
    if (it.status === 'classifying') it.status = it.category ? 'ready' : 'error';
    await db.put('items', it);
    n++;
  }
  for (const o of data.outfits || []) await db.put('outfits', o);
  return n;
}
