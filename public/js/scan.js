// Barcode scanning for DVD cases: EAN-13, UPC-A, EAN-8 (and UPC-E via the native/ZXing readers).
// Order of preference: the browser's BarcodeDetector (Chrome, Android), then ZXing from a CDN,
// then Spine's own decoder below, which needs nothing from the network and works in every browser.

const ZXING = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';

/* ---------- check digits & normalisation ---------- */
export function validGtin(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number), check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// UPC-E (8 digits, number system 0 or 1) to UPC-A (12 digits).
export function upcEtoA(e) {
  if (!/^[01]\d{7}$/.test(e)) return e;
  const [ns, d1, d2, d3, d4, d5, d6, chk] = e.split('');
  let body;
  if ('012'.includes(d6)) body = d1 + d2 + d6 + '0000' + d3 + d4 + d5;
  else if (d6 === '3') body = d1 + d2 + d3 + '00000' + d4 + d5;
  else if (d6 === '4') body = d1 + d2 + d3 + d4 + '00000' + d5;
  else body = d1 + d2 + d3 + d4 + d5 + '0000' + d6;
  return ns + body + chk;
}

export function normalise(raw, format = '') {
  let c = String(raw || '').replace(/\D/g, '');
  if (format.toLowerCase().replace(/[^a-z]/g, '') === 'upce' && c.length === 8) c = upcEtoA(c);
  if (c.length === 13 && c.startsWith('0')) c = c.slice(1); // EAN-13 of a UPC-A: keep the 12-digit UPC
  return validGtin(c) ? c : null;
}

/* ---------- Spine's own EAN/UPC decoder ---------- */
// Bar/space widths of the L-code digits (space, bar, space, bar). G-codes are the reverse; R-codes equal L.
const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map((s) => s.split('').map(Number));
const G = L.map((p) => [...p].reverse());
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLL', 'LGLLGL', 'LLGLGL'];

function digit(w, tables) {
  const s = w[0] + w[1] + w[2] + w[3];
  let best = null, bestErr = 1e9;
  for (const [name, table] of tables) {
    for (let n = 0; n < 10; n++) {
      const p = table[n];
      let err = 0;
      for (let i = 0; i < 4; i++) err += Math.abs(w[i] * 7 / s - p[i]);
      if (err < bestErr) { bestErr = err; best = [n, name]; }
    }
  }
  return bestErr < 1.6 ? best : null;
}

function guardOk(runs, at, n, unit) {
  for (let i = 0; i < n; i++) { const r = runs[at + i] / unit; if (r < 0.4 || r > 1.9) return false; }
  return true;
}

// runs alternate bar, space, bar… starting with a bar.
function decodeRuns(runs) {
  // EAN-13 / UPC-A: 59 runs, 95 modules.
  for (let i = 0; i + 59 <= runs.length; i += 2) {
    let total = 0;
    for (let k = 0; k < 59; k++) total += runs[i + k];
    const unit = total / 95;
    // Quiet zone before the start guard.
    if (i > 0 && runs[i - 1] < unit * 4) continue;
    if (!guardOk(runs, i, 3, unit) || !guardOk(runs, i + 27, 5, unit) || !guardOk(runs, i + 56, 3, unit)) continue;
    let left = '', parity = '', ok = true;
    for (let d = 0; d < 6 && ok; d++) {
      const r = digit(runs.slice(i + 3 + d * 4, i + 7 + d * 4), [['L', L], ['G', G]]);
      if (!r) ok = false; else { left += r[0]; parity += r[1]; }
    }
    if (!ok) continue;
    let right = '';
    for (let d = 0; d < 6 && ok; d++) {
      const r = digit(runs.slice(i + 32 + d * 4, i + 36 + d * 4), [['R', L]]);
      if (!r) ok = false; else right += r[0];
    }
    const first = PARITY.indexOf(parity);
    if (!ok || first < 0) continue;
    const code = first + left + right;
    if (validGtin(code)) return code;
  }
  // EAN-8: 43 runs, 67 modules, all L on the left.
  for (let i = 0; i + 43 <= runs.length; i += 2) {
    let total = 0;
    for (let k = 0; k < 43; k++) total += runs[i + k];
    const unit = total / 67;
    if (i > 0 && runs[i - 1] < unit * 4) continue;
    if (!guardOk(runs, i, 3, unit) || !guardOk(runs, i + 19, 5, unit) || !guardOk(runs, i + 40, 3, unit)) continue;
    let code = '', ok = true;
    for (let d = 0; d < 4 && ok; d++) { const r = digit(runs.slice(i + 3 + d * 4, i + 7 + d * 4), [['L', L]]); if (!r) ok = false; else code += r[0]; }
    for (let d = 0; d < 4 && ok; d++) { const r = digit(runs.slice(i + 24 + d * 4, i + 28 + d * 4), [['R', L]]); if (!r) ok = false; else code += r[0]; }
    if (ok && validGtin(code)) return code;
  }
  return null;
}

function runsOf(dark) {
  const runs = [];
  let x = 0;
  while (x < dark.length && !dark[x]) x++;
  let cur = true, len = 0;
  for (; x < dark.length; x++) {
    if (dark[x] === cur) len++;
    else { runs.push(len); cur = dark[x]; len = 1; }
  }
  if (cur) runs.push(len);
  return runs;
}

function scanLine(lum) {
  const n = lum.length;
  // Two thresholds: adaptive (handles uneven light and glare on shrink-wrap) and global.
  const win = Math.max(16, Math.round(n / 12));
  const pre = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + lum[i];
  let lo = 255, hi = 0;
  for (let i = Math.floor(n * .1); i < n * .9; i++) { if (lum[i] < lo) lo = lum[i]; if (lum[i] > hi) hi = lum[i]; }
  if (hi - lo < 40) return null;
  const mid = (lo + hi) / 2;
  const adaptive = new Array(n), global = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win);
    const mean = (pre[b] - pre[a]) / (b - a);
    adaptive[i] = lum[i] < Math.min(mean - 4, mid + (hi - lo) * .15);
    global[i] = lum[i] < mid;
  }
  for (const dark of [adaptive, global]) {
    const runs = runsOf(dark);
    const code = decodeRuns(runs) || decodeRuns([...runs].reverse());
    if (code) return code;
  }
  return null;
}

// Reads a barcode from ImageData. Tries rows through the middle band, then across the whole image.
export function decodeImageData(img, { rows = 24, band = [0.3, 0.7] } = {}) {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w);
  const tryRow = (y) => {
    // Average five neighbouring rows (bars are vertical) to reduce sensor noise.
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)), p = (yy * w + x) * 4;
        s += data[p] * .299 + data[p + 1] * .587 + data[p + 2] * .114;
      }
      lum[x] = s / 5;
    }
    return scanLine(lum);
  };
  for (let k = 0; k < rows; k++) {
    const t = band[0] + (band[1] - band[0]) * (rows === 1 ? .5 : k / (rows - 1));
    // Visit rows from the centre outwards.
    const order = k % 2 ? .5 + (t - .5) : .5 - (t - .5);
    const code = tryRow(Math.round(order * (h - 1)));
    if (code) return code;
  }
  return null;
}

function canvasFor(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

/* ---------- still photos ---------- */
export async function decodeFile(file) {
  const bmp = await createImageBitmap(file);
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const r = await det.detect(bmp);
      for (const b of r) { const c = normalise(b.rawValue, b.format); if (c) return c; }
    } catch { /* fall through */ }
  }
  // ZXing first, on a sensible size.
  try {
    const Z = await loadZxing();
    const reader = new Z.MultiFormatReader();
    reader.setHints(new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]], [Z.DecodeHintType.TRY_HARDER, true]]));
    for (const maxW of [1600, 2400, 1000]) {
      const k = Math.min(1, maxW / bmp.width), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      const [c, cx] = canvasFor(w, h); cx.drawImage(bmp, 0, 0, w, h);
      try { const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))); const code = normalise(r.getText(), Z_FORMAT(r)); if (code) return code; } catch { /* next size */ } finally { try { reader.reset(); } catch { /* ignore */ } }
    }
  } catch { /* ZXing unavailable: Spine's reader below */ }
  // Try a few sizes and both orientations: phone photos vary a lot.
  for (const maxW of [1600, 1000, 2400]) {
    for (const rot of [0, 90]) {
      const k = Math.min(1, maxW / (rot ? bmp.height : bmp.width));
      const w = Math.round((rot ? bmp.height : bmp.width) * k), h = Math.round((rot ? bmp.width : bmp.height) * k);
      const [, ctx] = canvasFor(w, h);
      if (rot) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(bmp, 0, 0, h, w); } else ctx.drawImage(bmp, 0, 0, w, h);
      const code = decodeImageData(ctx.getImageData(0, 0, w, h), { rows: 60, band: [0.05, 0.95] });
      const n = code && normalise(code);
      if (n) return n;
    }
  }
  return null;
}

/* ---------- live camera ---------- */
let audio;
// Call from a click so iOS lets us play the confirmation beep later.
export function unlockFeedback() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* no audio */ }
}
export function feedback(ok = true) {
  try { navigator.vibrate?.(ok ? 60 : [40, 60, 40]); } catch { /* ignore */ }
  try {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1320 : 440; g.gain.value = 0.06;
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.2));
  } catch { /* ignore */ }
}

async function loadZxing() {
  if (window.ZXing) return window.ZXing;
  await Promise.race([
    new Promise((res, rej) => { const s = document.createElement('script'); s.src = ZXING; s.onload = res; s.onerror = rej; document.head.append(s); }),
    new Promise((_, rej) => setTimeout(rej, 5000))
  ]);
  return window.ZXing;
}

async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(location.protocol === 'http:' && location.hostname !== 'localhost' ? 'The camera only works when Spine is served over HTTPS. Type the barcode, or take a photo of it.' : 'This browser can’t open the camera. Type the barcode, or take a photo of it.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? 'Camera access was refused. Allow it in your browser settings, or type the barcode.' : e.name === 'NotFoundError' ? 'No camera found. Type the barcode, or take a photo of it.' : 'Could not start the camera. Type the barcode instead.');
  }
  video.setAttribute('playsinline', ''); video.muted = true;
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }
  return { stream, track };
}

/**
 * Starts scanning. onCode(code) is called once per new barcode; in continuous mode the same code
 * is ignored for a few seconds so a disc held in front of the lens is not added twice.
 * Returns { stop, torch: boolean available, setTorch(on), engine }.
 */
export async function startScanner(video, onCode, { continuous = false } = {}) {
  const { stream, track } = await openCamera(video);
  let alive = true, last = '', lastAt = 0, pending = '', engine = 'spine';
  const emit = (raw, format) => {
    const code = normalise(raw, format);
    if (!code || !alive) return;
    const now = Date.now();
    if (code === last && now - lastAt < 4000) { lastAt = now; return; }
    last = code; lastAt = now;
    feedback(true);
    onCode(code);
    if (!continuous) stop();
  };
  const stop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };

  // Decoders. The native detector where the browser has one; ZXing's core reader (we drive it frame by
  // frame ourselves, so a bad frame can never stop the loop, which the library's own video loop does);
  // and Spine's EAN/UPC reader as a last resort. Each frame is offered to all of them.
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const fm = await window.BarcodeDetector.getSupportedFormats();
      const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => fm.includes(f));
      if (want.includes('ean_13')) { detector = new window.BarcodeDetector({ formats: want }); engine = 'native'; }
    } catch { detector = null; }
  }
  let Z = null, zreader = null;
  try {
    Z = await loadZxing();
    const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]], [Z.DecodeHintType.TRY_HARDER, true]]);
    zreader = new Z.MultiFormatReader(); zreader.setHints(hints);
    if (engine !== 'native') engine = 'zxing';
  } catch { Z = null; zreader = null; }

  const [, ctx] = canvasFor(1, 1);
  const crop = document.createElement('canvas'), cctx = crop.getContext('2d', { willReadFrequently: true });
  const rot = document.createElement('canvas'), rctx = rot.getContext('2d', { willReadFrequently: true });
  const rotated = (src) => {   // the frame turned 90°, for a case held sideways
    if (rot.width !== src.height || rot.height !== src.width) { rot.width = src.height; rot.height = src.width; }
    rctx.save(); rctx.translate(rot.width / 2, rot.height / 2); rctx.rotate(Math.PI / 2); rctx.drawImage(src, -src.width / 2, -src.height / 2); rctx.restore();
    return rot;
  };
  const zxDecode = (canvas) => {
    if (!zreader) return null;
    try {
      const r = zreader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas))));
      return r ? [r.getText(), Z_FORMAT(r)] : null;
    } catch { return null; }   // NotFound and friends: just the next frame
    finally { try { zreader.reset(); } catch { /* ignore */ } }
  };

  let frame = 0;
  const tick = async () => {
    if (!alive) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (video.readyState >= 2 && vw && vh) {
      frame++;
      try {
        if (detector && frame % 2 === 0) {
          try { const r = await detector.detect(video); for (const b of r) emit(b.rawValue, b.format); } catch { /* frame not ready */ }
        }
        // The strip under the aiming box, at up to 1280px across; the barcode is horizontal there.
        const w = Math.min(vw, 1280), k = w / vw, h = Math.round(vh * k);
        if (ctx.canvas.width !== w || ctx.canvas.height !== h) { ctx.canvas.width = w; ctx.canvas.height = h; }
        ctx.drawImage(video, 0, 0, w, h);
        const y0 = Math.round(h * .22), bh = Math.round(h * .56);
        if (crop.width !== w || crop.height !== bh) { crop.width = w; crop.height = bh; }
        cctx.drawImage(ctx.canvas, 0, y0, w, bh, 0, 0, w, bh);
        let hit = zxDecode(crop);
        // Every few frames try the whole frame, and the frame turned on its side, in case the disc is held off-centre or sideways.
        if (!hit && frame % 4 === 0) hit = zxDecode(ctx.canvas);
        if (!hit && frame % 3 === 1) hit = zxDecode(rotated(ctx.canvas));
        if (hit) { emit(hit[0], hit[1]); pending = ''; }
        else {
          const code = decodeImageData(cctx.getImageData(0, 0, w, bh), { rows: 14, band: [0.1, 0.9] });
          // Spine's own reader needs two matching frames so a blurred read can't slip through.
          if (code) { if (code === pending) emit(code); pending = code; } else pending = '';
        }
      } catch { /* a bad frame is not a reason to stop */ }
    }
    if (alive) setTimeout(tick, 110);
  };
  // Start once the camera is really delivering frames.
  const ready = () => (video.readyState >= 2 && video.videoWidth ? tick() : setTimeout(ready, 60));
  ready();

  const caps = track.getCapabilities?.() || {};
  return {
    stop, engine,
    torch: !!caps.torch,
    setTorch: (on) => track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {})
  };
}

function Z_FORMAT(r) {
  try { return String(window.ZXing.BarcodeFormat[r.getBarcodeFormat()] || ''); } catch { return ''; }
}
