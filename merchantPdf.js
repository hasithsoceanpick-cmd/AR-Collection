// Reads an HNB merchant statement PDF in the browser (nothing leaves the device).
// The PDF's own text is exact, so no character guessing is needed: its words are put
// back into the statement's lines and read by the same rules as the screenshots.
// A PDF with no text in it (a scan) is drawn page by page and read like screenshots.
import { readItems, buildStatement } from './merchant';

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    const [m, w] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]);
    m.GlobalWorkerOptions.workerSrc = w.default;
    pdfjs = m;
  }
  return pdfjs;
}

// wrong = a password was tried and it didn't open the PDF (otherwise it simply needs one)
export class PdfPasswordError extends Error {
  constructor(wrong) {
    super(wrong ? "That password doesn't open this PDF." : 'This PDF needs a password.');
    this.wrong = wrong;
  }
}

export const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? ''));

async function open(file, password) {
  const { getDocument, PasswordResponses } = await lib();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await getDocument({ data, password: password || undefined, isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new PdfPasswordError(Boolean(password) && e.code === PasswordResponses.INCORRECT_PASSWORD);
    throw e;
  }
}

// The page's words → [{ str, x, y, w, h }] with y measured down from the top of the page.
async function words(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items.filter((i) => i.str && i.str.trim()).map((i) => {
    const h = Math.abs(i.transform[3]) || Math.abs(i.height) || 8;
    return { str: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width ?? 0, h };
  });
}

// Words on (nearly) the same baseline make one line, left to right. Pieces that touch
// are joined without a space ("2,000.00" + "CR"), others with one.
export function toLines(ws) {
  const sorted = [...ws].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(w.y - cur.y) <= Math.max(1.5, 0.45 * Math.min(w.h, cur.h))) cur.words.push(w);
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  return lines.map((l) => {
    const ordered = l.words.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const w of ordered) {
      const gap = end == null ? null : w.x - end;
      text += (end == null ? '' : gap != null && gap < 0.15 * w.h ? '' : ' ') + w.str.trim();
      end = w.x + w.w;
    }
    return { y: l.y, text };
  });
}

const DATE_ONLY = /^\d{2}\/\d{2}\/\d{4}$/;
const AMOUNT_ONLY = /^[\d,]+\.\d{2}\s*(CR|DR)?$/i;
const PRES_LABEL = /^Pres\.?\s*Dt\.?\s*:?$/i;
const TOTAL_LABEL = /^Processing\s*Dt\.?\s*Ttl\.?\s*:?$/i;

// A label printed a little above or below its value ("Pres. Dt" and the batch date,
// "Processing Dt. Ttl." and the batch total) is put back on one line.
export function mendLines(texts) {
  const out = [...texts];
  for (let i = 0; i < out.length; i++) {
    const want = PRES_LABEL.test(out[i]) ? DATE_ONLY : TOTAL_LABEL.test(out[i]) ? AMOUNT_ONLY : null;
    if (!want) continue;
    for (const j of [i + 1, i - 1]) {
      if (j >= 0 && j < out.length && want.test(out[j])) {
        out[i] = `${out[i]} ${out[j]}`;
        out.splice(j, 1);
        if (j < i) i--;
        break;
      }
    }
  }
  return out;
}

// The statement's footer: the SALES box's NO. and AMOUNT (the total net).
export function readFooter(ws) {
  const sales = ws.find((w) => w.str.trim() === 'SALES');
  const credits = ws.find((w) => w.str.trim() === 'CREDITS');
  if (!sales) return null;
  // the SALES box ends halfway between its heading and the CREDITS heading (both are centred on their boxes)
  const mid = (w) => w.x + w.w / 2;
  const right = credits ? (mid(sales) + mid(credits)) / 2 : Infinity;
  const below = ws.filter((w) => w.y > sales.y + 1 && mid(w) < right).sort((a, b) => a.y - b.y || a.x - b.x);
  const count = below.find((w) => /^\d+$/.test(w.str.trim()));
  const net = below.find((w) => /^[\d,]+\.\d{2}$/.test(w.str.trim()));
  if (!count || !net) return null;
  return { count: Number(count.str.trim()), net: Number(net.str.trim().replace(/,/g, '')) };
}

async function preview(page, scale = 1.6) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}
// The pictures a scanned page is made of, as canvases at their own size (null if none could be taken).
async function pageImages(page) {
  try {
    const { OPS } = await lib();
    const ops = await page.getOperatorList();
    const out = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const id = ops.argsArray[i][0];
      const img = await new Promise((res) => page.objs.get(id, res));
      if (!img || img.width < 300 || img.height < 300) continue;      // logos and lines
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data && (img.kind === 2 || img.kind === 3)) {
        const id2 = ctx.createImageData(img.width, img.height);
        const step = img.kind === 3 ? 4 : 3;
        for (let p = 0, q = 0; p < img.width * img.height; p++, q += step) {
          id2.data[p * 4] = img.data[q]; id2.data[p * 4 + 1] = img.data[q + 1]; id2.data[p * 4 + 2] = img.data[q + 2]; id2.data[p * 4 + 3] = 255;
        }
        ctx.putImageData(id2, 0, 0);
      } else continue;
      out.push(c);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
const toUrl = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b ? URL.createObjectURL(b) : canvas.toDataURL('image/png')), 'image/png'));

// file → { statement, texts, dropped, footer, pages: [object URLs], scanned }
export async function readStatementPdf(file, password, onProgress = () => {}) {
  onProgress('Opening the PDF…', 0);
  const doc = await open(file, password);
  try {
    const texts = [], pages = [], items = [];
    let footer = null, chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(`Reading page ${n} of ${doc.numPages}…`, (n - 1) / doc.numPages);
      const page = await doc.getPage(n);
      const ws = await words(page);
      chars += ws.reduce((a, w) => a + w.str.trim().length, 0);
      const lines = mendLines(toLines(ws).map((l) => l.text));
      texts.push(lines.join('\n'));
      footer = footer ?? readFooter(ws);
      pages.push(await toUrl(await preview(page)));
    }
    if (chars < 40) {
      // no text in the PDF (a scan): read each page's picture like a screenshot, at its own resolution
      const { readStatementImages } = await import('./merchantOcr');
      const big = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        big.push(...((await pageImages(page)) ?? [await preview(page, 3)]));
      }
      const r = await readStatementImages(big, onProgress);
      return { ...r, footer: null, pages, scanned: true };
    }
    for (const t of texts) items.push(...readItems(t).filter((x) => x.t !== 'asat' || !items.some((y) => y.t === 'asat')));
    onProgress('Done', 1);
    return { statement: buildStatement(items), texts, dropped: 0, footer, pages, scanned: false };
  } finally {
    doc.destroy();
  }
}
