'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('translation files are complete and consistent (npm run check)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-locales.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
