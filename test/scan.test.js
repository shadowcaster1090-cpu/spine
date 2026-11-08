// Exercises Spine's own barcode decoder with synthetic camera frames: blur, noise, glare, tilt-free offsets, upside down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeImageData, normalise, upcEtoA, validGtin } from '../public/js/scan.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLL', 'LGLLGL', 'LLGLGL'];

export function ean13Modules(code) {
  const d = code.split('').map(Number);
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[d[i]];
  return m + '101';
}
function ean8Modules(code) {
  const d = code.split('').map(Number);
  return '101' + d.slice(0, 4).map((x) => L[x]).join('') + '01010' + d.slice(4).map((x) => R[x]).join('') + '101';
}

// Renders modules into an RGBA frame with optional blur, noise, glare gradient and flip.
function frame(modules, { width = 900, height = 120, unit = 5.3, offset = 80, blur = 1, noise = 18, glare = 0, flip = false, seed = 1 } = {}) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const row = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const m = Math.floor((x - offset) / unit);
    row[x] = m >= 0 && m < modules.length && modules[m] === '1' ? 30 : 225;
  }
  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) { let a = 0, n = 0; for (let k = -blur; k <= blur; k++) { const xx = x + k; if (xx >= 0 && xx < width) { a += row[xx]; n++; } } out[x] = a / n; }
  if (flip) out.reverse();
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = Math.max(0, Math.min(255, out[x] + (rand() - .5) * 2 * noise + glare * (x / width)));
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  return { width, height, data };
}

const withCheck = (b) => { let sum = 0; [...b].reverse().forEach((n, i) => { sum += +n * (i % 2 === 0 ? 3 : 1); }); return b + (10 - sum % 10) % 10; };
const CODES = ['502186603320', '503069700921', '071551501234', '978014103614', '400638133393'].map(withCheck);

test('check digits', () => {
  for (const c of CODES) assert.ok(validGtin(c), c);
  assert.equal(validGtin(CODES[0].slice(0, 12) + ((+CODES[0][12] + 1) % 10)), false);
});

test('decodes clean EAN-13 frames', () => {
  for (const c of CODES) assert.equal(decodeImageData(frame(ean13Modules(c))), c);
});

test('decodes small, blurred, noisy, glary and upside-down frames', () => {
  const hard = [
    { unit: 2.4, blur: 1, noise: 22 },
    { unit: 3.1, blur: 2, noise: 25, glare: 70 },
    { unit: 7.5, blur: 3, noise: 30, offset: 20, width: 1000 },
    { unit: 4.2, blur: 1, noise: 20, flip: true },
    { unit: 3.3, blur: 2, noise: 15, glare: -60, offset: 300, width: 1280 }
  ];
  const misses = [];
  CODES.forEach((c, i) => hard.forEach((o, j) => { if (decodeImageData(frame(ean13Modules(c), { ...o, seed: i * 10 + j + 1 })) !== c) misses.push(`${c} ${JSON.stringify(o)}`); }));
  assert.deepEqual(misses, []);
});

test('decodes EAN-8', () => {
  assert.equal(decodeImageData(frame(ean8Modules('96385074'))), '96385074');
});

test('returns nothing for frames with no barcode', () => {
  const blank = frame('0'.repeat(95), { noise: 40 });
  assert.equal(decodeImageData(blank), null);
  const stripes = frame('10'.repeat(60), { unit: 4 });
  assert.equal(decodeImageData(stripes), null);
});

test('normalises UPC forms', () => {
  assert.equal(normalise(CODES[2]), CODES[2].slice(1));
  assert.equal(upcEtoA('04252614'), '042100005264');
  assert.equal(normalise('04252614', 'upc_e'), '042100005264');
  assert.equal(normalise('123'), null);
});
