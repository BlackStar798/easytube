'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const updater = require('../lib/updater');
const { checkApp } = require('../lib/appupdate');

const redirect = (loc) => async () => ({ headers: { get: (h) => (h.toLowerCase() === 'location' ? loc : null) } });

test('assetName: the official yt-dlp file for each system', () => {
  const real = process.platform;
  const as = (p) => { Object.defineProperty(process, 'platform', { value: p }); try { return updater.assetName(); } finally { Object.defineProperty(process, 'platform', { value: real }); } };
  assert.equal(as('win32'), 'yt-dlp.exe');
  assert.equal(as('darwin'), 'yt-dlp_macos');
  assert.equal(as('linux'), 'yt-dlp_linux');
});

test('compareVersions', () => {
  const c = updater.compareVersions;
  assert.ok(c('2026.10.26', '2026.9.30') > 0);
  assert.ok(c('2026.9.30', '2026.10.26') < 0);
  assert.equal(c('2026.10.26', '2026.10.26'), 0);
  assert.ok(c('v2.0.1', '2.0.0') > 0);
  assert.ok(c('2.0.0', '1.5.0') > 0);
  assert.ok(c('2.0', '2.0.0') === 0);
  assert.ok(c('2.0.0-beta', '2.0.0') === 0);
  assert.ok(c('10.0.0', '9.9.9') > 0);
});

test('latestRelease reads the tag from the redirect', async () => {
  const r = await updater.latestRelease('https://github.com/o/r/releases', redirect('https://github.com/o/r/releases/tag/v2.1.0'));
  assert.equal(r.tag, 'v2.1.0');
  await assert.rejects(updater.latestRelease('https://github.com/o/r/releases', redirect('')), /latest version/);
});

test('checkApp: newer, same, older, bad repository', async () => {
  const repo = 'https://github.com/o/r';
  const f = redirect(`${repo}/releases/tag/v2.1.0`);
  assert.deepEqual(await checkApp({ repo, current: '2.0.0', fetchImpl: f }), { available: true, latest: '2.1.0', url: `${repo}/releases/latest` });
  assert.equal((await checkApp({ repo, current: '2.1.0', fetchImpl: f })).available, false);
  assert.equal((await checkApp({ repo, current: '3.0.0', fetchImpl: f })).available, false);
  assert.equal((await checkApp({ repo, current: '2.0.0', fetchImpl: redirect(`${repo}/releases/tag/nightly`) })).available, false);
  await assert.rejects(checkApp({ repo: '', current: '2.0.0', fetchImpl: f }));
  await assert.rejects(checkApp({ repo: 'https://evil.example/o/r', current: '2.0.0', fetchImpl: f }));
  await assert.rejects(checkApp({ repo: 'https://github.com/o/r; calc', current: '2.0.0', fetchImpl: f }));
});
