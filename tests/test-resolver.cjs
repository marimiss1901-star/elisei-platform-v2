'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const resolver = require(path.resolve(__dirname, '../payload/backend/src/services/cabinetTokenResolver.cjs'));

(async () => {
  const req = {
    user: { id: 'user-1' },
    headers: { 'x-elisei-cabinet-id': 'cab-1' },
    app: {
      locals: {
        resolveWbCabinetToken: async ({ userId, cabinetId, permission }) => ({
          token: 'secret-token-1',
          userId,
          cabinetId,
          cabinetName: 'Мой кабинет',
          permission,
        }),
      },
    },
  };
  const first = await resolver.resolveCabinetContext(req);
  assert.equal(first.userId, 'user-1');
  assert.equal(first.cabinetId, 'cab-1');
  assert.equal(first.cabinetName, 'Мой кабинет');
  assert.equal(first.token, 'secret-token-1');
  assert.equal(first.tokenSource, 'application-resolver');
  assert.equal(resolver.publicCabinetContext(first).token, undefined);

  const second = await resolver.resolveCabinetContext({
    ...req,
    headers: { 'x-elisei-cabinet-id': 'cab-2' },
    app: {
      locals: {
        resolveWbCabinetToken: async ({ userId, cabinetId }) => ({ token: 'secret-token-2', userId, cabinetId }),
      },
    },
  });
  assert.notEqual(first.scopeKey, second.scopeKey);

  const previousMode = process.env.ELISEI_TOKEN_MODE;
  const previousToken = process.env.WB_API_TOKEN;
  const previousCabinet = process.env.WB_DEFAULT_CABINET_ID;
  process.env.ELISEI_TOKEN_MODE = 'environment';
  process.env.WB_API_TOKEN = 'render-token';
  process.env.WB_DEFAULT_CABINET_ID = 'render-cabinet';
  const environment = await resolver.resolveCabinetContext({ headers: {} });
  assert.equal(environment.cabinetId, 'render-cabinet');
  assert.equal(environment.tokenSource, 'render-environment');

  process.env.ELISEI_TOKEN_MODE = 'database';
  await assert.rejects(
    () => resolver.resolveCabinetContext({ headers: {} }),
    (error) => error.code === 'WB_CABINET_TOKEN_MISSING',
  );

  if (previousMode === undefined) delete process.env.ELISEI_TOKEN_MODE; else process.env.ELISEI_TOKEN_MODE = previousMode;
  if (previousToken === undefined) delete process.env.WB_API_TOKEN; else process.env.WB_API_TOKEN = previousToken;
  if (previousCabinet === undefined) delete process.env.WB_DEFAULT_CABINET_ID; else process.env.WB_DEFAULT_CABINET_ID = previousCabinet;
  console.log('resolver: ok');
})().catch((error) => { console.error(error); process.exit(1); });
