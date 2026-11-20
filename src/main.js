import * as db from './db.js';
import * as seg from './segment.js';
import { classify, friendlyError, testKey, CATEGORIES, SEASONS, MODELS, DEFAULT_MODEL, NoKeyError } from './claude.js';
import { openMaskEditor } from './editor.js';
import { dominantColors } from './colors.js';

// Claude 認衫預設關閉（唔使錢）；喺設定開
const claudeOn = async () => (await db.kvGet('useClaude')) === true && !!(await db.kvGet('apiKey'));
import { buildBackup, saveFile, importBackup } from './backup.js';

// ---------------- 狀態 ----------------
const state = {
  tab: 'closet',
  items: [],
  outfits: [],
  filterCat: null,
  filterSeason: null,
  outfitDress: false,
  outfitSel: {},
  urls: new Map(), // id -> thumb object URL
  hidden: new Set(JSON.parse(localStorageGet('hiddenBanners') || '[]')),
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

function thumbUrl(item) {
  if (!item.thumb) return '';
  let u = state.urls.get(item.id);
  if (!u || u.blob !== item.thumb) {
    if (u) URL.revokeObjectURL(u.url);
    u = { url: URL.createObjectURL(item.thumb), blob: item.thumb };
    state.urls.set(item.id, u);
  }
  return u.url;
}

async function reload() {
  state.items = (await db.getAll('items')).sort((a, b) => b.created - a.created);
  state.outfits = (await db.getAll('outfits')).sort((a, b) => b.created - a.created);
}

// ---------------- toast / progress ----------------
let toastTimer;
export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}
let progEl = null;
function progress(text, frac) {
  if (text == null) { progEl?.remove(); progEl = null; return; }
  if (!progEl) {
    progEl = document.createElement('div');
    progEl.className = 'progress';
    progEl.innerHTML = '<div class="t"></div><div class="bar"><i></i></div>';
    document.body.appendChild(progEl);
  }
  $('.t', progEl).textContent = text;
  $('.bar', progEl).style.display = frac == null ? 'none' : '';
  $('.bar i', progEl).style.width = Math.round((frac || 0) * 100) + '%';
}

// ---------------- 渲染 ----------------
const ICONS = {
  closet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path class="ic" d="M12 4a2 2 0 1 1 2 2c-1 0-2 .6-2 1.6V8"/><path d="M12 8 3 15.5c-.7.6-.3 1.5.6 1.5h16.8c.9 0 1.3-.9.6-1.5Z"/></svg>',
  outfit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path class="ic" d="M8 3 4 5.5 5.5 9 7 8.3V13h10V8.3l1.5.7L20 5.5 16 3c-.5 1.4-2.1 2.4-4 2.4S8.5 4.4 8 3Z"/><path d="M7 15h10l1 6h-4l-2-3.5L10 21H6Z"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
  saved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path class="ic" d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle class="ic" cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
};

function renderTabbar() {
  const nav = $('#tabbar');
  const tab = (id, label) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${ICONS[id]}<span>${label}</span></button>`;
  nav.innerHTML =
    tab('closet', '衣櫃') + tab('outfit', '配衫') +
    `<button class="fab" id="addBtn" aria-label="加衫">${ICONS.add}</button>` +
    tab('saved', '我的配搭') + tab('settings', '設定');
  nav.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#addBtn').addEventListener('click', () => $('#fileInput').click());
}

function go(tab) {
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
}

function render() {
  renderTabbar();
  const main = $('#view');
  const views = { closet: viewCloset, outfit: viewOutfit, saved: viewSaved, settings: viewSettings };
  views[state.tab](main);
}

function header(title, sub) {
  return `<header class="top"><h1>${esc(title)}<span class="dot"></span></h1>${sub ? `<div class="sub">${sub}</div>` : ''}</header>`;
}

function banner(id, cls, html) {
  if (state.hidden.has(id)) return '';
  return `<div class="banner ${cls}" data-banner="${id}"><div>${html}</div><button class="x" aria-label="收埋">×</button></div>`;
}
function bindBanners(el) {
  el.querySelectorAll('[data-banner] .x').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.parentElement.dataset.banner;
      state.hidden.add(id);
      localStorageSet('hiddenBanners', JSON.stringify([...state.hidden]));
      b.parentElement.remove();
    }),
  );
}

function card(item) {
  const proc = item.status === 'processing' || item.status === 'classifying';
  const badge = item.status === 'processing' ? '<span class="badge">去背中…</span>'
    : item.status === 'classifying' ? '<span class="badge">認緊…</span>'
    : item.status === 'error' ? '<span class="badge warn">要補資料</span>'
    : item.status === 'unsorted' ? '<span class="badge warn">揀類別</span>' : '';
  return `<button class="card ${proc ? 'processing' : ''}" data-id="${item.id}">
    ${item.thumb ? `<img src="${thumbUrl(item)}" alt="${esc(item.name)}" loading="lazy">` : ''}
    ${badge}${item.fav ? '<span class="fav">♥</span>' : ''}
    <span class="lbl">${esc(item.name || item.type || '')}</span></button>`;
}

function seasonOk(item) {
  return !state.filterSeason || !item.seasons?.length || item.seasons.includes(state.filterSeason);
}

async function viewCloset(main) {
  const items = state.items;
  const count = items.filter((i) => i.status !== 'processing').length;
  let html = header('我的衣櫃', count ? `${count} 件` : '');
  if (isIOS && !standalone) {
    html += banner('a2hs', '', '<b>先加去主畫面再用：</b>Safari 底部「分享」→「加至主畫面」。之後由主畫面個 icon 開。<br>⚠️ 喺 Safari 入面加嘅衫，主畫面版睇唔到（兩邊資料分開）。');
  }
  const last = await db.kvGet('lastBackup');
  if (count >= 10 && (!last || Date.now() - last > 30 * 864e5)) {
    html += `<div class="banner warn"><div>📦 已經 ${last ? '超過一個月' : '未'}備份。換手機或者 iPhone 清空間都可能會唔見晒啲相，<b>去「設定」匯出備份</b>啦。</div></div>`;
  }
  if (!items.length) {
    html += `<div class="empty"><div class="big">👗</div><h3>衣櫃仲係空嘅</h3>
      <p>撳下面粉紅色相機掣，逐件衫影相</p>
      <p class="muted">小貼士：將件衫平鋪喺淨色床單上，光線充足，由正上方影</p></div>`;
    main.innerHTML = html;
    bindBanners(main);
    return;
  }
  const counts = {};
  for (const i of items) counts[i.category || '未分類'] = (counts[i.category || '未分類'] || 0) + 1;
  const cats = [...CATEGORIES.filter((c) => counts[c]), ...(counts['未分類'] ? ['未分類'] : [])];
  html += `<div class="chips">
    <button class="chip ${!state.filterCat ? 'on' : ''}" data-cat="">全部</button>
    ${cats.map((c) => `<button class="chip ${state.filterCat === c ? 'on' : ''}" data-cat="${c}">${c}<span class="n">${counts[c]}</span></button>`).join('')}
  </div>
  <div class="chips" style="padding-top:0">
    ${SEASONS.map((s) => `<button class="chip season ${state.filterSeason === s ? 'on' : ''}" data-season="${s}">${s}</button>`).join('')}
  </div>`;
  const vis = items.filter(seasonOk);
  if (!state.filterCat) {
    for (const c of cats) {
      const list = vis.filter((i) => (i.category || '未分類') === c);
      if (!list.length) continue;
      html += `<section class="shelf"><div class="shelf-h"><h2>${c}<small>${list.length}</small></h2><button data-cat="${c}">睇晒 ›</button></div>
        <div class="rail">${list.map(card).join('')}</div></section>`;
    }
  } else {
    const list = vis.filter((i) => (i.category || '未分類') === state.filterCat);
    html += list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<div class="empty"><p>呢個季節冇呢類衫</p></div>';
  }
  main.innerHTML = html;
  bindBanners(main);
  main.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    state.filterCat = b.dataset.cat || null;
    render();
  }));
  main.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
    state.filterSeason = state.filterSeason === b.dataset.season ? null : b.dataset.season;
    render();
  }));
  main.querySelectorAll('.card[data-id]').forEach((b) => b.addEventListener('click', () => openItem(b.dataset.id)));
}

// ---------------- 配衫 ----------------
function slots() {
  const base = state.outfitDress
    ? [{ key: 'dress', label: '連身裙', cats: ['連身裙'], optional: false }]
    : [
        { key: 'top', label: '上衣', cats: ['上衣'], optional: false },
        { key: 'bottom', label: '下身', cats: ['褲', '裙'], optional: false },
      ];
  return [
    { key: 'outer', label: '外套', cats: ['外套'], optional: true },
    ...base,
    { key: 'shoes', label: '鞋', cats: ['鞋'], optional: true },
    { key: 'bag', label: '袋', cats: ['袋'], optional: true },
  ];
}

function viewOutfit(main) {
  const ready = state.items.filter((i) => i.category && i.thumb);
  let html = header('配衫', '左右碌揀衫，正中間嗰件就係揀咗');
  html += `<div class="chips" style="padding-top:0">
      ${SEASONS.map((s) => `<button class="chip season ${state.filterSeason === s ? 'on' : ''}" data-season="${s}">${s}</button>`).join('')}
    </div>
    <div class="outfit-tools">
      <button class="btn ghost" id="dressToggle">${state.outfitDress ? '👚 上衣＋下身' : '👗 連身裙'}</button>
      <button class="btn ghost" id="shuffle">🎲 隨機</button>
      <button class="btn primary" id="saveOutfit" style="margin-left:auto">♡ 儲存</button>
    </div>`;
  for (const s of slots()) {
    const list = ready.filter((i) => s.cats.includes(i.category) && seasonOk(i));
    html += `<div class="slot" data-slot="${s.key}"><div class="slot-h"><span>${s.label}</span><span class="cnt"></span></div>`;
    if (!list.length) {
      html += `<div class="carousel empty-row"><div class="muted">未有${s.label}${s.optional ? '' : '，影多幾件先'}</div></div></div>`;
      continue;
    }
    const picks = (s.optional ? ['<div class="pick" data-id=""><div class="none">唔要</div></div>'] : [])
      .concat(list.map((i) => `<div class="pick" data-id="${i.id}"><img src="${thumbUrl(i)}" alt=""></div>`));
    html += `<div class="carousel">${picks.join('')}</div></div>`;
  }
  main.innerHTML = html;

  main.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
    state.filterSeason = state.filterSeason === b.dataset.season ? null : b.dataset.season;
    render();
  }));
  $('#dressToggle').addEventListener('click', () => { state.outfitDress = !state.outfitDress; render(); });

  const carousels = [...main.querySelectorAll('.slot')].filter((s) => $('.carousel:not(.empty-row)', s));
  const centerOf = (car) => {
    const r = car.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    let best = null, bd = Infinity;
    car.querySelectorAll('.pick').forEach((p) => {
      const pr = p.getBoundingClientRect();
      const d = Math.abs(pr.left + pr.width / 2 - mid);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  };
  const update = (slot) => {
    const car = $('.carousel', slot);
    const cur = centerOf(car);
    car.querySelectorAll('.pick').forEach((p) => p.classList.toggle('cur', p === cur));
    state.outfitSel[slot.dataset.slot] = cur?.dataset.id || '';
  };
  const scrollTo = (car, pick, smooth) => {
    car.scrollTo({ left: pick.offsetLeft - (car.clientWidth - pick.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  for (const slot of carousels) {
    const car = $('.carousel', slot);
    // 記住上次揀嘅
    const prev = state.outfitSel[slot.dataset.slot];
    const pick = (prev != null && car.querySelector(`.pick[data-id="${prev}"]`)) || car.querySelector('.pick[data-id]:not([data-id=""])') || car.querySelector('.pick');
    requestAnimationFrame(() => { scrollTo(car, pick, false); update(slot); });
    let t;
    car.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => update(slot), 80); }, { passive: true });
    car.querySelectorAll('.pick').forEach((p) => p.addEventListener('click', () => scrollTo(car, p, true)));
  }
  $('#shuffle').addEventListener('click', () => {
    for (const slot of carousels) {
      const car = $('.carousel', slot);
      const picks = [...car.querySelectorAll('.pick')];
      scrollTo(car, picks[Math.floor(Math.random() * picks.length)], true);
    }
  });
  $('#saveOutfit').addEventListener('click', async () => {
    const ids = slots().map((s) => state.outfitSel[s.key]).filter((id) => id && carousels.some((c) => c.dataset.slot && $(`.pick[data-id="${id}"]`, c)));
    if (ids.length < 1) return toast('揀咗衫先儲存');
    await db.put('outfits', { id: db.uid(), created: Date.now(), itemIds: ids });
    await reload();
    toast('已儲存去「我的配搭」♥');
  });
}

function viewSaved(main) {
  let html = header('我的配搭', state.outfits.length ? `${state.outfits.length} 套` : '');
  if (!state.outfits.length) {
    html += '<div class="empty"><div class="big">💕</div><h3>未有儲存嘅配搭</h3><p>去「配衫」揀好之後撳「♡ 儲存」</p></div>';
    main.innerHTML = html;
    return;
  }
  const byId = new Map(state.items.map((i) => [i.id, i]));
  html += '<div class="outfits">' + state.outfits.map((o) => {
    const its = o.itemIds.map((id) => byId.get(id)).filter(Boolean);
    return `<button class="ocard" data-id="${o.id}"><div class="collage">${its.slice(0, 4).map((i) => `<img src="${thumbUrl(i)}" alt="">`).join('')}</div>
      <div class="when">${new Date(o.created).toLocaleDateString('zh-HK')}</div></button>`;
  }).join('') + '</div>';
  main.innerHTML = html;
  main.querySelectorAll('.ocard').forEach((b) => b.addEventListener('click', () => openOutfit(b.dataset.id)));
}

function openOutfit(id) {
  const o = state.outfits.find((x) => x.id === id);
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const its = o.itemIds.map((i) => byId.get(i)).filter(Boolean);
  const ov = sheet(`<h3>配搭</h3>
    <div class="grid" style="padding:0">${its.map(card).join('')}</div>
    <div class="row" style="margin-top:16px">
      <button class="btn ghost" id="wear">著呢套去配衫</button>
      <button class="btn danger" id="delO">刪除</button>
    </div>`);
  $('#wear', ov).addEventListener('click', () => {
    const map = { '外套': 'outer', '上衣': 'top', '褲': 'bottom', '裙': 'bottom', '連身裙': 'dress', '鞋': 'shoes', '袋': 'bag' };
    state.outfitSel = { outer: '', shoes: '', bag: '' };
    state.outfitDress = its.some((i) => i.category === '連身裙');
    for (const i of its) if (map[i.category]) state.outfitSel[map[i.category]] = i.id;
    closeSheet(ov);
    go('outfit');
  });
  $('#delO', ov).addEventListener('click', async () => {
    await db.del('outfits', id);
    await reload();
    closeSheet(ov);
    render();
  });
}

// ---------------- sheet ----------------
function sheet(inner) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet"><div class="grab"></div>${inner}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(ov); });
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  return ov;
}
function closeSheet(ov) {
  ov.remove();
  if (!document.querySelector('.overlay')) document.body.style.overflow = '';
}

// ---------------- 單件衫 ----------------
async function openItem(id) {
  const item = await db.get('items', id);
  if (!item) return;
  const useClaude = await claudeOn();
  const url = item.cutout ? URL.createObjectURL(item.cutout) : '';
  const cats = [...CATEGORIES];
  const ov = sheet(`
    <div class="hero">${url ? `<img src="${url}" alt="">` : '<div class="muted">處理緊…</div>'}</div>
    ${item.status === 'error' && item.error ? `<p class="err">認唔到：${esc(item.error)}</p>` : ''}
    <div class="field"><label>名</label><input class="input" id="fName" value="${esc(item.name || '')}" placeholder="例如：米白色冷衫"></div>
    <div class="field"><label ${item.category ? '' : 'style="color:var(--pink)"'}>${item.category ? '類別' : '類別（揀一個）'}</label><div class="chips" id="fCat">${cats.map((c) => `<button class="chip ${item.category === c ? 'on' : ''}" data-v="${c}">${c}</button>`).join('')}</div></div>
    <div class="field"><label>細分類</label><input class="input" id="fType" value="${esc(item.type || '')}" placeholder="例如：T恤、牛仔褲"></div>
    <div class="field"><label>季節（唔揀 = 四季都啱）</label><div class="chips" id="fSeason">${SEASONS.map((s) => `<button class="chip season ${item.seasons?.includes(s) ? 'on' : ''}" data-v="${s}">${s}</button>`).join('')}</div></div>
    ${item.colors?.length ? `<div class="field"><label>顏色</label><div class="swatches">${item.colors.map((c) => `<span class="sw"><i style="background:${/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#ccc'}"></i>${esc(c.name)}</span>`).join('')}</div></div>` : ''}
    <div class="field"><label>標籤（用逗號分開）</label><input class="input" id="fTags" value="${esc((item.tags || []).join('、'))}"></div>
    <div class="row" style="margin-top:6px">
      <button class="btn ghost" id="fFav">${item.fav ? '♥ 已最愛' : '♡ 最愛'}</button>
      <button class="btn ghost" id="fEdit">✏️ 修邊</button>
      ${useClaude ? '<button class="btn ghost" id="fAgain">✨ Claude 再認</button>' : ''}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn danger" id="fDel">刪除</button>
      <button class="btn primary" id="fSave">儲存</button>
    </div>`);
  const close = () => { if (url) URL.revokeObjectURL(url); closeSheet(ov); };
  let cat = item.category;
  const seasons = new Set(item.seasons || []);
  $('#fCat', ov).querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.v;
    $('#fCat', ov).querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#fSeason', ov).querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    seasons.has(b.dataset.v) ? seasons.delete(b.dataset.v) : seasons.add(b.dataset.v);
    b.classList.toggle('on');
  }));
  const collect = () => ({
    ...item,
    name: $('#fName', ov).value.trim(),
    type: $('#fType', ov).value.trim(),
    category: cat,
    seasons: SEASONS.filter((s) => seasons.has(s)),
    tags: $('#fTags', ov).value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
    status: cat ? 'ready' : item.status,
  });
  // 冇改名：用「顏色＋細分類／類別」自動改
  const autoName = (it) => ({ ...it, name: it.name || `${it.colors?.[0]?.name || ''}${it.type || it.category || ''}` });
  $('#fFav', ov).addEventListener('click', (e) => {
    item.fav = !item.fav;
    e.target.textContent = item.fav ? '♥ 已最愛' : '♡ 最愛';
  });
  $('#fSave', ov).addEventListener('click', async () => {
    const latest = await db.get('items', id);
    if (!cat) return toast('揀一個類別先');
    await db.put('items', autoName({ ...collect(), thumb: latest.thumb, cutout: latest.cutout, mask: latest.mask, colors: latest.colors }));
    await reload();
    close();
    render();
  });
  $('#fDel', ov).addEventListener('click', async () => {
    if (!confirm('確定刪除呢件？')) return;
    await db.del('items', id);
    const u = state.urls.get(id);
    if (u) URL.revokeObjectURL(u.url);
    state.urls.delete(id);
    await reload();
    close();
    render();
  });
  $('#fEdit', ov).addEventListener('click', async () => {
    if (!item.orig) return toast('呢件冇原相，修唔到');
    const src = await seg.loadImage(item.orig, 4000);
    const mask = item.mask ? await seg.blobToMask(item.mask, src.width, src.height) : new Uint8ClampedArray(src.width * src.height).fill(255);
    const edited = await openMaskEditor(src, mask);
    if (!edited) return;
    const updated = await saveCutout(item, src, edited);
    if (!updated) return toast('成件擦晒喎，冇儲存');
    await db.put('items', { ...collect(), cutout: updated.cutout, thumb: updated.thumb, mask: updated.mask, colors: updated.colors });
    await reload();
    close();
    render();
    toast('修好咗 ✨');
  });
  $('#fAgain', ov)?.addEventListener('click', async () => {
    await db.put('items', collect());
    close();
    classifyItem(id, true);
  });
}

// ---------------- 加衫流程 ----------------
async function saveCutout(item, src, mask) {
  const cut = seg.cutout(src, mask);
  if (!cut) return null;
  const big = seg.scaled(cut, 1000);
  return {
    colors: dominantColors(cut),
    cutout: await seg.canvasToBlob(big, 'image/png'),
    thumb: await seg.canvasToBlob(seg.scaled(cut, 360), 'image/png'),
    mask: await seg.canvasToBlob(seg.maskToCanvas(mask, src.width, src.height), 'image/png'),
  };
}

const queue = [];
let busy = false;

async function onFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) return;
  for (const f of list) {
    const item = { id: db.uid(), created: Date.now(), status: 'processing', name: '', category: null, seasons: [], tags: [], colors: [] };
    await db.put('items', item);
    queue.push({ id: item.id, file: f });
  }
  await reload();
  state.filterCat = null;
  go('closet');
  runQueue();
}

async function runQueue() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await processJob(job);
      } catch (e) {
        console.error(e);
        await db.del('items', job.id);
        toast('處理唔到張相：' + (e.message || e), 4000);
      }
      await reload();
      if (state.tab === 'closet') render();
    }
  } finally {
    busy = false;
    progress(null);
  }
}

async function processJob({ id, file }) {
  const src = await seg.loadImage(file, 1600);
  const mode = (await db.kvGet('segMode')) || 'ai';
  let mask = null;
  if (mode === 'ai') {
    try {
      const cached = await seg.isModelCached();
      if (!cached) progress('第一次要下載 AI 去背模型（約 44MB，建議用 Wi-Fi）', 0);
      mask = await seg.aiMask(src, (f) => { if (!cached) progress(`下載去背模型… ${Math.round(f * 100)}%`, f); });
      progress(null);
    } catch (e) {
      console.warn('AI 去背失敗，用快速模式', e);
      progress(null);
      toast('AI 去背用唔到，改用快速模式', 3000);
    }
  }
  if (!mask) mask = seg.quickMask(src);
  // 搵唔到主體：當成件相係件衫
  if (seg.maskCoverage(mask) < 0.01) mask = new Uint8ClampedArray(src.width * src.height).fill(255);
  const out = await saveCutout({}, src, mask);
  const orig = await seg.canvasToBlob(src, 'image/jpeg', 0.88);
  const item = await db.get('items', id);
  if (await claudeOn()) {
    await db.put('items', { ...item, ...out, orig, status: 'classifying' });
    await reload();
    if (state.tab === 'closet') render();
    classifyItem(id);
  } else {
    // 免費模式：顏色已經自動計好，類別由佢自己揀
    await db.put('items', { ...item, ...out, orig, status: 'unsorted' });
    await reload();
    if (state.tab === 'closet') render();
    if (!queue.length && !document.querySelector('.overlay, .editor')) openItem(id);
  }
}

const classifying = new Set();
async function classifyItem(id, manual = false) {
  if (classifying.has(id)) return;
  classifying.add(id);
  try {
    let item = await db.get('items', id);
    await db.put('items', { ...item, status: 'classifying' });
    await reload();
    if (state.tab === 'closet') render();
    // 送去 Claude 嘅只係縮細咗嘅白底衫相
    const cut = await seg.loadImage(item.cutout, 512);
    const jpg = await seg.canvasToBlob(seg.scaled(cut, 512, '#ffffff'), 'image/jpeg', 0.85);
    const r = await classify(jpg);
    item = await db.get('items', id);
    if (!item) return;
    await db.put('items', {
      ...item,
      status: 'ready',
      error: '',
      category: CATEGORIES.includes(r.category) ? r.category : item.category,
      type: r.type,
      name: r.name,
      colors: r.colors.slice(0, 3),
      seasons: SEASONS.filter((x) => r.seasons.includes(x)),
      tags: r.tags.slice(0, 4),
    });
    if (!r.is_clothing) toast('Claude 覺得呢張唔似衫，可以撳入去改', 3500);
    else if (manual) toast('認好咗：' + r.name);
  } catch (e) {
    console.error(e);
    const item = await db.get('items', id);
    if (item) await db.put('items', { ...item, status: 'error', error: friendlyError(e) });
    if (e instanceof NoKeyError) toast('未入 API key，件衫已經入咗衣櫃，入好 key 再撳「再認」', 4500);
    else toast('認衫失敗：' + friendlyError(e), 4000);
  } finally {
    classifying.delete(id);
    await reload();
    if (state.tab === 'closet') render();
  }
}

// ---------------- 設定 ----------------
async function viewSettings(main) {
  const key = (await db.kvGet('apiKey')) || '';
  const model = (await db.kvGet('model')) || DEFAULT_MODEL;
  const segMode = (await db.kvGet('segMode')) || 'ai';
  const useClaudeSetting = (await db.kvGet('useClaude')) === true;
  const last = await db.kvGet('lastBackup');
  let est = null, persisted = false;
  try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch (_) {}
  const mb = (n) => (n / 1048576).toFixed(n > 1e8 ? 0 : 1) + ' MB';
  const modelCached = await seg.isModelCached();
  main.innerHTML = header('設定') + `
    <section class="panel">
      <h3>🤖 Claude 自動認衫（選用，要錢）</h3>
      <p class="muted">預設關咗，完全免費：影完相自動去背同計顏色，類別同季節自己揀。開咗就會用 Claude 自動認，要 API key，每件約 HK$0.005 至 0.1。</p>
      <label class="row" style="align-items:center;margin:10px 0;font-weight:600"><span>用 Claude 自動認衫</span>
        <input type="checkbox" id="useClaude" ${useClaudeSetting ? 'checked' : ''} style="flex:0 0 auto;width:24px;height:24px;accent-color:var(--pink)"></label>
      <p class="muted">API key 只會儲喺呢部手機。每件衫只送一張縮細咗、去咗背景嘅衫相俾 Claude，唔會送原相。</p>
      <input class="input" id="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(key)}">
      <div class="row">
        <button class="btn primary" id="saveKey">儲存</button>
        <button class="btn ghost" id="testKey">測試</button>
        ${key ? '<button class="btn danger" id="delKey">清除</button>' : ''}
      </div>
      <p class="muted" id="keyMsg"></p>
      <div class="field"><label>認衫模型</label>
        <select class="input" id="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === model ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      </div>
      <button class="btn ghost block" id="retryAll">✨ 用 Claude 認晒未分類嘅衫</button>
    </section>
    <section class="panel">
      <h3>✂️ 去背方式</h3>
      <select class="input" id="segMode" style="margin-top:8px">
        <option value="ai" ${segMode === 'ai' ? 'selected' : ''}>AI 去背（準，喺手機本機行）</option>
        <option value="quick" ${segMode === 'quick' ? 'selected' : ''}>快速（只啱淨色背景）</option>
      </select>
      <p class="muted">${modelCached ? '✅ AI 模型已經下載好，可以離線用' : 'AI 模型第一次用會下載約 44MB'}</p>
    </section>
    <section class="panel">
      <h3>📦 備份</h3>
      <p class="muted">相同資料只喺呢部手機。換手機、刪咗 App、或者 iPhone 空間唔夠時都可能會唔見，記得定期匯出，存去「檔案」或 iCloud Drive。</p>
      <p class="muted">上次備份：${last ? new Date(last).toLocaleDateString('zh-HK') : '未試過'}</p>
      <div class="row">
        <button class="btn dark" id="export">匯出備份</button>
        <button class="btn ghost" id="import">匯入備份</button>
      </div>
      <input type="file" id="importFile" accept=".zip,application/zip" hidden>
    </section>
    <section class="panel">
      <h3>💾 儲存空間</h3>
      ${est ? `<p class="muted">已用 ${mb(est.usage || 0)}${est.quota ? `／可用約 ${mb(est.quota)}` : ''}</p>
        <div class="meter"><i style="width:${est.quota ? Math.min(100, (100 * (est.usage || 0)) / est.quota) : 0}%"></i></div>` : ''}
      <p class="muted">${persisted ? '✅ 已鎖定儲存，系統唔會自動清走' : '未鎖定儲存'}</p>
      ${persisted ? '' : '<button class="btn ghost" id="persist">鎖定儲存空間</button>'}
    </section>
    <p class="muted" style="text-align:center;margin:18px">衣櫃 v__VERSION__ · 相片唔會上傳</p>`;

  $('#saveKey').addEventListener('click', async () => {
    const v = $('#key').value.trim();
    if (v && !v.startsWith('sk-ant-')) { $('#keyMsg').textContent = '個 key 應該係 sk-ant- 開頭'; return; }
    await db.kvSet('apiKey', v);
    $('#keyMsg').textContent = v ? '已儲存 ✅' : '已清除';
  });
  $('#testKey').addEventListener('click', async () => {
    const v = $('#key').value.trim();
    if (!v) return;
    $('#keyMsg').textContent = '測試緊…';
    try { await testKey(v); $('#keyMsg').textContent = '✅ 個 key 用得'; } catch (e) { $('#keyMsg').textContent = '❌ ' + friendlyError(e); }
  });
  $('#delKey')?.addEventListener('click', async () => { await db.kvDel('apiKey'); render(); });
  $('#useClaude').addEventListener('change', async (e) => {
    await db.kvSet('useClaude', e.target.checked);
    if (e.target.checked && !(await db.kvGet('apiKey'))) toast('記得喺下面入 API key');
  });
  $('#model').addEventListener('change', (e) => db.kvSet('model', e.target.value));
  $('#segMode').addEventListener('change', (e) => db.kvSet('segMode', e.target.value));
  $('#retryAll').addEventListener('click', async () => {
    if (!(await claudeOn())) return toast('要先開「用 Claude 自動認衫」同入 key');
    const bad = state.items.filter((i) => i.status === 'error' || i.status === 'unsorted');
    if (!bad.length) return toast('冇要補資料嘅衫');
    toast(`再認緊 ${bad.length} 件…`);
    for (const i of bad) await classifyItem(i.id);
  });
  $('#persist')?.addEventListener('click', async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? '已鎖定 ✅' : (isIOS && !standalone ? '要喺主畫面版先鎖到' : '系統暫時唔俾，加去主畫面再試'));
    render();
  });
  $('#export').addEventListener('click', async () => {
    try {
      progress('整緊備份…', 0);
      const file = await buildBackup((f) => progress('整緊備份…', f));
      progress(null);
      // iPhone 要用戶再撳一下先可以開分享表
      const ov = sheet(`<h3>備份整好咗 📦</h3>
        <p class="muted">${esc(file.name)}（${(file.size / 1048576).toFixed(1)} MB）</p>
        <p class="muted">撳下面個掣，揀「儲存到檔案」，建議存去 iCloud Drive。</p>
        <button class="btn primary block" id="doSave">儲存備份檔</button>`);
      $('#doSave', ov).addEventListener('click', async () => {
        try {
          await saveFile(file);
          await db.kvSet('lastBackup', Date.now());
          closeSheet(ov);
          toast('備份完成 ✅');
          render();
        } catch (err) {
          if (err?.name !== 'AbortError') toast('儲存失敗：' + (err.message || err), 4000);
        }
      });
    } catch (e) {
      progress(null);
      if (e?.name !== 'AbortError') toast('匯出失敗：' + (e.message || e), 4000);
    }
  });
  $('#import').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      progress('匯入緊…', null);
      const n = await importBackup(f);
      await reload();
      progress(null);
      toast(`匯入咗 ${n} 件衫 ✅`);
      render();
    } catch (err) {
      progress(null);
      toast('匯入失敗：' + (err.message || err), 4000);
    }
  });
}

// ---------------- 啟動 ----------------
async function start() {
  $('#fileInput').addEventListener('change', (e) => {
    const files = e.target.files;
    onFiles(files).finally(() => (e.target.value = ''));
  });
  await reload();
  // 上次未處理完（例如 App 被關咗）：去背中嘅冇原相就刪，認緊嘅就再認
  for (const i of state.items) {
    if (i.status === 'processing') await db.del('items', i.id);
    else if (i.status === 'classifying') {
      if (await claudeOn()) classifyItem(i.id);
      else await db.put('items', { ...i, status: 'unsorted' });
    }
  }
  await reload();
  render();
  if (standalone) navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
