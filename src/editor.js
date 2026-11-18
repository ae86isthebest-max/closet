// 手動修邊：一隻手指 = 擦走／補返；兩隻手指 = 放大、移動
// P 圖功能之後都可以用同一個 editor
import { makeCanvas } from './segment.js';

export function openMaskEditor(source, mask) {
  return new Promise((resolve) => {
    const w = source.width;
    const h = source.height;
    // maskCanvas：alpha = mask
    const maskCanvas = makeCanvas(w, h);
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const mimg = mctx.createImageData(w, h);
    for (let j = 0, i = 0; j < mask.length; j++, i += 4) {
      mimg.data[i] = mimg.data[i + 1] = mimg.data[i + 2] = 255;
      mimg.data[i + 3] = mask[j];
    }
    mctx.putImageData(mimg, 0, 0);

    const root = document.createElement('div');
    root.className = 'editor';
    root.innerHTML = `
      <div class="bar-top">
        <button class="cancel">取消</button>
        <b>修邊</b>
        <button class="done">完成</button>
      </div>
      <div class="stage"><canvas></canvas></div>
      <div class="tools">
        <div class="modes">
          <button class="erase on" data-m="erase">擦走</button>
          <button class="restore" data-m="restore">補返</button>
          <button class="undo" style="flex:0 0 72px">復原</button>
        </div>
        <input type="range" min="6" max="120" value="36" aria-label="筆刷大小">
        <div class="hint">一隻手指塗；兩隻手指放大／移動</div>
      </div>`;
    document.body.appendChild(root);
    const stage = root.querySelector('.stage');
    const view = root.querySelector('canvas');
    const vctx = view.getContext('2d');
    const tmp = makeCanvas(w, h);
    const tctx = tmp.getContext('2d');
    view.width = w;
    view.height = h;

    let mode = 'erase';
    let size = 36;
    const undo = [];
    // 視圖變換
    let scale = 1, tx = 0, ty = 0;
    function fit() {
      const r = stage.getBoundingClientRect();
      scale = Math.min(r.width / w, r.height / h) * 0.94;
      tx = -w * scale / 2;
      ty = -h * scale / 2;
      apply();
    }
    function apply() {
      view.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    let raf = 0;
    function render() {
      raf = 0;
      // 背景：原相淡化 + 粉紅色，等佢知邊啲已經擦咗
      vctx.clearRect(0, 0, w, h);
      vctx.globalAlpha = 1;
      vctx.fillStyle = '#3a312c';
      vctx.fillRect(0, 0, w, h);
      vctx.globalAlpha = 0.35;
      vctx.drawImage(source, 0, 0);
      vctx.globalAlpha = 0.18;
      vctx.fillStyle = '#ff6f91';
      vctx.fillRect(0, 0, w, h);
      vctx.globalAlpha = 1;
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, w, h);
      tctx.drawImage(maskCanvas, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.drawImage(source, 0, 0);
      vctx.drawImage(tmp, 0, 0);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

    function toImg(cx, cy) {
      const r = stage.getBoundingClientRect();
      const x = (cx - r.left - r.width / 2 - tx) / scale;
      const y = (cy - r.top - r.height / 2 - ty) / scale;
      return [x, y];
    }
    function dab(x, y) {
      const rad = size / scale / 2 * (window.devicePixelRatio > 1 ? 1 : 1);
      const g = mctx.createRadialGradient(x, y, rad * 0.6, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      mctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
      mctx.fillStyle = g;
      mctx.beginPath();
      mctx.arc(x, y, rad, 0, Math.PI * 2);
      mctx.fill();
    }
    function line(a, b) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const step = Math.max(1, size / scale / 6);
      for (let t = 0; t <= d; t += step) {
        dab(a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d);
      }
      if (d === 0) dab(b[0], b[1]);
      schedule();
    }

    const pts = new Map();
    let painting = false;
    let last = null;
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        painting = true;
        undo.push(mctx.getImageData(0, 0, w, h));
        if (undo.length > 8) undo.shift();
        last = toImg(e.clientX, e.clientY);
        line(last, last);
      } else if (pts.size === 2) {
        // 第二隻手指落嚟：取消啱啱嗰下塗
        if (painting && undo.length) {
          mctx.putImageData(undo.pop(), 0, 0);
          schedule();
        }
        painting = false;
        const [p1, p2] = [...pts.values()];
        pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), mx: (p1[0] + p2[0]) / 2, my: (p1[1] + p2[1]) / 2, scale, tx, ty };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (painting && pts.size === 1) {
        const p = toImg(e.clientX, e.clientY);
        line(last, p);
        last = p;
      } else if (pinch && pts.size === 2) {
        const [p1, p2] = [...pts.values()];
        const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        const mx = (p1[0] + p2[0]) / 2;
        const my = (p1[1] + p2[1]) / 2;
        const r = stage.getBoundingClientRect();
        const ns = Math.max(0.2, Math.min(12, pinch.scale * (d / pinch.d)));
        // 以兩指中間為中心縮放
        const cx = pinch.mx - r.left - r.width / 2;
        const cy = pinch.my - r.top - r.height / 2;
        tx = cx - ((cx - pinch.tx) * ns) / pinch.scale + (mx - pinch.mx);
        ty = cy - ((cy - pinch.ty) * ns) / pinch.scale + (my - pinch.my);
        scale = ns;
        apply();
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) painting = false;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    root.querySelectorAll('.modes [data-m]').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.m;
        root.querySelectorAll('.modes [data-m]').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    root.querySelector('.undo').addEventListener('click', () => {
      if (undo.length) {
        mctx.putImageData(undo.pop(), 0, 0);
        schedule();
      }
    });
    root.querySelector('input[type=range]').addEventListener('input', (e) => (size = +e.target.value));

    function close(result) {
      root.remove();
      window.removeEventListener('resize', fit);
      resolve(result);
    }
    root.querySelector('.cancel').addEventListener('click', () => close(null));
    root.querySelector('.done').addEventListener('click', () => {
      const d = mctx.getImageData(0, 0, w, h).data;
      const out = new Uint8ClampedArray(w * h);
      for (let j = 0, i = 3; j < out.length; j++, i += 4) out[j] = d[i];
      close(out);
    });

    window.addEventListener('resize', fit);
    fit();
    render();
  });
}
