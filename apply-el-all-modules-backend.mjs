import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const findFirst = (items) => items.find((p) => fs.existsSync(p));

const server = findFirst([
  path.join(cwd, 'backend', 'src', 'server.js'),
  path.join(cwd, 'backend', 'src', 'app.js'),
  path.join(cwd, 'src', 'server.js'),
  path.join(cwd, 'src', 'app.js'),
  path.join(cwd, 'server.js'),
  path.join(cwd, 'app.js'),
]);
if (!server) throw new Error(`Не найден Express backend server/app. Текущая папка: ${cwd}`);

const backendRoot = server.includes(`${path.sep}backend${path.sep}`) ? path.join(cwd, 'backend') : cwd;
const payloadBase = findFirst([
  path.join(scriptDir, 'payload', 'backend'),
  path.join(scriptDir, 'backend', 'payload', 'backend'),
  path.join(cwd, 'payload', 'backend'),
  path.join(cwd, 'backend', 'payload', 'backend'),
]);
if (!payloadBase) throw new Error('Не найден backend payload патча.');

const files = [
  'src/routes/elCore.cjs','src/routes/el.cjs','src/routes/el.js',
  'src/services/openaiResponsesClient.cjs','src/services/elSources.cjs','src/services/elMemoryStore.cjs','src/services/elContext.cjs',
  'src/services/elModuleRegistry.cjs','src/services/elBusinessDataBridge.cjs','src/services/elPrompt.cjs','src/services/elAgent.cjs',
];
for (const relative of files) {
  const src = path.join(payloadBase, relative);
  const dst = path.join(backendRoot, relative);
  if (!fs.existsSync(src)) throw new Error(`В патче отсутствует ${relative}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst) && !fs.existsSync(`${dst}.el-5.3.20A-backup`)) fs.copyFileSync(dst, `${dst}.el-5.3.20A-backup`);
  fs.copyFileSync(src, dst);
}

const backup = `${server}.el-5.3.20A-backup`;
if (!fs.existsSync(backup)) fs.copyFileSync(server, backup);
let source = fs.readFileSync(server, 'utf8');
function addImport(text, line) {
  if (text.includes("./routes/el.")) return text;
  const imports = [...text.matchAll(/^import .*;\s*$/gm)];
  if (!imports.length) return `${line}\n${text}`;
  const last = imports.at(-1);
  const pos = last.index + last[0].length;
  return `${text.slice(0, pos)}\n${line}${text.slice(pos)}`;
}
if (!source.includes("app.use('/api/el'")) {
  const esm = /^\s*import\s/m.test(source);
  source = esm ? addImport(source, "import elRouter from './routes/el.js';") : `const elRouter = require('./routes/el.cjs');\n${source}`;
  const auth = [...source.matchAll(/app\.use\([^;\n]*(?:auth|authenticate|session|passport)[^;\n]*\)\s*;?/gim)].at(-1);
  const json = /app\.use\(express\.json\([^)]*\)\)\s*;?/m.exec(source);
  const app = /const\s+app\s*=\s*express\(\)\s*;?/m.exec(source);
  const anchor = auth || json || app;
  if (!anchor) throw new Error('Не найден Express app для подключения /api/el.');
  const pos = anchor.index + anchor[0].length;
  source = `${source.slice(0, pos)}\napp.use('/api/el', elRouter);${source.slice(pos)}`;
  fs.writeFileSync(server, source);
}
fs.writeFileSync(path.join(backendRoot, 'ELISEI_BUILD_5_3_20A_EL_ALL_MODULES.txt'), [
  'ELISEI 5.3.20A — EL WHOLE BUSINESS BRAIN',
  'MODULES: overview,sales,advertising,stocks,finance,products,returns,reviews,pricing,seasonality,procurement,sync',
  'CROSS-MODULE ANALYSIS: enabled',
  'INTERNAL API BRIDGE: read-only',
  'WRITE ACTIONS: disabled',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));
console.log(`ELISEI 5.3.20A backend установлен: ${path.relative(cwd, server)}`);
