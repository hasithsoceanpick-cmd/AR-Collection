// Reads merchant statement screenshots in the browser (nothing leaves the device).
// The OCR engine and its English model are served from this site under /ocr/
// (see vite.config.js), so no outside service is involved.
import { readItems, joinItems, buildStatement } from './merchant';

// Lanczos-3 weights for resampling `from` pixels to `to` pixels (enlarging).
function lanczosTaps(from, to) {
  const a = 3, scale = to / from, taps = new Int32Array(to * 6), w = new Float32Array(to * 6);
  const k = (x) => { if (x === 0) return 1; if (x <= -a || x >= a) return 0; const p = Math.PI * x; return (a * Math.sin(p) * Math.sin(p / a)) / (p * p); };
  for (let i = 0; i < to; i++) {
    const c = (i + 0.5) / scale - 0.5, left = Math.floor(c) - a + 1;
    let sum = 0;
    for (let j = 0; j < 6; j++) {
      const s = left + j;
      taps[i * 6 + j] = Math.min(from - 1, Math.max(0, s));
      sum += (w[i * 6 + j] = k(c - s));
    }
    for (let j = 0; j < 6; j++) w[i * 6 + j] /= sum;
  }
  return { taps, w };
}

// Enlarge (Lanczos, up to 3×), greyscale and stretch the contrast: small screenshot
// text reads far more reliably that way.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const sw = bmp.width, sh = bmp.height;
  const scale = Math.max(1, Math.min(3, Math.sqrt(16e6 / (sw * sh))));
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, sw, sh);
  sctx.drawImage(bmp, 0, 0);
  const rgba = sctx.getImageData(0, 0, sw, sh).data;
  const grey = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) grey[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];

  const H = lanczosTaps(sw, dw), V = lanczosTaps(sh, dh);
  const tmp = new Float32Array(dw * sh);                       // across
  for (let y = 0; y < sh; y++) {
    const row = y * sw, out = y * dw;
    for (let x = 0; x < dw; x++) {
      let v = 0;
      for (let j = 0; j < 6; j++) v += grey[row + H.taps[x * 6 + j]] * H.w[x * 6 + j];
      tmp[out + x] = v;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = dw; canvas.height = dh;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(dw, dh);
  const px = img.data, hist = new Uint32Array(256);
  const big = new Uint8ClampedArray(dw * dh);                   // down
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let v = 0;
      for (let j = 0; j < 6; j++) v += tmp[V.taps[y * 6 + j] * dw + x] * V.w[y * 6 + j];
      const g = Math.max(0, Math.min(255, Math.round(v)));
      big[y * dw + x] = g; hist[g]++;
    }
  }
  // stretch between the 1st and 99th percentile
  const n = dw * dh;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((big[i] - lo) * 255) / span)));
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// files → { statement, texts, dropped }. onProgress(text, fraction 0–1)
export async function readStatementImages(files, onProgress = () => {}) {
  const { createWorker } = await import('tesseract.js');
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;
  let current = 0;
  onProgress('Loading the reader (first time can take a minute)…', 0);
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`, corePath: base.replace(/\/$/, ''), langPath: base.replace(/\/$/, ''),
    gzip: true, workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(`Reading screenshot ${current + 1} of ${files.length}…`, (current + m.progress) / files.length);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const texts = [];
    for (current = 0; current < files.length; current++) {
      onProgress(`Reading screenshot ${current + 1} of ${files.length}…`, current / files.length);
      const { data } = await worker.recognize(await prepare(files[current]));
      texts.push(data.text);
    }
    const joined = joinItems(texts.map(readItems));
    onProgress('Done', 1);
    return { statement: buildStatement(joined.items), texts, dropped: joined.dropped };
  } finally {
    await worker.terminate();
  }
}
