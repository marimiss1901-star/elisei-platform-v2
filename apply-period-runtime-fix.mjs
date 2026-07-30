import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const payload = path.join(patchRoot, 'payload');
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const backup = (file) => { if (!file || !fs.existsSync(file)) return; const target = `${file}.period-5.3.14-backup`; if (!fs.existsSync(target)) fs.copyFileSync(file, target); };
const existing = (items) => items.map((item) => path.join(projectRoot, item)).find(fs.existsSync);
function addImport(source, line) {
  const symbol = line.match(/import\s+([^\s{]+)/)?.[1];
  if ((symbol && source.includes(symbol)) || source.includes(line)) return source;
  const imports = [...source.matchAll(/^import .*;\s*$/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports.at(-1); const pos = last.index + last[0].length;
  return `${source.slice(0, pos)}\n${line}${source.slice(pos)}`;
}

const dashboard = existing(['src/pages/DashboardPage.jsx','src/App.jsx','frontend/src/App.jsx','frontend_v2/src/App.jsx']);
if (!dashboard) throw new Error('Не найден frontend Елисея.');
const frontendRoot = dashboard.includes(`${path.sep}frontend${path.sep}`) || dashboard.includes(`${path.sep}frontend_v2${path.sep}`) ? path.dirname(path.dirname(dashboard)) : projectRoot;
for (const rel of ['src/components/GlobalPeriodBar.jsx','src/lib/periodStore.js','src/styles/elisei-period.css']) copy(path.join(payload,'frontend',rel), path.join(frontendRoot,rel));
backup(dashboard);
let source = fs.readFileSync(dashboard,'utf8');
const componentPath = dashboard.includes(`${path.sep}pages${path.sep}`) ? '../components/GlobalPeriodBar.jsx' : './components/GlobalPeriodBar.jsx';
source = addImport(source, `import GlobalPeriodBar from '${componentPath}';`);
if (!/<GlobalPeriodBar\b/.test(source)) {
  const returnIndex = source.search(/return\s*\(/);
  const openingTag = source.indexOf('>', returnIndex);
  if (returnIndex < 0 || openingTag < 0) throw new Error('Не удалось подключить GlobalPeriodBar.');
  source = `${source.slice(0, openingTag + 1)}\n      <GlobalPeriodBar />${source.slice(openingTag + 1)}`;
}
fs.writeFileSync(dashboard, source);

const server = existing(['backend/src/server.js','backend/src/app.js','src/server.js']);
if (!server) throw new Error('Не найден backend server/app.');
const backendRoot = server.includes(`${path.sep}backend${path.sep}`) ? path.join(projectRoot,'backend') : projectRoot;
for (const rel of ['src/lib/period.js','src/lib/period.cjs','src/middleware/periodMiddleware.js','src/middleware/periodMiddleware.cjs']) copy(path.join(payload,'backend',rel), path.join(backendRoot,rel));
backup(server);
let serverSource = fs.readFileSync(server,'utf8');
const esm = /^\s*import\s/m.test(serverSource);
if (!serverSource.includes('periodMiddleware')) {
  serverSource = esm ? addImport(serverSource, "import periodMiddleware from './middleware/periodMiddleware.js';") : `const periodMiddleware = require('./middleware/periodMiddleware.cjs');\n${serverSource}`;
}
serverSource = serverSource.replace(/^\s*app\.use\(periodMiddleware\);?\s*$/gm, '');
const routes = [...serverSource.matchAll(/app\.(?:use|get|post|put|patch|delete)\(\s*['"]\/api\//gm)];
const json = [...serverSource.matchAll(/app\.use\(express\.json\([^;\n]*\)\)\s*;?/gm)].at(-1);
const app = /const\s+app\s*=\s*express\(\)\s*;?/m.exec(serverSource);
const anchor = json || app;
if (!anchor) throw new Error('Не найден Express app.');
let insertPos = anchor.index + anchor[0].length;
if (routes.length && routes[0].index < insertPos) insertPos = routes[0].index;
serverSource = `${serverSource.slice(0, insertPos)}\napp.use(periodMiddleware);\n${serverSource.slice(insertPos)}`;
fs.writeFileSync(server, serverSource);

fs.mkdirSync(path.join(projectRoot,'docs'),{recursive:true});
copy(path.join(patchRoot,'docs/PERIOD_RUNTIME_FIX.md'), path.join(projectRoot,'docs/PERIOD_RUNTIME_FIX.md'));
fs.writeFileSync(path.join(projectRoot,'ELISEI_BUILD_5_3_14_PERIOD_RUNTIME_FIX.txt'), [
  'ELISEI 5.3.14',
  'PERIOD REQUEST INTERCEPTORS: EARLY FETCH + XHR',
  'LEGACY PAGE REFRESH: ENABLED',
  'BACKEND DATE ALIASES: ENABLED',
  'ADS + EL PERIOD: ENABLED',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));
console.log('ELISEI 5.3.14: фильтр периода подключён к реальным запросам.');
console.log(`Frontend: ${path.relative(projectRoot,dashboard)}`);
console.log(`Backend: ${path.relative(projectRoot,server)}`);
