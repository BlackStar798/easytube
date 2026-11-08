'use strict';
// Runs the real Engine against a fake yt-dlp (tests/fixtures/fake-ytdlp.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Engine, probeJsRuntime } = require('../lib/engine');

const skip = process.platform === 'win32' ? 'the fake yt-dlp needs a Unix shebang' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easytube-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
// Run a copy of the fake yt-dlp with its executable bit set: the bit is not always kept
// in the repository (for example when files are added through the GitHub web uploader).
const FAKE = path.join(tmp, 'fake-ytdlp.js');
fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-ytdlp.js'), FAKE);
if (process.platform !== 'win32') fs.chmodSync(FAKE, 0o755);

function engine(mode, extra = {}) {
  const argsFile = path.join(tmp, `args-${mode}-${Math.random().toString(36).slice(2)}.json`);
  process.env.FAKE_MODE = mode;
  process.env.FAKE_ARGS_FILE = argsFile;
  const e = new Engine({ ytdlpPath: FAKE, ffmpegDir: tmp, ...extra });
  return { e, recorded: () => JSON.parse(fs.readFileSync(argsFile, 'utf8')) };
}

test('download: progress, title and final file', { skip }, async () => {
  const { e, recorded } = engine('ok');
  const events = [];
  const job = e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }, (p) => events.push(p));
  const r = await job.promise;
  assert.equal(r.failed, false);
  assert.deepEqual(r.files, ['/tmp/fake/My fake video.mp4']);
  assert.ok(events.some((p) => p.title === 'My fake video'));
  assert.ok(events.some((p) => p.phase === 'merge'));
  assert.ok(events[events.length - 1].pct <= 99);
  assert.ok(recorded().argv.includes('https://example.com/v'));
});

test('download: the final path comes from the UTF-8 file, not from a damaged stdout (accents, Arabic)', { skip }, async () => {
  const { e, recorded } = engine('enc');
  const r = await e.download({ url: 'https://example.com/v', kind: 'audio', audioFormat: 'mp3', outDir: tmp }).promise;
  assert.deepEqual(r.files, ['/tmp/fake/Vidéos/أغنية My fake video.mp4']);
  const argv = recorded().argv;
  const i = argv.indexOf('--print-to-file');
  assert.ok(i > 0 && argv[i + 1] === 'after_move:%(filepath)s');
  assert.ok(!fs.existsSync(argv[i + 2]), 'the temporary file is removed');
});

test('download: without the file, stdout is still used (old yt-dlp)', { skip }, async () => {
  const { e } = engine('nofile');
  const r = await e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }).promise;
  assert.deepEqual(r.files, ['/tmp/fake/My fake video.mp4']);
});

test('download: friendly error for an unavailable format', { skip }, async () => {
  const { e } = engine('format');
  await assert.rejects(
    e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }).promise,
    (err) => err.friendly && err.friendly.code === 'format',
  );
});

test('download: a missing JavaScript runtime is named as such', { skip }, async () => {
  const { e } = engine('jsrt');
  await assert.rejects(
    e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }).promise,
    (err) => err.friendly && err.friendly.code === 'jsrt',
  );
});

test('download: cancel stops the process and reports it', { skip }, async () => {
  const { e } = engine('hang');
  const job = e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }, (p) => {
    if (p.phase === 'merge') job.cancel();
  });
  await assert.rejects(job.promise, (err) => err.cancelled === true);
  assert.equal(e.current, null);
});

test('download: cancel also stops what yt-dlp started (macOS/Linux process group)', { skip }, async () => {
  const childFile = path.join(tmp, 'child-pid.txt');
  process.env.FAKE_CHILD_FILE = childFile;
  const { e } = engine('tree');
  const job = e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }, (p) => {
    if (p.phase === 'merge') job.cancel();
  });
  await assert.rejects(job.promise, (err) => err.cancelled === true);
  const pid = Number(fs.readFileSync(childFile, 'utf8'));
  assert.ok(pid > 1);
  const alive = () => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
  for (let i = 0; i < 40 && alive(); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(), false, 'the helper process must be gone');
});

test('analyze: playlist summary through the full pipeline', { skip }, async () => {
  const { e } = engine('analyze');
  const s = await e.analyze('https://example.com/list');
  assert.equal(s.kind, 'playlist');
  assert.deepEqual(s.items.map((i) => i.index), [1, 3]);
});

test('analyze: error is turned into a friendly one', { skip }, async () => {
  const { e } = engine('format');
  await assert.rejects(e.analyze('https://example.com/v'), (err) => err.friendly && err.friendly.code === 'format');
});

test('JS runtime probe: a real Node answers, anything else is rejected', async () => {
  const good = await probeJsRuntime(process.execPath);
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.match(good.version, /^v\d+\./);
  assert.equal((await probeJsRuntime(path.join(tmp, 'does-not-exist'))).ok, false);
  assert.equal((await probeJsRuntime('')).ok, false);
  if (process.platform !== 'win32') assert.equal((await probeJsRuntime(FAKE)).ok, false);
});

test('JS runtime: accepted runtime is passed to yt-dlp, with ELECTRON_RUN_AS_NODE', { skip }, async () => {
  const { e, recorded } = engine('ok');
  const r = await e.initJsRuntime(process.execPath);
  assert.equal(r.ok, true);
  await e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }).promise;
  const rec = recorded();
  const i = rec.argv.indexOf('--js-runtimes');
  assert.ok(i >= 0);
  assert.equal(rec.argv[i + 1], `node:${process.execPath}`);
  assert.equal(rec.runAsNode, '1');
});

test('JS runtime: when the probe fails, yt-dlp runs as in 1.x (no runtime argument)', { skip }, async () => {
  const { e, recorded } = engine('ok');
  const r = await e.initJsRuntime(path.join(tmp, 'nope'));
  assert.equal(r.ok, false);
  await e.download({ url: 'https://example.com/v', kind: 'video', height: 1080, outDir: tmp }).promise;
  const rec = recorded();
  assert.ok(!rec.argv.includes('--js-runtimes'));
  assert.equal(rec.runAsNode, '');
});

test('version() reads yt-dlp --version', { skip }, async () => {
  const { e } = engine('ok');
  assert.equal(await e.version(), '2099.01.01');
});
