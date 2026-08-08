'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('manifest is valid and all declared local assets exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src)), `missing manifest asset: ${icon.src}`);
  }
});

test('service-worker shell contains existing files and application modules', () => {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const shellMatch = source.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, 'SHELL asset list was not found');
  const assets = [...shellMatch[1].matchAll(/['"]\.\/?([^'"]+)['"]/g)].map(match => match[1]);
  for (const moduleName of ['scoring', 'storage', 'live-sync', 'validation', 'round-extras']) {
    assert.ok(assets.includes(`src/${moduleName}.js`), `missing ${moduleName} module`);
  }
  for (const asset of assets.filter(asset => asset !== '')) {
    assert.ok(fs.existsSync(path.join(root, asset)), `missing service-worker asset: ${asset}`);
  }
});

test('inline application JavaScript parses', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length > 0);
  inlineScripts.forEach((match, index) => {
    assert.doesNotThrow(() => new vm.Script(match[1], { filename: `index-inline-${index}.js` }));
  });
});

test('PWA updates use automatic cache generations and a deferred Swedish prompt', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(worker, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(worker, /golf-v\d+/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(html, /En ny version finns/);
  assert.match(html, /Uppdatera nu/);
  assert.match(html, /if \(inprogressLoad\(\)\)/);
  assert.match(html, /controllerchange/);
});
