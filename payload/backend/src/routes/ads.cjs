'use strict';
const express = require('express');
const { createAdsRouter } = require('./adsCore.cjs');
module.exports = createAdsRouter(express);
