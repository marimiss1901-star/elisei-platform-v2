import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const payload = path.join(patchRoot, 'payload', 'frontend');
const exists = (p) => fs.existsSync(p);
const firstExisting = (items) => items.map((item) => path.join(projectRoot, item)).find(exists);
const backup = (file) => { if (!file || !exists(file)) return; const target = `${file}.period-5.3.15-backup`; if (!exists(target)) fs.copyFileSync(file, target); };
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };

const appFile = firstExisting([
  'frontend/src/App.jsx','frontend/src/App.tsx','frontend_v2/src/App.jsx','frontend_v2/src/App.tsx','src/App.jsx','src/App.tsx',
]);
if (!appFile) throw new Error('Не найден App.jsx/App.tsx frontend Елисея.');
const frontendRoot = appFile.includes(`${path.sep}frontend${path.sep}`) || appFile.includes(`${path.sep}frontend_v2${path.sep}`)
  ? path.dirname(path.dirname(appFile))
  : projectRoot;

const entry = [
  'src/main.jsx','src/main.tsx','src/index.jsx','src/index.tsx',
].map((rel) => path.join(frontendRoot, rel)).find(exists);
if (!entry) throw new Error('Не найден frontend entry: src/main.jsx или src/index.jsx.');

for (const rel of [
  'src/components/GlobalPeriodBar.jsx',
  'src/lib/periodStore.js',
  'src/styles/elisei-period.css',
  'src/periodBootstrap.jsx',
]) copy(path.join(payload, rel), path.join(frontendRoot, rel));

// Remove the old hidden inline mount from likely files.
const candidates = [
  appFile,
  path.join(frontendRoot, 'src/pages/DashboardPage.jsx'),
  path.join(frontendRoot, 'src/pages/DashboardPage.tsx'),
].filter(exists);
for (const file of candidates) {
  backup(file);
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^import\s+GlobalPeriodBar\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  src = src.replace(/\s*<GlobalPeriodBar\s*\/>\s*/g, '\n');
  fs.writeFileSync(file, src);
}

backup(entry);
let source = fs.readFileSync(entry, 'utf8');
if (!source.includes('periodBootstrap')) {
  const importLine = "import './periodBootstrap.jsx';";
  const imports = [...source.matchAll(/^import .*;?\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const pos = last.index + last[0].length;
    source = `${source.slice(0, pos)}\n${importLine}${source.slice(pos)}`;
  } else {
    source = `${importLine}\n${source}`;
  }
}
fs.writeFileSync(entry, source);

fs.writeFileSync(path.join(projectRoot, 'ELISEI_BUILD_5_3_15_PERIOD_VISIBLE.txt'), [
  'ELISEI 5.3.15',
  'GLOBAL PERIOD BAR: VISIBLE STICKY HOST',
  'OLD INLINE MOUNT: REMOVED',
  'ALL ROUTES: ENABLED',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));

console.log('ELISEI 5.3.15: видимая панель периода подключена.');
console.log(`Frontend entry: ${path.relative(projectRoot, entry)}`);
console.log('Панель появится сверху основного контента на всех страницах.');
