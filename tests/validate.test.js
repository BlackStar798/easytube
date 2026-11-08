'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../lib/validate');

test('settings patch: keeps valid values, drops unknown keys and bad values', () => {
  const out = v.sanitizeSettingsPatch({
    kind: 'audio', quality: 720, audioFormat: 'm4a', container: 'mkv', subs: true, cookies: 'firefox',
    accent: '#22c55e', sound: false, lang: 'fr', welcomeSeen: true, platformTheme: false, autoCheck: false,
    limitRate: '2M', proxy: 'socks5://127.0.0.1:1080', subLangs: 'FR, en',
    evil: '--exec calc', history: [{ x: 1 }], cookiesFile: 'C:\\x.txt', jsHelper: 'yes',
  });
  assert.deepEqual(out, {
    kind: 'audio', quality: 720, audioFormat: 'm4a', container: 'mkv', subs: true, cookies: 'firefox',
    accent: '#22c55e', sound: false, lang: 'fr', welcomeSeen: true, platformTheme: false, autoCheck: false,
    limitRate: '2M', proxy: 'socks5://127.0.0.1:1080', subLangs: 'fr,en',
  });
});

test('settings patch: rejects out-of-list values', () => {
  const bad = {
    kind: 'gif', quality: 999, audioFormat: 'wav', container: 'avi', cookies: 'opera', accent: 'red',
    lang: 'de', limitRate: '999G', proxy: 'ftp://x', subLangs: 'toolongcode', folder: '',
  };
  assert.deepEqual(v.sanitizeSettingsPatch(bad), {});
  assert.deepEqual(v.sanitizeSettingsPatch(null), {});
  assert.deepEqual(v.sanitizeSettingsPatch('x'), {});
  assert.equal(v.sanitizeSettingsPatch({ quality: 'best' }).quality, 'best');
});

test('settings patch: Safari is an accepted cookie source (macOS)', () => {
  assert.equal(v.sanitizeSettingsPatch({ cookies: 'safari' }).cookies, 'safari');
});

test('settings patch: the cookies file path can only be set by the main process', () => {
  assert.equal('cookiesFile' in v.sanitizeSettingsPatch({ cookiesFile: 'C:\\secret.txt' }), false);
});

test('proxy validation', () => {
  for (const ok of ['', 'http://127.0.0.1:8080', 'https://proxy.example.com', 'socks5h://u:p@host:1080', 'socks4a://10.0.0.1:9050/']) {
    assert.notEqual(v.validProxy(ok), null, ok);
  }
  for (const bad of ['http://a b', 'ftp://x', 'javascript:alert(1)', 'http://', '--proxy x', 'http://h:99999999', 'x'.repeat(300)]) {
    assert.equal(v.validProxy(bad), null, bad);
  }
});

test('subtitle languages: normalisation and limits', () => {
  assert.equal(v.normalizeSubLangs('FR, en  pt-BR;fr'), 'fr,en,pt-BR');
  assert.equal(v.normalizeSubLangs(''), null);
  assert.equal(v.normalizeSubLangs('a'), null);
  assert.equal(v.normalizeSubLangs('fr,en,es,de,it,pt,ar,ja,ko'), null);
  assert.equal(v.normalizeSubLangs('fr; rm -rf'), null);
});

test('playlist items: clean list and yt-dlp spec', () => {
  assert.deepEqual(v.cleanItems([5, 1, 1, 'x', -2, 0, 3.5, 2, 100001]), [1, 2, 5]);
  assert.deepEqual(v.cleanItems('1,2'), []);
  assert.equal(v.cleanItems(Array.from({ length: 5000 }, (_, i) => i + 1)).length, v.MAX_ITEMS);
  assert.equal(v.itemsToSpec([1, 2, 3, 5, 6, 7, 9]), '1-3,5-7,9');
  assert.equal(v.itemsToSpec([4]), '4');
  assert.equal(v.itemsToSpec([]), '');
});

test('download options: defaults and clean values', () => {
  assert.deepEqual(v.sanitizeDownloadOpts(undefined, { container: 'mkv' }), {
    kind: 'video', height: 1080, audioFormat: 'mp3', container: 'mkv', subs: false, playlist: false,
    playlistItems: [], title: '', thumbnail: '',
  });
  const o = v.sanitizeDownloadOpts({
    kind: 'audio', height: 'best', audioFormat: 'm4a', container: 'mp4', subs: true, playlist: true,
    playlistItems: [3, 1, 'x'], title: 'T'.repeat(500), thumbnail: 'javascript:alert(1)',
  });
  assert.equal(o.kind, 'audio');
  assert.equal(o.height, 'best');
  assert.equal(o.subs, true);
  assert.deepEqual(o.playlistItems, [1, 3]);
  assert.equal(o.title.length, 300);
  assert.equal(o.thumbnail, '');
});

test('download options: odd values never reach yt-dlp', () => {
  const o = v.sanitizeDownloadOpts({
    kind: '-x --exec calc', height: '1080; calc', audioFormat: '../../x', container: 'avi', playlist: 'true', playlistItems: [1],
  });
  assert.equal(o.kind, 'video');
  assert.equal(o.height, 1080);
  assert.equal(o.audioFormat, 'mp3');
  assert.equal(o.container, 'mp4');
  assert.equal(o.playlist, false);
  assert.deepEqual(o.playlistItems, []);
});
