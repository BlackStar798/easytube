#!/usr/bin/env node
'use strict';
// A stand-in for yt-dlp.exe used by the tests: records its command line and plays a scenario.
// FAKE_ARGS_FILE = where to write {argv, env} as JSON. FAKE_MODE = ok | format | jsrt | hang | analyze | enc | nofile
const fs = require('fs');
const { spawn } = require('child_process');

if (process.env.FAKE_ARGS_FILE) {
  fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({
    argv: process.argv.slice(2),
    runAsNode: process.env.ELECTRON_RUN_AS_NODE || '',
  }));
}
const mode = process.env.FAKE_MODE || 'ok';
const P = (st, d, t, fid) => console.log(['PROG', st, d, t, 'NA', 1e7, 1, 'NA', 'NA', 'NA', 'NA', fid].join('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (process.argv.includes('--version')) { console.log('2099.01.01'); return; }
  if (mode === 'analyze') {
    console.log(JSON.stringify({ _type: 'playlist', title: 'List', entries: [{ title: 'A', duration: 10 }, null, { title: 'B' }], playlist_count: 3 }));
    return;
  }
  if (mode === 'format') { console.error('ERROR: [youtube] abc: Requested format is not available. Use --list-formats'); process.exit(1); }
  if (mode === 'jsrt') {
    console.error('WARNING: [youtube] abc: No supported JavaScript runtime could be found.');
    console.error('ERROR: [youtube] abc: Requested format is not available.');
    process.exit(1);
  }
  if (mode === 'tree') {
    // A helper process like ffmpeg: its pid is written down so the test can check it dies on cancel.
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_CHILD_FILE, String(g.pid));
    console.log('TITLE|Tree');
    console.log('POST|started|Merger');
    await sleep(60000);
    return;
  }
  console.log('TITLE|My fake video');
  console.log('FMT|399+251');
  P('downloading', 0, 100e6, '399'); await sleep(20);
  P('downloading', 100e6, 100e6, '399');
  P('finished', 100e6, 100e6, '399');
  P('downloading', 5e6, 10e6, '251'); P('finished', 10e6, 10e6, '251');
  console.log('POST|started|Merger');
  if (mode === 'hang') { await sleep(60000); return; }
  // Like the real yt-dlp: --print-to-file TEMPLATE FILE appends the final path to FILE, in UTF-8.
  const i = process.argv.indexOf('--print-to-file');
  const target = i >= 0 ? process.argv[i + 2] : '';
  if (mode === 'enc') {
    // yt-dlp.exe through a pipe on Windows: stdout is the ANSI code page, so the path arrives damaged ...
    console.log('FILE|/tmp/fake/Vid\uFFFDos/ \uFFFD My fake video.mp4');
    // ... while the file written by --print-to-file is exact.
    if (target) fs.appendFileSync(target, '/tmp/fake/Vidéos/أغنية My fake video.mp4\n', 'utf8');
    return;
  }
  console.log('FILE|/tmp/fake/My fake video.mp4');
  if (target && mode === 'ok') fs.appendFileSync(target, '/tmp/fake/My fake video.mp4\r\n', 'utf8');
})();
