import { readFile, writeFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Ogiltigt versionsnummer i package.json: ${version}`);
}

const indexUrl = new URL('../index.html', import.meta.url);
const indexHtml = await readFile(indexUrl, 'utf8');
const footerPattern = /(<footer class="app-footer no-print">Poängbogey-kalkylator v)[^<]+(<\/footer>)/;
if (!footerPattern.test(indexHtml)) throw new Error('Versionsfoten hittades inte i index.html');
const updatedHtml = indexHtml.replace(footerPattern, `$1${version}$2`);

if (process.argv.includes('--check')) {
  if (updatedHtml !== indexHtml) throw new Error(`Versionsfoten matchar inte package.json (${version}). Kör npm run sync:version.`);
} else if (updatedHtml !== indexHtml) {
  await writeFile(indexUrl, updatedHtml);
}
