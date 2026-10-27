const test = require('node:test');
const assert = require('node:assert/strict');
const { link, parse } = require('../src/live-invitation.js');
const code = 'ABCD2345EFGH6789JKMN';

test('private links carry only a join code in the fragment, and paste accepts code or link', () => {
  const url = link('https://golf.example/app/?token=private#account_token=secret', code);
  assert.equal(url, `https://golf.example/app/#live_join=${code}`);
  assert.equal(parse(url), code);
  assert.equal(parse(code.toLowerCase()), code);
  assert.equal(parse(url.toLowerCase()), code);
  assert.equal(parse(`https://golf.example/#live_join=${code}&account_token=secret`), null);
  assert.equal(parse('javascript:alert(1)'), null);
  assert.equal(parse('ABCD'), null);
  assert.throws(() => link('https://golf.example', 'ABCD'));
});

test('the offline QR encoder produces a decodable private invitation', () => {
  const qrcode = require('qrcode-generator');
  const decode = require('jsqr');
  const url = link('https://golf.example/app/', code);
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const cells = qr.getModuleCount(), scale = 6, margin = 4;
  const size = (cells + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    if (row >= 0 && col >= 0 && row < cells && col < cells && qr.isDark(row, col)) {
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 0;
    }
  }
  assert.equal(decode(data, size, size)?.data, url);
});
