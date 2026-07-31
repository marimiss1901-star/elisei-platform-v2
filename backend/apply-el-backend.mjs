import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const patchRoot=path.dirname(fileURLToPath(import.meta.url)); const root=process.cwd();
const candidates=['backend/src/server.js','backend/src/app.js','src/server.js','src/app.js','server.js','app.js'];
const rel=candidates.find((x)=>fs.existsSync(path.join(root,x))); if(!rel)throw new Error('Не найден Express backend server/app.');
const server=path.join(root,rel); const backendRoot=rel.startsWith('backend/')?path.join(root,'backend'):root;
const files=['src/routes/elCore.cjs','src/routes/el.cjs','src/routes/el.js','src/services/openaiResponsesClient.cjs','src/services/elSources.cjs','src/services/elMemoryStore.cjs','src/services/elContext.cjs','src/services/elPrompt.cjs','src/services/elAgent.cjs'];
for(const relative of files){const src=path.join(patchRoot,'payload/backend',relative),dst=path.join(backendRoot,relative);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
const backup=server+'.el-5.3.19-backup';if(!fs.existsSync(backup))fs.copyFileSync(server,backup);
let source=fs.readFileSync(server,'utf8');
function addImport(s,line){if(s.includes("./routes/el."))return s;const imports=[...s.matchAll(/^import .*;\s*$/gm)];if(!imports.length)return line+'\n'+s;const last=imports.at(-1),pos=last.index+last[0].length;return s.slice(0,pos)+'\n'+line+s.slice(pos);}
if(!source.includes("app.use('/api/el'")){
 const esm=/^\s*import\s/m.test(source);
 source=esm?addImport(source,"import elRouter from './routes/el.js';"):"const elRouter = require('./routes/el.cjs');\n"+source;
 const auth=[...source.matchAll(/app\.use\([^;\n]*(?:auth|authenticate|session|passport)[^;\n]*\)\s*;?/gim)].at(-1);
 const json=/app\.use\(express\.json\([^)]*\)\)\s*;?/m.exec(source); const app=/const\s+app\s*=\s*express\(\)\s*;?/m.exec(source); const anchor=auth||json||app;
 if(!anchor)throw new Error('Не найден Express app для подключения /api/el.'); const pos=anchor.index+anchor[0].length; source=source.slice(0,pos)+"\napp.use('/api/el', elRouter);"+source.slice(pos);
 fs.writeFileSync(server,source);
}
for(const doc of ['EL_ARCHITECTURE.md','EL_MEMORY_POSTGRES.sql','ENVIRONMENT.md']){const dst=path.join(root,'docs',doc);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(patchRoot,'docs',doc),dst);}
fs.writeFileSync(path.join(root,'ELISEI_BUILD_5_3_19_EL_BACKEND.txt'),'ELISEI 5.3.19 EL BACKEND\n'+new Date().toISOString());
console.log('Эл 5.3.19 backend установлен в '+rel+'; route /api/el подключён.');
