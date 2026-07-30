import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const payload = path.join(patchRoot, 'payload');
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const backup = (file) => { const target = `${file}.ads-backup`; if (fs.existsSync(file) && !fs.existsSync(target)) fs.copyFileSync(file, target); };
const existing = (paths) => paths.map((item) => path.join(projectRoot, item)).find(fs.existsSync);

function addImport(source, line) {
  if (source.includes(line.split(' from ')[0].replace(/^import\s+/, ''))) return source;
  const imports = [...source.matchAll(/^import .*;\s*$/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports.at(-1);
  const pos = last.index + last[0].length;
  return `${source.slice(0, pos)}\n${line}${source.slice(pos)}`;
}

function findMatchingBrace(source, start) {
  let depth = 0; let quote = null; let templateDepth = 0; let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]; const next = source[index + 1];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote === '`' && char === '$' && next === '{') { templateDepth += 1; index += 1; continue; }
      if (quote === '`' && char === '}' && templateDepth) { templateDepth -= 1; continue; }
      if (char === quote && !templateDepth) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '/' && next === '/') { index = source.indexOf('\n', index); if (index < 0) return -1; continue; }
    if (char === '/' && next === '*') { index = source.indexOf('*/', index + 2); if (index < 0) return -1; index += 1; continue; }
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

function integrateFrontend(frontendRoot, dashboard) {
  for (const relative of ['src/components/AdvertisingPage.jsx', 'src/styles/elisei-ads.css']) {
    copy(path.join(payload, 'frontend', relative), path.join(frontendRoot, relative));
  }
  backup(dashboard);
  let source = fs.readFileSync(dashboard, 'utf8');
  const componentPath = dashboard.includes(`${path.sep}pages${path.sep}`) ? '../components/AdvertisingPage.jsx' : './components/AdvertisingPage.jsx';
  source = addImport(source, `import AdvertisingPage from '${componentPath}';`);
  const marker = /\{\s*active\s*===\s*['"]ads['"]\s*&&/m.exec(source);
  if (marker) {
    const start = source.indexOf('{', marker.index);
    const end = findMatchingBrace(source, start);
    if (end < 0) throw new Error('Найден раздел ads, но не удалось определить границы JSX-блока.');
    source = `${source.slice(0, start)}{active === 'ads' && <AdvertisingPage />}${source.slice(end + 1)}`;
  } else if (source.includes('</Routes>')) {
    source = source.replace('</Routes>', `  <Route path="/ads" element={<AdvertisingPage />} />\n</Routes>`);
  } else if (/\bactive\b/.test(source)) {
    const returnIndex = source.search(/return\s*\(/);
    const openingTag = source.indexOf('>', returnIndex);
    if (returnIndex < 0 || openingTag < 0) throw new Error('Не удалось подключить AdvertisingPage к frontend.');
    source = `${source.slice(0, openingTag + 1)}\n      {active === 'ads' && <AdvertisingPage />}${source.slice(openingTag + 1)}`;
  } else {
    throw new Error('Не найден ни active=ads, ни React Router. Компонент скопирован, но страницу невозможно безопасно подключить автоматически.');
  }
  fs.writeFileSync(dashboard, source);
}

function integrateBackend(server) {
  const backendRoot = path.dirname(path.dirname(server));
  for (const relative of [
    'src/integrations/wb/promotionClient.cjs',
    'src/store/adsStore.cjs',
    'src/services/adsAnalytics.cjs',
    'src/services/cabinetTokenResolver.cjs',
    'src/services/adsService.cjs',
    'src/routes/adsCore.cjs',
    'src/routes/ads.js',
    'src/routes/ads.cjs',
  ]) copy(path.join(payload, 'backend', relative), path.join(backendRoot, relative));

  backup(server);
  let source = fs.readFileSync(server, 'utf8');
  if (!source.includes("app.use('/api/ads'")) {
    const esm = /^\s*import\s/m.test(source);
    source = esm
      ? addImport(source, "import adsRouter from './routes/ads.js';")
      : `const adsRouter = require('./routes/ads.cjs');\n${source}`;
    const authMiddleware = [...source.matchAll(/app\.use\([^;\n]*(?:auth|authenticate|session|passport)[^;\n]*\)\s*;?/gim)].at(-1);
    const jsonMiddleware = /app\.use\(express\.json\([^)]*\)\)\s*;?/m.exec(source);
    const appCreation = /const\s+app\s*=\s*express\(\)\s*;?/m.exec(source);
    const anchor = authMiddleware || jsonMiddleware || appCreation;
    if (!anchor) throw new Error('Не найден Express app в backend server/app.');
    const pos = anchor.index + anchor[0].length;
    source = `${source.slice(0, pos)}\napp.use('/api/ads', adsRouter);${source.slice(pos)}`;
    fs.writeFileSync(server, source);
  }
}

const dashboard = existing(['src/pages/DashboardPage.jsx', 'src/App.jsx', 'frontend/src/App.jsx', 'frontend_v2/src/App.jsx']);
if (!dashboard) throw new Error('Не найден frontend Елисея.');
const frontendRoot = dashboard.includes(`${path.sep}frontend${path.sep}`) || dashboard.includes(`${path.sep}frontend_v2${path.sep}`)
  ? path.dirname(path.dirname(dashboard))
  : projectRoot;
integrateFrontend(frontendRoot, dashboard);

const server = existing(['backend/src/server.js', 'backend/src/app.js', 'src/server.js']);
if (!server) throw new Error('Не найден backend/src/server.js или backend/src/app.js.');
integrateBackend(server);

fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
copy(path.join(patchRoot, 'docs/ADS_CONTRACT.md'), path.join(projectRoot, 'docs/ADS_CONTRACT.md'));
copy(path.join(patchRoot, 'docs/CABINET_TOKEN_RESOLVER_EXAMPLE.cjs'), path.join(projectRoot, 'docs/CABINET_TOKEN_RESOLVER_EXAMPLE.cjs'));
fs.writeFileSync(path.join(projectRoot, 'ELISEI_BUILD_5_3_13_WB_CABINET_TOKENS.txt'), [
  'ELISEI 5.3.13',
  'WB ADVERTISING CENTER: enabled',
  'PER-CABINET TOKEN RESOLUTION: enabled',
  'TENANT-SCOPED CACHE: enabled',
  'GLOBAL PERIOD + COMPARISON: enabled',
  'EL RECOMMENDATIONS: enabled',
  'WRITE OPERATIONS: disabled',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));

console.log('ELISEI 5.3.13: рекламный центр переведён на токен выбранного кабинета.');
console.log(`Frontend: ${path.relative(projectRoot, dashboard)}`);
console.log(`Backend: ${path.relative(projectRoot, server)}`);
console.log('Отдельный WB_PROMOTION_TOKEN не нужен.');
console.log('Для текущего кабинета используется WB_API_TOKEN; для клиентов подключите app.locals.resolveWbCabinetToken.');
