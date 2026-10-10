import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The OCR engine that reads merchant statement screenshots, served from this site
// under /ocr/ (no outside CDN). Copied from node_modules at build time.
const OCR_FILES = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
const fromModules = (p) => readFileSync(resolve('node_modules', p));

function ocrFiles() {
  return {
    name: 'ocr-files',
    generateBundle() {
      for (const [name, src] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: fromModules(src) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/ocr\/([^?]+)/)?.[1];
        if (!name || !OCR_FILES[name]) return next();
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(fromModules(OCR_FILES[name]));
      });
    },
  };
}

export default defineConfig({ plugins: [react(), ocrFiles()] });
