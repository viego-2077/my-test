(function () {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Trang này không có API camera (thường do không phải HTTPS).');
    return;
  }
  if (window.__vcamLoaded) return;
  window.__vcamLoaded = true;

  const S = { mode: 'media', scale: 1, offX: 0, offY: 0, fps: 30 };
  const origGUM = window.__vcamOrigGUM || navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  // ---------- Canvas: 1 track duy nhất cho cả phiên ----------
  const cv = document.createElement('canvas');
  cv.width = 1280; cv.height = 720;
  const ctx = cv.getContext('2d', { alpha: false, desynchronized: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  const out = cv.captureStream();

  const hidden = (el) => { el.style.cssText = 'position:fixed;bottom:0;left:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1'; document.body.appendChild(el); return el; };
  const vid = hidden(Object.assign(document.createElement('video'),
    { crossOrigin: 'anonymous', loop: true, muted: true, autoplay: true, playsInline: true }));
  const cam = hidden(Object.assign(document.createElement('video'),
    { muted: true, autoplay: true, playsInline: true }));
  let img = null, frozen = null, camStream = null, hasMedia = false, objUrl = null;

  let camPromise = null, relTimer = null, gen = 0;
  const GRACE_MS = 0;

  function ensureCam() {
    clearTimeout(relTimer);
    if (camPromise) return camPromise;
    camPromise = (async () => {
      const g = gen;
      const st = await origGUM({ video: true });
      if (g !== gen) { st.getTracks().forEach((t) => t.stop()); throw new Error('cancelled'); }
      camStream = st;
      cam.srcObject = camStream;
      cam.play().catch(() => {});
    })().catch((e) => { camPromise = null; throw e; });
    return camPromise;
  }

  function releaseCam() {
    gen++;
    clearTimeout(relTimer);
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null; camPromise = null;
    cam.srcObject = null;
  }
  const scheduleRelease = () => { clearTimeout(relTimer); relTimer = setTimeout(() => { if (S.mode !== 'real') releaseCam(); }, GRACE_MS); };

  function source() {
    if (S.mode === 'real') return frozen || (cam.videoWidth ? cam : null);
    if (img) return img;
    return vid.videoWidth ? vid : null;
  }

  function draw() {
    if (gif) tickGif();
    const s = source();
    if (!s) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const w = s.videoWidth || s.naturalWidth || s.width;
    const h = s.videoHeight || s.naturalHeight || s.height;
    if (!w || !h) return;
    const base = Math.min(cv.width / w, cv.height / h);
    ctx.translate(cv.width / 2 + S.offX, cv.height / 2 + S.offY);
    ctx.scale(base * S.scale, base * S.scale);
    ctx.drawImage(s, -w / 2, -h / 2);
  }

  const gifEl = document.createElement('img');
  gifEl.style.cssText = 'position:fixed;bottom:0;left:0;width:32px;height:32px;opacity:.02;pointer-events:none;z-index:-1';
  document.body.appendChild(gifEl);

  let gif = null, loadTok = 0;
  function tickGif() {
    const t = (performance.now() - gif.t0) % gif.total;
    let acc = 0;
    for (const f of gif.frames) { acc += f.dur; if (t < acc) { img = f.bmp; return; } }
  }
  function dropImg() {
    if (gif) { gif.frames.forEach((f) => f.bmp.close()); gif = null; }
    else if (img && img.close) img.close();
    img = null;
    gifEl.removeAttribute('src');
  }
  async function decodeGif(f, tok) {
    const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount;
    const frames = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const dur = Math.max(20, (image.duration || 100000) / 1000);
      frames.push({ bmp: await createImageBitmap(image), dur });
      image.close();
      total += dur;
      if (tok !== loadTok) { frames.forEach((x) => x.bmp.close()); return null; }
    }
    return { frames, total, t0: performance.now() };
  }

  let timer = null;
  const startLoop = () => { clearInterval(timer); timer = setInterval(draw, 1000 / S.fps); };
  startLoop();

  // ---------- Hook getUserMedia ----------
  navigator.mediaDevices.getUserMedia = async function (c) {
    if (!c || !c.video) return origGUM(c);
    const v = c.video;
    const get = (k) => (v && typeof v === 'object' && v[k] != null)
      ? (typeof v[k] === 'object' ? (v[k].ideal ?? v[k].exact) : v[k]) : undefined;
    const w = +get('width'), h = +get('height');
    if (w > 0 && h > 0 && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
    if (S.mode === 'real') await ensureCam();
    const tracks = [out.getVideoTracks()[0].clone()];
    if (c.audio) {
      try { tracks.push(...(await origGUM({ audio: c.audio })).getAudioTracks()); } catch (e) {}
    }
    return new MediaStream(tracks);
  };
  window.__vcamHooked = navigator.mediaDevices.getUserMedia;

  // ---------- UI SHADOW DOM ISOLATION ----------
  const host = document.createElement('div');
  host.id = 'vcam2-host';
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // CSS đã được làm gọn và loại bỏ @media (pointer:coarse)
  const tpl = `
  <style>
    :host, *, *::before, *::after {
      all: initial;
      box-sizing: border-box;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      line-height: normal;
    }
    #vcam2 {
      --bg:#0d0f18;--card:#151826;--line:#222840;--mut:#7d8aa3;--ac:#00ffcc;
      position:fixed;top:calc(12px + env(safe-area-inset-top,0px));right:12px;width:min(240px,calc(100vw - 24px));
      background:var(--bg);color:#e7ecf5;border-radius:14px;
      border:1px solid var(--line);box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(0,255,204,.06);
      user-select:none;overflow:hidden;transition:opacity .15s;
      display: block;
    }
    #vcam2 div, #vcam2 span, #vcam2 button, #vcam2 input, #vcam2 b, #vcam2 small, #vcam2 a, #vcam2 video {
      display: block;
    }
    #vcam2 .h { touch-action:none;display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:move;font-weight:700;font-size:12px;letter-spacing:.3px; }
    #vcam2 .h .dot { width:8px;height:8px;border-radius:50%;background:var(--ac);box-shadow:0 0 8px var(--ac);flex:none; }
    #vcam2 .h .t { flex:1; display:flex; align-items:baseline; }
    #vcam2 .h .t small { color:var(--mut);font-weight:500;margin-left:4px;display:inline; }
    #vcam2 .ib { width:22px;height:22px;border-radius:7px;border:0;background:transparent;color:var(--mut);cursor:pointer;font-size:15px;line-height:1;text-align:center;padding:0; }
    #vcam2 .ib.tx { width:auto;padding:0 8px;font-size:10px;font-weight:600;line-height:22px; }
    #vcam2 .ib:hover { background:var(--card);color:#fff; }
    #vcam2 .b { padding:0 11px 10px;display:flex;flex-direction:column;gap:8px; }
    #vcam2 .pv { position:relative;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:16/9;border:1px solid var(--line);cursor:grab;touch-action:none; }
    #vcam2 .pv:active { cursor:grabbing; }
    #vcam2 .pv video { width:100%;height:100%;object-fit:contain;pointer-events:none; }
    #vcam2 .live { position:absolute;top:8px;left:8px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;background:rgba(0,0,0,.6);color:var(--ac);backdrop-filter:blur(6px); }
    #vcam2 .hint { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--mut);background:#000;pointer-events:none;text-align:center; }
    #vcam2 .seg { position:relative;display:grid;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:3px; }
    #vcam2 .seg i { position:absolute;top:3px;bottom:3px;left:3px;border-radius:7px;background:var(--ac);transition:transform .2s ease; }
    #vcam2 .seg button { position:relative;z-index:1;border:0;background:transparent;color:var(--mut);font-size:11px;font-weight:600;padding:5px 0;cursor:pointer;transition:color .2s;text-align:center; }
    #vcam2 .seg button.on { color:#06231c; }
    #vcam2 .m2 { grid-template-columns:1fr 1fr; } #vcam2 .m2 i { width:calc(50% - 3px); }
    #vcam2 .m3 { grid-template-columns:repeat(3,1fr); } #vcam2 .m3 i { width:calc(33.333% - 2px); }
    #vcam2 .lb { display:flex;justify-content:space-between;font-size:10px;color:var(--mut);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px; }
    #vcam2 .lb b { color:var(--ac);font-weight:700;text-transform:none;display:inline; }
    #vcam2 .lb span { display:inline; }
    #vcam2 .drop { border:1.5px dashed #2c3556;border-radius:10px;background:var(--card);padding:8px 10px;cursor:pointer;transition:all .15s; }
    #vcam2 .drop:hover,#vcam2 .drop.over { border-color:var(--ac);background:rgba(0,255,204,.05); }
    #vcam2 .empty { display:flex;align-items:center;gap:10px; }
    #vcam2 .empty div { display:flex;flex-direction:column;line-height:1.3; }
    #vcam2 .empty b { font-size:11px;color:#e7ecf5; } #vcam2 .empty span { font-size:10px;color:var(--mut); }
    #vcam2 .file { display:flex;align-items:center;gap:10px; }
    #vcam2 .file .mt { flex:1;min-width:0; }
    #vcam2 .file .mt b { font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e7ecf5; }
    #vcam2 .file .mt span { font-size:10px;color:var(--mut); }
    #vcam2 .file .chg { border:1px solid var(--line);background:var(--bg);color:var(--ac);border-radius:8px;font-size:10px;font-weight:600;padding:4px 8px;cursor:pointer; }
    #vcam2 input[type=range] { width:100%;accent-color:var(--ac);cursor:pointer;margin:0;display:block;appearance:auto; -webkit-appearance: slider-horizontal; }
    #vcam2 .frz { width:100%;border:1px solid var(--line);background:var(--card);color:var(--ac);border-radius:10px;font-size:11px;font-weight:600;padding:8px 0;cursor:pointer;transition:all .15s;text-align:center; }
    #vcam2 .frz:hover { border-color:var(--ac); }
    #vcam2 .frz.on { background:var(--ac);color:#06231c;border-color:var(--ac); }
    #vcam2 .cr { font-size:10px;text-align:center;color:var(--mut);border-top:1px solid var(--line);padding-top:7px; }
    #vcam2 .cr b { color:#e7ecf5;display:inline; }
  </style>
  <div id="vcam2">
    <div class="h" id="v-drag"><span class="t">Motion Virtual Cam</span>
      <button class="ib tx" id="v-reset" title="Đặt lại vị trí & zoom">Đặt lại</button>
      <button class="ib" id="v-min" title="Thu gọn">—</button></div>
    <div class="b" id="v-body">
      <div class="pv" id="v-pv" title="Kéo để di chuyển · Lăn chuột để zoom · Alt+V ẩn/hiện"><video id="v-prev" muted autoplay playsinline></video>
        <span class="live" id="v-live">LIVE</span><div class="hint" id="v-hint">Chưa có nguồn video / ảnh / GIF</div></div>

      <div class="seg m2" id="v-mode"><i></i><button data-m="real">Cam thật</button><button data-m="media" class="on">Video / Ảnh</button></div>

      <div id="v-rsec" style="display:none"><button class="frz" id="v-freeze" type="button">Đóng băng khung hình</button></div>

      <div id="v-sec" style="display:flex;flex-direction:column;gap:8px">
        <div class="drop" id="v-drop">
          <input type="file" id="v-file" accept="video/*,image/*" style="display:none">
          <div class="empty" id="v-empty">
            <div><b>Chọn hoặc kéo thả file</b><span>Video / ảnh / GIF</span></div></div>
          <div class="file" id="v-fileinfo" style="display:none">
            <div class="mt"><b id="v-name"></b><span id="v-meta"></span></div>
            <button class="chg" id="v-change" type="button">Đổi</button></div>
        </div>
        <div><div class="lb"><span>Thu phóng</span><b id="v-sv">1.00×</b></div>
          <input type="range" id="v-scale" min="0.2" max="4" step="0.05" value="1"></div>
      </div>

      <div><div class="lb"><span>FPS</span></div>
        <div class="seg m3" id="v-fps"><i></i><button data-f="15">15</button><button data-f="30" class="on">30</button><button data-f="60">60</button></div></div>

      <div class="cr">Powered by <b>Nguyen Hai Chinh</b></div>
    </div>
  </div>`;

  let tplT = tpl;
  try { if (window.trustedTypes && trustedTypes.createPolicy) tplT = trustedTypes.createPolicy('mvc' + Date.now(), { createHTML: (x) => x }).createHTML(tpl); } catch (e) {}
  const doc = new DOMParser().parseFromString(tplT, 'text/html');
  [...doc.head.childNodes, ...doc.body.childNodes].forEach((n) => shadow.appendChild(document.importNode(n, true)));

  const $ = (id) => shadow.querySelector('#' + id);
  const box = $('vcam2'), prev =$('v-prev');
  prev.muted = true;
  prev.srcObject = new MediaStream([out.getVideoTracks()[0].clone()]);
  prev.play().catch(() => {});

  const place = (seg, idx) => { seg.querySelector('i').style.transform = `translateX(${idx * 100}%)`; };
  function syncUI() {
    const btns = [...$('v-mode').querySelectorAll('button')];
    btns.forEach((b) => b.classList.toggle('on', b.dataset.m === S.mode));
    place($('v-mode'), S.mode === 'real' ? 0 : 1);
    $('v-sec').style.display = S.mode === 'real' ? 'none' : 'flex';$('v-rsec').style.display = S.mode === 'real' ? 'block' : 'none';
    $('v-freeze').classList.toggle('on', !!frozen);$('v-freeze').textContent = frozen ? 'Tiếp tục (bỏ đóng băng)' : 'Đóng băng khung hình';
    $('v-live').textContent = frozen && S.mode === 'real' ? 'ĐÓNG BĂNG' : 'LIVE';
    $('v-hint').style.display = (S.mode === 'real' || hasMedia) ? 'none' : 'flex';
    const fb = [...$('v-fps').querySelectorAll('button')];
    fb.forEach((b) => b.classList.toggle('on', +b.dataset.f === S.fps));
    place($('v-fps'), fb.findIndex((b) => +b.dataset.f === S.fps));
  }

  const setMode = async (m) => {
    S.mode = m;
    if (m !== 'real') unfreeze();
    syncUI();
    if (m === 'real') {
      try { await ensureCam(); } catch (e) { S.mode = 'media'; syncUI(); alert('Không mở được camera thật: ' + e.message); }
    } else {
      scheduleRelease();
      if (!img) vid.play().catch(() => {});
    }
  };
  $('v-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });

  function unfreeze() { if (frozen) { frozen.close(); frozen = null; } }
  $('v-freeze').addEventListener('click', async () => {
    if (frozen) { unfreeze(); syncUI(); return; }
    if (!cam.videoWidth) return;
    try { frozen = await createImageBitmap(cam); } catch (e) { return; }
    syncUI();
  });

  const fmt = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  function loadFile(f) {
    if (!f || !/^(video|image)\//.test(f.type)) return;
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = null;
    const isImg = f.type.startsWith('image/');
    const isGif = f.type === 'image/gif';
    const tok = ++loadTok;
    dropImg();
    if (isImg) { vid.removeAttribute('src'); vid.load(); }
    if (isGif) {
      (async () => {
        try {
          if (!('ImageDecoder' in window)) throw new Error('no ImageDecoder');
          const g = await decodeGif(f, tok);
          if (g && tok === loadTok) gif = g;
        } catch (e) {
          if (tok !== loadTok) return;
          objUrl = URL.createObjectURL(f);
          gifEl.onload = () => { if (tok === loadTok) img = gifEl; };
          gifEl.src = objUrl;
        }
      })();
    } else if (isImg) {
      createImageBitmap(f).then((b) => { if (tok !== loadTok) { b.close(); return; } img = b; }).catch(() => {});
    } else {
      objUrl = URL.createObjectURL(f);
      vid.src = objUrl;
      vid.play().catch(() => {});
    }
    hasMedia = true;
    S.mode = 'media';
    unfreeze();
    scheduleRelease();
    $('v-name').textContent = f.name;
    $('v-meta').textContent = (isGif ? 'GIF' : isImg ? 'Ảnh' : 'Video') + ' · ' + fmt(f.size);
    $('v-empty').style.display = 'none';$('v-fileinfo').style.display = 'flex';
    syncUI();
  }
  const drop = $('v-drop'), fileInp =$('v-file');
  drop.addEventListener('click', () => fileInp.click());
  fileInp.addEventListener('click', (e) => e.stopPropagation());
  fileInp.addEventListener('change', (e) => { loadFile(e.target.files[0]); fileInp.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  const setScale = (v) => {
    S.scale = Math.min(4, Math.max(0.2, v));
    $('v-scale').value = S.scale;
    $('v-sv').textContent = S.scale.toFixed(2) + '×';
  };
  $('v-scale').oninput = (e) => setScale(+e.target.value);
  const pv = $('v-pv');
  pv.addEventListener('wheel', (e) => { e.preventDefault(); setScale(S.scale * (e.deltaY < 0 ? 1.05 : 0.95)); }, { passive: false });
  const ptrs = new Map();
  let pan = null, pinch = null;
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  pv.addEventListener('pointerdown', (e) => {
    pv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) pan = { x: e.clientX, y: e.clientY, ox: S.offX, oy: S.offY };
    else if (ptrs.size === 2) { pinch = { d: dist() || 1, sc: S.scale }; pan = null; }
  });
  pv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) { setScale(pinch.sc * dist() / pinch.d); return; }
    if (!pan) return;
    const k = cv.width / pv.clientWidth;
    S.offX = pan.ox + (e.clientX - pan.x) * k;
    S.offY = pan.oy + (e.clientY - pan.y) * k;
  });
  const endPtr = (e) => {
    ptrs.delete(e.pointerId); pinch = null;
    if (ptrs.size === 1) { const p = [...ptrs.values()][0]; pan = { x: p.x, y: p.y, ox: S.offX, oy: S.offY }; } else pan = null;
  };
  pv.addEventListener('pointerup', endPtr);
  pv.addEventListener('pointercancel', endPtr);
  $('v-reset').onclick = () => { S.offX = 0; S.offY = 0; setScale(1); };

  $('v-fps').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.fps = +b.dataset.f; startLoop(); syncUI();
  });

  let drag = null;
  const hd = $('v-drag');
  hd.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    hd.setPointerCapture(e.pointerId);
    drag = { dx: e.clientX - box.offsetLeft, dy: e.clientY - box.offsetTop };
  });
  hd.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, innerWidth - box.offsetWidth));
    const y = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, innerHeight - 40));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.right = 'auto';
  });
  hd.addEventListener('pointerup', () => { drag = null; });
  hd.addEventListener('pointercancel', () => { drag = null; });

  let min = false;
  $('v-min').onclick = () => {
    min = !min; $('v-body').style.display = min ? 'none' : 'flex'; $('v-min').textContent = min ? '+' : '—';
    if (min) prev.pause(); else prev.play().catch(() => {});
  };
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'v') {
      const hide = box.style.display !== 'none';
      box.style.display = hide ? 'none' : '';
      if (hide) prev.pause(); else if (!min) prev.play().catch(() => {});
    }
  });

  syncUI();
})();
