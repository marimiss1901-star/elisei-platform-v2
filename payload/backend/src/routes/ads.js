import express from 'express';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAdsRouter } = require('./adsCore.cjs');
export default createAdsRouter(express);
