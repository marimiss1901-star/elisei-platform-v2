import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const exists = (p) => fs.existsSync(p);
const findFirst = (items) => items.find(exists);

const server = findFirst([
  path.join(cwd, 'src', 'server.js'),
  path.join(cwd, 'src', 'app.js'),
  path.join(cwd, 'server.js'),
  path.join(cwd, 'app.js'),
  path.join(cwd, 'backend', 'src', 'server.js'),
  path.join(cwd, 'backend', 'src', 'app.js'),
]);

if (!server) {
  throw new Error(`Не найден backend server.js/app.js. Текущая папка: ${cwd}`);
}

// Важно: определяем корень backend по ОТНОСИТЕЛЬНОМУ пути.
// При Render Root Directory=backend cwd уже является корнем backend.
const relativeServer = path.relative(cwd, server).split(path.sep).join('/');
const backendRoot = relativeServer.startsWith('backend/')
  ? path.join(cwd, 'backend')
  : cwd;

const payloadBase = findFirst([
  path.join(scriptDir, 'payload', 'backend'),
  path.join(cwd, 'payload', 'backend'),
  path.join(cwd, 'backend', 'payload', 'backend'),
]);

if (!payloadBase) {
  throw new Error(`Не найден payload/backend. scriptDir=${scriptDir}; cwd=${cwd}`);
}

const files = [
  'src/routes/elCore.cjs',
  'src/routes/el.cjs',
  'src/routes/el.js',
  'src/services/openaiResponsesClient.cjs',
  'src/services/elSources.cjs',
  'src/services/elMemoryStore.cjs',
  'src/services/elContext.cjs',
  'src/services/elModuleRegistry.cjs',
  'src/services/elBusinessDataBridge.cjs',
  'src/services/elPrompt.cjs',
  'src/services/elAgent.cjs',
];

for (const relative of files) {
  const src = path.join(payloadBase, relative);
  const dst = path.join(backendRoot, relative);
  if (!exists(src)) throw new Error(`В патче отсутствует ${relative}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const backup = `${dst}.el-5.3.20B-backup`;
  if (exists(dst) && !exists(backup)) fs.copyFileSync(dst, backup);
  fs.copyFileSync(src, dst);
}

const serverBackup = `${server}.el-5.3.20B-backup`;
if (!exists(serverBackup)) fs.copyFileSync(server, serverBackup);
let source = fs.readFileSync(server, 'utf8');

function addEsmImport(text) {
  if (text.includes("./routes/el.js")) return text;
  const imports = [...text.matchAll(/^import .*;\s*$/gm)];
  if (!imports.length) return `import elRouter from './routes/el.js';\n${text}`;
  const last = imports.at(-1);
  const pos = last.index + last[0].length;
  return `${text.slice(0, pos)}\nimport elRouter from './routes/el.js';${text.slice(pos)}`;
}

function addCjsImport(text) {
  if (text.includes("./routes/el.cjs")) return text;
  return `const elRouter = require('./routes/el.cjs');\n${text}`;
}

if (!source.includes("app.use('/api/el'")) {
  const isEsm = /^\s*import\s/m.test(source);
  source = isEsm ? addEsmImport(source) : addCjsImport(source);

  const auth = [...source.matchAll(/app\.use\([^;\n]*(?:auth|authenticate|session|passport)[^;\n]*\)\s*;?/gim)].at(-1);
  const json = /app\.use\(express\.json\([^)]*\)\)\s*;?/m.exec(source);
  const app = /const\s+app\s*=\s*express\(\)\s*;?/m.exec(source);
  const anchor = auth || json || app;
  if (!anchor) throw new Error('Не найден Express app для подключения /api/el.');
  const pos = anchor.index + anchor[0].length;
  source = `${source.slice(0, pos)}\napp.use('/api/el', elRouter);${source.slice(pos)}`;
}

fs.writeFileSync(server, source);

// Проверка именно тех путей, из которых server.js выполняет import.
const requiredRuntimeFiles = [
  path.join(path.dirname(server), 'routes', 'el.js'),
  path.join(path.dirname(server), 'routes', 'elCore.cjs'),
  path.join(path.dirname(server), 'services', 'elAgent.cjs'),
];
for (const file of requiredRuntimeFiles) {
  if (!exists(file)) throw new Error(`После установки отсутствует runtime-файл: ${file}`);
}

fs.writeFileSync(
  path.join(backendRoot, 'ELISEI_BUILD_5_3_20B_EL_BACKEND_ROOT_FIX.txt'),
  [
    'ELISEI 5.3.20B — EL BACKEND ROOT FIX',
    `cwd: ${cwd}`,
    `backendRoot: ${backendRoot}`,
    `server: ${server}`,
    'MODULES: overview,sales,advertising,stocks,finance,products,returns,reviews,pricing,seasonality,procurement,sync',
    'WRITE ACTIONS: disabled',
    `Applied: ${new Date().toISOString()}`,
  ].join('\n'),
);

console.log('ELISEI 5.3.20B установлен успешно.');
console.log(`Backend root: ${backendRoot}`);
console.log(`Server: ${server}`);
console.log(`El route: ${path.join(path.dirname(server), 'routes', 'el.js')}`);
