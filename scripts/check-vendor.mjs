import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(readFileSync(new URL('../src/vendor/dompurify.min.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../node_modules/dompurify/dist/purify.min.js', import.meta.url), 'utf8'),
  'Vendored DOMPurify differs from installed dependency. Copy node_modules/dompurify/dist/purify.min.js into src/vendor/dompurify.min.js');
console.log('Vendored DOMPurify matches installed dependency');

assert.equal(readFileSync(new URL('../src/vendor/qrcode.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../node_modules/qrcode-generator/dist/qrcode.js', import.meta.url), 'utf8'),
  'Vendored QR encoder differs from installed dependency.');
console.log('Vendored QR encoder matches installed dependency');
