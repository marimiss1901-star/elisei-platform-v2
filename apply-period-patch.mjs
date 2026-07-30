import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const payload = path.join(patchRoot, 'payload');
const copy = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
};
const backup = (file) => {
  const target = `${file}.period-backup`;
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
};
const findExisting = (items) => items.map((item) => path.join(projectRoot, item)).find(fs.existsSync);

const frontendRoot = findExisting(['src/pages/DashboardPage.jsx', 'src/App.jsx'])
  ? projectRoot
  : findExisting(['frontend/src/App.jsx', 'frontend_v2/src/App.jsx'])
    ? path.dirname(path.dirname(findExisting(['frontend/src/App.jsx', 'frontend_v2/src/App.jsx'])))
    : null;

if (!frontendRoot) throw new Error('Не найден frontend: ожидался src/pages/DashboardPage.jsx, src/App.jsx, frontend/src/App.jsx или frontend_v2/src/App.jsx');

for (const relative of [
  'src/components/GlobalPeriodBar.jsx',
  'src/lib/periodStore.js',
  'src/styles/elisei-period.css',
]) {
  copy(path.join(payload, 'frontend', relative), path.join(frontendRoot, relative));
}

const dashboard = [
  path.join(frontendRoot, 'src/pages/DashboardPage.jsx'),
  path.join(frontendRoot, 'src/App.jsx'),
].find(fs.existsSync);
backup(dashboard);
let source = fs.readFileSync(dashboard, 'utf8');
const importPath = dashboard.includes(`${path.sep}pages${path.sep}`) ? '../components/GlobalPeriodBar.jsx' : './components/GlobalPeriodBar.jsx';
if (!source.includes('GlobalPeriodBar')) {
  const lastImport = [...source.matchAll(/^import .*;\s*$/gm)].at(-1);
  const insertion = `\nimport GlobalPeriodBar from '${importPath}';`;
  if (lastImport) source = source.slice(0, lastImport.index + lastImport[0].length) + insertion + source.slice(lastImport.index + lastImport[0].length);
  else source = insertion.trimStart() + '\n' + source;

  const returnIndex = source.search(/return\s*\(/);
  if (returnIndex < 0) throw new Error(`Не удалось найти return (...) в ${dashboard}`);
  const openingTag = source.indexOf('>', returnIndex);
  if (openingTag < 0) throw new Error(`Не удалось найти корневой JSX-тег в ${dashboard}`);
  source = source.slice(0, openingTag + 1) + '\n      <GlobalPeriodBar />' + source.slice(openingTag + 1);
  fs.writeFileSync(dashboard, source);
}

const server = findExisting(['backend/src/server.js']);
if (server) {
  const backendRoot = path.join(projectRoot, 'backend');
  for (const relative of [
    'src/lib/period.js', 'src/lib/period.cjs',
    'src/middleware/periodMiddleware.js', 'src/middleware/periodMiddleware.cjs',
  ]) copy(path.join(payload, 'backend', relative), path.join(backendRoot, relative));
  backup(server);
  let serverSource = fs.readFileSync(server, 'utf8');
  if (!serverSource.includes('periodMiddleware')) {
    const isEsm = /^\s*import\s/m.test(serverSource);
    const importLine = isEsm
      ? "import periodMiddleware from './middleware/periodMiddleware.js';\n"
      : "const periodMiddleware = require('./middleware/periodMiddleware.cjs');\n";
    serverSource = importLine + serverSource;
    const appCreation = /const\s+app\s*=\s*express\(\)\s*;?/m.exec(serverSource);
    if (!appCreation) throw new Error('Не найдено const app = express() в backend/src/server.js');
    const pos = appCreation.index + appCreation[0].length;
    serverSource = serverSource.slice(0, pos) + '\napp.use(periodMiddleware);' + serverSource.slice(pos);
    fs.writeFileSync(server, serverSource);
  }
}

copy(path.join(patchRoot, 'docs/PERIOD_CONTRACT.md'), path.join(projectRoot, 'docs/PERIOD_CONTRACT.md'));
fs.writeFileSync(path.join(projectRoot, 'ELISEI_BUILD_5_3_11_GLOBAL_PERIOD.txt'), [
  'ELISEI 5.3.11',
  'GLOBAL PERIOD: day / week / month / custom',
  'COMPARE: previous equivalent period',
  'EL CONTEXT: enabled',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));

console.log('ELISEI 5.3.11: глобальный период подключён.');
console.log(`Frontend: ${path.relative(projectRoot, dashboard)}`);
console.log(server ? 'Backend middleware: подключён.' : 'Backend server.js не найден — frontend патч применён без backend middleware.');
