/**
 * Node --require hook: intercept require('gologin') and route it to
 * ./fake-gologin.js. Loaded via NODE_OPTIONS="--require ..." in the
 * enterprise playwright config so the backend subprocess picks it up
 * before service.ts runs `require('gologin')` at module init.
 */
const Module = require('module');
const path = require('path');

const FAKE_PATH = path.resolve(__dirname, 'fake-gologin.js');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'gologin') return FAKE_PATH;
  return originalResolve.call(this, request, parent, ...rest);
};

console.log('[register-gologin] require("gologin") will resolve to', FAKE_PATH);
