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
  for (const moduleName of ['scoring', 'storage', 'live-sync', 'validation', 'round-extras', 'live-round', 'tour-rules', 'tour-sync', 'account-sync']) {
    assert.ok(assets.some(asset => asset.split('?')[0] === `src/${moduleName}.js`), `missing ${moduleName} module`);
  }
  for (const asset of assets.filter(asset => asset !== '')) {
    assert.ok(fs.existsSync(path.join(root, asset.split('?')[0])), `missing service-worker asset: ${asset}`);
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

test('spectator tour renderer does not inject server data through HTML', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const renderer = html.match(/function renderSpectatorTourDetail\(code\) \{([\s\S]*?)\n\}\n\nfunction closeSpectatorTour/);
  assert.ok(renderer, 'spectator renderer was not found');
  assert.doesNotMatch(renderer[1], /\.innerHTML\s*=/);
  assert.match(renderer[1], /\.textContent\s*=/);
  assert.match(renderer[1], /\.replaceChildren\(\)/);
});

test('live-room seat renderer does not reinterpret player names as HTML', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const renderer = html.match(/function renderJoinLiveSeatList\(room, code\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction claimLiveSeat/);
  assert.ok(renderer, 'live-room seat renderer was not found');
  assert.doesNotMatch(renderer[1], /\.innerHTML\s*=/);
  assert.match(renderer[1], /button\.textContent\s*=/);
  assert.match(renderer[1], /playerSelect\.replaceChildren\(\)/);
});

test('account login tolerates a previously cached account client module', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /typeof client\.tours !== 'function'/);
  assert.match(html, /try \{ await syncAccountTours\(nextSession\); \} catch \(_\) \{\}/);
});

test('versioned scripts bypass stale PWA modules and use network-first refreshes', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(html, /src\/account-sync\.js\?v=[0-9-]+/);
  assert.match(worker, /event\.request\.destination === 'script'/);
  assert.match(worker, /fetch\(event\.request\)/);
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

test('Worker deployment workflow grants only explicit read access', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-sync-worker.yml'), 'utf8');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.equal((workflow.match(/^      contents: read$/gm) || []).length, 2);
  assert.doesNotMatch(workflow, /(?:write-all|contents: write)/);
});
