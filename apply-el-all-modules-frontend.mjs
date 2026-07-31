import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

function findFirst(paths) {
  return paths.find((p) => fs.existsSync(p));
}

const indexFile = findFirst([
  path.join(cwd, 'index.html'),
  path.join(cwd, 'frontend', 'index.html'),
  path.join(cwd, 'frontend_v2', 'index.html'),
  path.join(cwd, 'client', 'index.html'),
  path.join(cwd, 'web', 'index.html'),
  path.join(cwd, 'app', 'index.html'),
]);
if (!indexFile) {
  throw new Error(`Не найден index.html frontend Елисея. Текущая папка: ${cwd}`);
}

const payloadDir = findFirst([
  path.join(scriptDir, 'payload', 'frontend', 'public'),
  path.join(scriptDir, 'frontend', 'payload', 'frontend', 'public'),
  path.join(cwd, 'payload', 'frontend', 'public'),
  path.join(cwd, 'frontend', 'payload', 'frontend', 'public'),
]);
if (!payloadDir) {
  throw new Error('Не найдены файлы elisei-el.js и elisei-el.css в payload патча.');
}

const frontRoot = path.dirname(indexFile);
const publicDir = path.join(frontRoot, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const name of ['elisei-el.js', 'elisei-el.css']) {
  const src = path.join(payloadDir, name);
  if (!fs.existsSync(src)) throw new Error(`В патче отсутствует ${name}`);
  fs.copyFileSync(src, path.join(publicDir, name));
}

const backup = `${indexFile}.el-5.3.20A-backup`;
if (!fs.existsSync(backup)) fs.copyFileSync(indexFile, backup);
let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace(/\s*<link[^>]+elisei-el\.css[^>]*>\s*/gi, '\n')
  .replace(/\s*<script[^>]+elisei-el\.js[^>]*><\/script>\s*/gi, '\n');
const injection = '\n  <!-- ELISEI 5.3.20A EL WHOLE BUSINESS BRAIN -->\n  <link rel="stylesheet" href="/elisei-el.css?v=5.3.20A">\n  <script src="/elisei-el.js?v=5.3.20A" defer></script>\n';
html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${injection}</head>`) : `${injection}${html}`;
fs.writeFileSync(indexFile, html);
fs.writeFileSync(path.join(frontRoot, 'ELISEI_BUILD_5_3_20A_EL_FRONTEND.txt'), `ELISEI 5.3.20A EL FRONTEND\nApplied: ${new Date().toISOString()}\n`);
console.log(`ELISEI 5.3.20A frontend установлен: ${path.relative(cwd, indexFile) || 'index.html'}`);
