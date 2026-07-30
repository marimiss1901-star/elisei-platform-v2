import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const candidates = ['frontend/index.html', 'frontend_v2/index.html', 'client/index.html', 'web/index.html', 'app/index.html', 'index.html'];
const indexRel = candidates.find((candidate) => fs.existsSync(path.join(projectRoot, candidate)));
if (!indexRel) throw new Error('Не найден index.html frontend. Запусти установщик из корня репозитория Елисея.');

const indexFile = path.join(projectRoot, indexRel);
const frontRoot = path.dirname(indexFile);
const publicDir = path.join(frontRoot, 'public');
fs.mkdirSync(publicDir, { recursive: true });

for (const name of ['elisei-period-smart.js', 'elisei-period-smart.css']) {
  fs.copyFileSync(path.join(patchRoot, 'payload/public', name), path.join(publicDir, name));
}

const backup = indexFile + '.period-5.3.17-backup';
if (!fs.existsSync(backup)) fs.copyFileSync(indexFile, backup);

let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace(/\s*<link[^>]+elisei-period-(?:hardfix|runtime|visible|smart)[^>]*>\s*/gi, '\n')
  .replace(/\s*<script[^>]+elisei-period-(?:hardfix|runtime|visible|smart)[^>]*><\/script>\s*/gi, '\n')
  .replace(/\s*<!--\s*ELISEI[^>]*PERIOD[^>]*-->\s*/gi, '\n');

const injection = '\n  <!-- ELISEI 5.3.17 SMART PERIOD TOOLBAR -->\n' +
  '  <link rel="stylesheet" href="/elisei-period-smart.css?v=5.3.17">\n' +
  '  <script src="/elisei-period-smart.js?v=5.3.17"></script>\n';

if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, injection + '</head>');
else html = injection + html;

fs.writeFileSync(indexFile, html);
fs.writeFileSync(path.join(projectRoot, 'ELISEI_BUILD_5_3_17_SMART_PERIOD.txt'), [
  'ELISEI 5.3.17',
  'UI: compact smart period toolbar',
  'PRESETS: today/yesterday/7d/30d/week/month/custom',
  'CONTEXT: hidden on products/connections/import; stock snapshot date',
  'TRANSPORT: fetch + XHR period propagation',
  'Applied: ' + new Date().toISOString()
].join('\n'));

console.log('ELISEI 5.3.17 установлен.');
console.log('Frontend index: ' + indexRel);
console.log('После deploy длинная полоса 5.3.16 будет заменена компактным фильтром.');
