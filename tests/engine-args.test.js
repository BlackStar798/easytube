'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDownloadArgs, buildCommonArgs, subLangsArg, friendlyError, summarize } = require('../lib/engine');

const base = { url: 'https://example.com/v', kind: 'video', height: 1080, outDir: 'C:\\Out' };
const has = (args, ...seq) => args.some((_, i) => seq.every((s, j) => args[i + j] === s));

test('video download keeps the 1.x command line (no regression)', () => {
  const a = buildDownloadArgs(base, { ffmpegDir: 'C:\\bin' });
  assert.deepEqual(a.slice(0, 7), ['--ignore-config', '--color', 'never', '--socket-timeout', '30', '--ffmpeg-location', 'C:\\bin']);
  for (const seq of [
    ['--quiet'], ['--progress'], ['--newline'], ['--no-simulate'], ['--no-mtime'], ['--windows-filenames'],
    ['--trim-filenames', '180'], ['--concurrent-fragments', '4'], ['--retries', '10'], ['--fragment-retries', '10'],
    ['-P', 'C:\\Out'], ['--no-playlist'], ['-o', '%(title)s.%(ext)s'],
    ['-f', 'bv*[height<=?1080]+ba/b[height<=?1080]'], ['-S', 'res,vcodec:h264,acodec:aac'],
    ['--merge-output-format', 'mp4'], ['--embed-metadata'],
    ['--print', 'after_move:FILE|%(filepath)s'], ['--print', 'before_dl:FMT|%(format_id)s'],
  ]) assert.ok(has(a, ...seq), seq.join(' '));
  assert.equal(a[a.length - 2], '--');
  assert.equal(a[a.length - 1], 'https://example.com/v');
  assert.ok(!a.includes('--limit-rate') && !a.includes('--proxy') && !a.includes('--js-runtimes') && !a.includes('--write-subs'));
});

test('the UTF-8 path file is only requested when the engine provides one', () => {
  assert.ok(!buildDownloadArgs(base).includes('--print-to-file'));
  const a = buildDownloadArgs({ ...base, pathsFile: 'C:\\Temp\\p%1.txt' });
  assert.ok(has(a, '--print-to-file', 'after_move:%(filepath)s', 'C:\\Temp\\p%%1.txt'));
  assert.ok(has(a, '--print', 'after_move:FILE|%(filepath)s'), 'stdout line kept as a fallback');
});

test('MKV container: no codec preference, mkv merge', () => {
  const a = buildDownloadArgs({ ...base, height: 2160, container: 'mkv' });
  assert.ok(has(a, '-S', 'res'));
  assert.ok(has(a, '--merge-output-format', 'mkv'));
  assert.ok(has(a, '-f', 'bv*[height<=?2160]+ba/b[height<=?2160]'));
});

test('best quality has no height filter', () => {
  const a = buildDownloadArgs({ ...base, height: 'best' });
  assert.ok(has(a, '-f', 'bv*+ba/b'));
});

test('audio download', () => {
  const a = buildDownloadArgs({ ...base, kind: 'audio', audioFormat: 'm4a', container: 'mkv' });
  assert.ok(has(a, '-f', 'bestaudio/best'));
  assert.ok(has(a, '-x') && has(a, '--audio-format', 'm4a') && has(a, '--audio-quality', '0'));
  assert.ok(!a.includes('--merge-output-format'));
});

test('subtitles use the configured languages and their -orig variants', () => {
  assert.equal(subLangsArg('fr,en,ar'), 'fr,en,ar,fr-orig,en-orig,ar-orig');
  assert.equal(subLangsArg(''), 'fr,en,ar,fr-orig,en-orig,ar-orig');
  const a = buildDownloadArgs({ ...base, subs: true }, { subLangs: 'es,pt-BR' });
  assert.ok(has(a, '--sub-langs', 'es,pt-BR,es-orig,pt-BR-orig'));
  assert.ok(has(a, '--write-subs') && has(a, '--embed-subs') && has(a, '--ignore-errors'));
  assert.ok(!buildDownloadArgs({ ...base, kind: 'audio', subs: true }).includes('--write-subs'));
});

test('playlist: folder template and selected items', () => {
  const all = buildDownloadArgs({ ...base, playlist: true, playlistItems: [] });
  assert.ok(has(all, '--yes-playlist'));
  assert.ok(has(all, '-o', '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s'));
  assert.ok(!all.includes('--playlist-items'));
  const some = buildDownloadArgs({ ...base, playlist: true, playlistItems: [1, 2, 3, 7] });
  assert.ok(has(some, '--playlist-items', '1-3,7'));
  // items are ignored for a single video
  assert.ok(!buildDownloadArgs({ ...base, playlist: false, playlistItems: [1] }).includes('--playlist-items'));
});

test('speed limit, proxy and cookies', () => {
  const a = buildDownloadArgs(base, { limitRate: '2M', proxy: 'http://127.0.0.1:8080' });
  assert.ok(has(a, '--limit-rate', '2M') && has(a, '--proxy', 'http://127.0.0.1:8080'));
  assert.ok(has(buildCommonArgs({ cookiesBrowser: 'firefox' }), '--cookies-from-browser', 'firefox'));
  assert.ok(has(buildCommonArgs({ cookiesBrowser: 'safari' }), '--cookies-from-browser', 'safari'));
  assert.ok(has(buildCommonArgs({ cookiesBrowser: 'file', cookiesFile: 'C:\\c.txt' }), '--cookies', 'C:\\c.txt'));
  const none = buildCommonArgs({ cookiesBrowser: 'file', cookiesFile: '' });
  assert.ok(!none.includes('--cookies') && !none.includes('--cookies-from-browser'));
});

test('JavaScript runtime is added next to the default Deno, not instead of it', () => {
  const a = buildCommonArgs({ jsRuntimePath: 'C:\\App\\EasyTube.exe' });
  assert.ok(has(a, '--js-runtimes', 'node:C:\\App\\EasyTube.exe'));
  assert.ok(!a.includes('--no-js-runtimes'));
});

test('friendly errors', () => {
  const cases = [
    ['ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271', 'cookies'],
    ['Failed to decrypt with DPAPI', 'cookies'],
    ['PermissionError: [Errno 1] Operation not permitted: \'/Users/x/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies\'', 'cookies'],
    ['ERROR: could not find chrome Safe Storage password in the keychain', 'cookies'],
    ['ERROR: [youtube] x: Sign in to confirm you’re not a bot', 'bot'],
    ['ERROR: [youtube] x: Sign in to confirm your age', 'age'],
    ['ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access', 'private'],
    ['ERROR: This video is private', 'private'],
    ['ERROR: [youtube] x: Join this channel to get access to members-only content', 'members'],
    ['ERROR: [youtube] x: Requested format is not available. Use --list-formats', 'format'],
    ['ERROR: [youtube] x: Only images are available for download', 'format'],
    ['WARNING: No supported JavaScript runtime could be found', 'jsrt'],
    ['ERROR: [youtube] n challenge solving failed', 'jsrt'],
    ['ERROR: Video unavailable', 'unavailable'],
    ['ERROR: Unsupported URL: http://x', 'unsupported'],
    ['ERROR: Premieres in 3 hours', 'upcoming'],
    ['HTTP Error 429: Too Many Requests', 'rate'],
    ['HTTP Error 403: Forbidden', 'forbidden'],
    ['ERROR: ffprobe and ffmpeg not found', 'ffmpeg'],
    ['ERROR: unable to download: <urlopen error [Errno 11001] getaddrinfo failed>', 'network'],
    ['SSLError: CERTIFICATE_VERIFY_FAILED', 'ssl'],
    ['OSError: [Errno 28] No space left on device', 'disk'],
    ['PermissionError: [Errno 13] Permission denied', 'perm'],
    ['something nobody expected', 'generic'],
  ];
  for (const [text, code] of cases) assert.equal(friendlyError(text).code, code, text);
  assert.equal(friendlyError('x').detail, 'x');
});

test('summarize: video heights and sizes', () => {
  const s = summarize({
    id: 'a', title: 'T', duration: 100, uploader: 'U',
    formats: [
      { height: 1080, vcodec: 'avc1', acodec: 'none', filesize: 8000000, tbr: 1000 },
      { height: 720, vcodec: 'avc1', acodec: 'none', filesize: 4000000, tbr: 500 },
      { vcodec: 'none', acodec: 'opus', abr: 128, filesize: 1000000 },
    ],
  }, 'https://x');
  assert.equal(s.kind, 'video');
  assert.deepEqual(s.heights.map((x) => x.h), [1080, 720]);
  assert.equal(s.heights[0].size, 9000000);
  assert.equal(s.audioSize, 1000000);
});

test('summarize: playlist keeps the real position of each entry', () => {
  const s = summarize({ _type: 'playlist', title: 'L', playlist_count: 3, entries: [{ title: 'A', duration: 10 }, null, { title: 'B' }] }, 'https://x');
  assert.equal(s.kind, 'playlist');
  assert.equal(s.count, 3);
  assert.deepEqual(s.items.map((i) => [i.index, i.title]), [[1, 'A'], [3, 'B']]);
});
