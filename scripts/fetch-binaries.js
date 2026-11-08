#!/usr/bin/env node
'use strict';
/**
 * Prepares the programs EasyTube ships (not stored in the repository, ~250 MB):
 *
 *   Windows  -> resources/bin
 *     yt-dlp.exe              downloaded from the official yt-dlp releases, SHA-256 verified
 *     ffmpeg.exe, ffprobe.exe taken from the FFmpeg 6.1.1 "essentials" build by Gyan Doshi
 *                             (archive and both files are pinned by SHA-256 below)
 *   macOS    -> resources/bin-mac-<arch>   (arch = arm64 or x64)
 *     yt-dlp                  the official yt-dlp_macos file (universal), SHA-256 verified
 *     ffmpeg, ffprobe         static builds, each archive and file pinned by SHA-256 below
 *
 * Usage:  node scripts/fetch-binaries.js [--target win32|darwin] [--arch arm64|x64] [--force]
 *                                        [--out <folder>] [--ffmpeg-zip <local .zip>   (Windows only)]
 *                                        [--print-hashes   (maintainers: show the SHA-256 of the macOS downloads)]
 * Default target: the system you run it on (macOS -> darwin, anything else -> win32).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listEntries, extract } = require('./zip-read');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const target = argOf('--target') || (process.platform === 'darwin' ? 'darwin' : 'win32');
if (!['win32', 'darwin'].includes(target)) { console.error('--target must be win32 or darwin'); process.exit(2); }
const arch = argOf('--arch') || (process.arch === 'arm64' ? 'arm64' : 'x64');
if (target === 'darwin' && !['arm64', 'x64'].includes(arch)) { console.error('--arch must be arm64 or x64'); process.exit(2); }
const printHashes = args.includes('--print-hashes');
const exe = (n) => (target === 'win32' ? `${n}.exe` : n);
const YTDLP_ASSET = target === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_macos';
const out = path.resolve(argOf('--out') || path.join(root, 'resources', target === 'darwin' ? `bin-mac-${arch}` : 'bin'));
const localZip = argOf('--ffmpeg-zip') || process.env.FFMPEG_ZIP || '';
const RELEASE = process.env.YTDLP_RELEASE_URL || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

// FFmpeg 6.1.1 "essentials" (GPL-3.0). Source: https://www.gyan.dev/ffmpeg/builds/ (same file as this GitHub release asset).
const FFMPEG = {
  version: '6.1.1',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/6.1.1/ffmpeg-6.1.1-essentials_build.zip',
  zipSha256: '742e32fc9f92681f9f254b925e1b613fdd8074ba40749d4879aefdb009b94cc5',
  files: {
    'ffmpeg.exe': { entry: 'ffmpeg-6.1.1-essentials_build/bin/ffmpeg.exe', sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00' },
    'ffprobe.exe': { entry: 'ffmpeg-6.1.1-essentials_build/bin/ffprobe.exe', sha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4' },
  },
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// GitHub sometimes answers 502/504 for a moment: retry a few times, and never treat an error page as a file.
async function fetchOk(url, what, tries = 4, headers = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) { last = e; }
    if (i < tries) {
      console.log(`  … ${what}: ${last.message}, trying again (${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw new Error(`${what}: ${last.message}`);
}

async function getYtdlp() {
  const name = exe('yt-dlp');
  const dst = path.join(out, name);
  if (!force && fs.existsSync(dst)) {
    console.log(`• ${name}: already there (${mb(fs.statSync(dst).size)}), use --force to download the latest`);
    return;
  }
  console.log(`… ${name}: downloading the latest official release (${YTDLP_ASSET})`);
  let urls = [`${RELEASE}/${YTDLP_ASSET}`];
  let expected = '';
  try {
    const sums = await (await fetchOk(`${RELEASE}/SHA2-256SUMS`, 'SHA2-256SUMS')).text();
    const line = sums.split(/\r?\n/).map((l) => l.trim()).find((l) => l.replace(/^\S+\s+\*?/, '') === YTDLP_ASSET);
    expected = line ? line.split(/\s+/)[0].toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`SHA-256 for ${YTDLP_ASSET} not found in SHA2-256SUMS`);
  } catch (e) {
    // GitHub's file server is sometimes down for a while. Fall back to the checksum GitHub itself records for the
    // release file (release API, "digest"), and download that exact release by its tag.
    if (process.env.YTDLP_RELEASE_URL) throw e;
    console.log(`  … ${e.message}; using the checksum recorded in the GitHub release information instead`);
    const rel = await (await fetchOk('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', 'release information')).json();
    const asset = (rel.assets || []).find((a) => a.name === YTDLP_ASSET);
    const m = /^sha256:([0-9a-f]{64})$/i.exec((asset && asset.digest) || '');
    if (!m || !/^[\w.-]+$/.test(rel.tag_name || '')) throw new Error(`no checksum available for ${YTDLP_ASSET}`);
    expected = m[1].toLowerCase();
    urls = [`https://github.com/yt-dlp/yt-dlp/releases/download/${rel.tag_name}/${YTDLP_ASSET}`,
      `https://api.github.com/repos/yt-dlp/yt-dlp/releases/assets/${Number(asset.id)}`];
  }
  let res;
  for (const [i, u] of urls.entries()) {
    try {
      res = await fetchOk(u, YTDLP_ASSET, i === 0 && urls.length > 1 ? 2 : 4, u.startsWith('https://api.github.com/') ? { Accept: 'application/octet-stream' } : {});
      break;
    } catch (e) {
      if (i === urls.length - 1) throw e;
      console.log(`  … ${e.message}; trying the release file through the GitHub API instead`);
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== expected) throw new Error('SHA-256 mismatch: file rejected');
  fs.writeFileSync(dst, buf, { mode: 0o755 });
  fs.chmodSync(dst, 0o755);
  console.log(`✓ ${name}: downloaded and verified (${mb(buf.length)}, sha256 ${expected.slice(0, 12)}…)`);
}

async function getFfmpeg() {
  const names = Object.keys(FFMPEG.files);
  const missing = names.filter((n) => {
    const dst = path.join(out, n);
    if (force || !fs.existsSync(dst)) return true;
    // A different file (for example an older ffprobe from a previous version) is replaced.
    return sha256(fs.readFileSync(dst)) !== FFMPEG.files[n].sha256;
  });
  names.filter((n) => !missing.includes(n)).forEach((n) => console.log(`• ${n}: already there and verified (FFmpeg ${FFMPEG.version})`));
  if (!missing.length) return;

  let zip;
  if (localZip) {
    console.log(`… FFmpeg ${FFMPEG.version}: reading ${localZip}`);
    zip = fs.readFileSync(localZip);
  } else {
    console.log(`… FFmpeg ${FFMPEG.version}: downloading the "essentials" build (~85 MB)`);
    const res = await fetchOk(FFMPEG.url, 'FFmpeg download');
    zip = Buffer.from(await res.arrayBuffer());
  }
  if (sha256(zip) !== FFMPEG.zipSha256) throw new Error('FFmpeg archive: SHA-256 mismatch, file rejected');
  const entries = listEntries(zip);
  for (const n of missing) {
    const want = FFMPEG.files[n];
    const entry = entries.find((e) => e.name === want.entry);
    if (!entry) throw new Error(`${n}: not found in the archive`);
    const data = extract(zip, entry);
    if (sha256(data) !== want.sha256) throw new Error(`${n}: SHA-256 mismatch, file rejected`);
    fs.writeFileSync(path.join(out, n), data);
    console.log(`✓ ${n}: extracted and verified (${mb(data.length)}, FFmpeg ${FFMPEG.version})`);
  }
}

// macOS: static FFmpeg builds. The URLs name an exact build (timestamp + version) so the files never change
// under our feet; the SHA-256 values below are checked for each archive and each extracted program.
// Maintainers: `--print-hashes` downloads the builds and prints the values to paste here.
const MAC_FFMPEG = {
  // FFmpeg 9.0.2 static release builds by Martin Riedl (https://ffmpeg.martin-riedl.de), signed by the publisher.
  // The archive SHA-256 values match the .sha256 files published next to each download.
  arm64: {
    version: '9.0.2',
    ffmpeg: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
      zipSha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
      sha256: '2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384',
    },
    ffprobe: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip',
      zipSha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
      sha256: '2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059',
    },
  },
  // Intel (the publisher stops release builds for macOS Intel in January 2027)
  x64: {
    version: '9.0.2',
    ffmpeg: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
      zipSha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
      sha256: 'b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1',
    },
    ffprobe: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip',
      zipSha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd',
      sha256: 'b5df9964b0c2048318fafedcd4e3bbafbc561033cee77de8da1840685d8a9d0d',
    },
  },
};

async function getFfmpegMac() {
  const set = MAC_FFMPEG[arch];
  for (const name of ['ffmpeg', 'ffprobe']) {
    const want = set[name];
    const dst = path.join(out, name);
    if (!printHashes) {
      if (!want.url || !want.zipSha256 || !want.sha256) throw new Error(`${name}: no pinned download for macOS ${arch} yet (see MAC_FFMPEG in this script)`);
      if (!force && fs.existsSync(dst) && sha256(fs.readFileSync(dst)) === want.sha256) {
        console.log(`• ${name}: already there and verified (FFmpeg ${set.version})`);
        continue;
      }
    }
    const url = want.url || process.env[`FFMPEG_${name.toUpperCase()}_URL`];
    if (!url) throw new Error(`${name}: give the download address in FFMPEG_${name.toUpperCase()}_URL for --print-hashes`);
    console.log(`… ${name} (macOS ${arch}): downloading ${url}`);
    const res = await fetchOk(url, `${name} download`);
    const zip = Buffer.from(await res.arrayBuffer());
    const entry = listEntries(zip).find((e) => e.name === name || e.name.endsWith(`/${name}`));
    if (!entry) throw new Error(`${name}: not found in the archive`);
    const data = extract(zip, entry);
    if (printHashes) {
      console.log(`  ${name}: zipSha256 ${sha256(zip)}\n  ${name}: sha256    ${sha256(data)}`);
      continue;
    }
    if (sha256(zip) !== want.zipSha256) throw new Error(`${name}: archive SHA-256 mismatch, file rejected`);
    if (sha256(data) !== want.sha256) throw new Error(`${name}: SHA-256 mismatch, file rejected`);
    fs.writeFileSync(dst, data, { mode: 0o755 });
    fs.chmodSync(dst, 0o755);
    console.log(`✓ ${name}: extracted and verified (${mb(data.length)}, FFmpeg ${set.version})`);
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  if (target === 'win32') {
    try { await getFfmpeg(); } catch (e) { console.error(`✗ FFmpeg: ${e.message}`); process.exitCode = 1; }
  } else {
    try { await getFfmpegMac(); } catch (e) { console.error(`✗ FFmpeg: ${e.message}`); process.exitCode = 1; }
  }
  if (!printHashes) {
    try { await getYtdlp(); } catch (e) { console.error(`✗ ${exe('yt-dlp')}: ${e.message}`); process.exitCode = 1; }
  }
  console.log(process.exitCode ? '\nSome files are missing: see the messages above.' : `\nReady: ${out}`);
})();
