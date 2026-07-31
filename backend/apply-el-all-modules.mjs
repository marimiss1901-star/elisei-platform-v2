import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const candidates = ['backend/src/server.js','backend/src/app.js','src/server.js','src/app.js','server.js','app.js'];
const rel = candidates.find((item) => fs.existsSync(path.join(root, item)));
if (!rel) throw new Error('Не найден Express backend server/app. Запусти установщик из папки backend или корня монорепозитория.');
const server = path.join(root, rel);
const backendRoot = rel.startsWith('backend/') ? path.join(root, 'backend') : root;
const files = [
  'src/routes/elCore.cjs','src/routes/el.cjs','src/routes/el.js',
  'src/services/openaiResponsesClient.cjs','src/services/elSources.cjs','src/services/elMemoryStore.cjs','src/services/elContext.cjs',
  'src/services/elModuleRegistry.cjs','src/services/elBusinessDataBridge.cjs','src/services/elPrompt.cjs','src/services/elAgent.cjs',
];
for (const relative of files) {
  const src = path.join(patchRoot, 'payload/backend', relative);
  const dst = path.join(backendRoot, relative);
  if (!fs.existsSync(src)) throw new Error(`В патче отсутствует ${relative}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst) && !fs.existsSync(`${dst}.el-5.3.20-backup`)) fs.copyFileSync(dst, `${dst}.el-5.3.20-backup`);
  fs.copyFileSync(src, dst);
}
const backup = `${server}.el-5.3.20-backup`;
if (!fs.existsSync(backup)) fs.copyFileSync(server, backup);
let source = fs.readFileSync(server, 'utf8');
function addImport(text, line) {
  if (text.includes("./routes/el.")) return text;
  const imports = [...text.matchAll(/^import .*;\s*$/gm)];
  if (!imports.length) return `${line}\n${text}`;
  const last = imports.at(-1); const pos = last.index + last[0].length;
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
fs.writeFileSync(path.join(backendRoot, 'ELISEI_BUILD_5_3_20_EL_ALL_MODULES.txt'), [
  'ELISEI 5.3.20 — EL WHOLE BUSINESS BRAIN',
  'MODULES: overview,sales,advertising,stocks,finance,products,returns,reviews,pricing,seasonality,procurement,sync',
  'CROSS-MODULE ANALYSIS: enabled',
  'INTERNAL API BRIDGE: read-only',
  'WRITE ACTIONS: disabled',
  `Applied: ${new Date().toISOString()}`,
].join('\n'));
console.log(`ELISEI 5.3.20 backend установлен в ${rel}; Эл видит все бизнес-модули в read-only режиме.`);
