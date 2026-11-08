'use strict';
/**
 * Transparent yt-dlp update.
 *  - we read the latest version published on the official repository (GitHub);
 *  - we download the official file AND its SHA-256 checksum list;
 *  - the file is installed only if the checksum matches exactly;
 *  - nothing happens in the background: installing is always the user's action.
 */
const fs = require('fs');
const crypto = require('crypto');

const REPO = 'https://github.com/yt-dlp/yt-dlp/releases';
const UA = 'EasyTube (open-source interface for yt-dlp)';

const assetName = () => {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp_linux';
};

async function http(url, { timeoutMs = 30000 } = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json, application/octet-stream, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
}

/** Compares two versions such as "2026.10.26" or "v2.0.1" (a suffix is ignored). > 0 if a is newer. */
function compareVersions(a, b) {
  const clean = (v) => String(v).trim().replace(/^v/i, '').split(/[-+\s]/)[0];
  const pa = clean(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = clean(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Latest version of a GitHub project: we simply follow the redirect of <releases>/latest
 * (no API, no quota). `releasesUrl` = "https://github.com/<owner>/<repo>/releases".
 * `fetchImpl` can be replaced in tests.
 */
async function latestRelease(releasesUrl = REPO, fetchImpl = fetch) {
  const r = await fetchImpl(`${releasesUrl}/latest`, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const loc = r.headers.get('location') || '';
  const m = loc.match(/\/releases\/tag\/([^/?#]+)/);
  if (!m) throw new Error('Could not read the latest version.');
  return { tag: decodeURIComponent(m[1]) };
}

async function checkLatest(current) {
  const rel = await latestRelease();
  return {
    latest: rel.tag,
    current: current || null,
    available: !!current && !!rel.tag && compareVersions(rel.tag, current) > 0,
  };
}

/**
 * Replaces destPath with the latest official version (if newer).
 * versionFn() must return the version of the binary in place (or null if it does not start).
 */
async function updateBinary({ destPath, current, versionFn }) {
  const rel = await latestRelease();
  if (current && rel.tag && compareVersions(rel.tag, current) <= 0) {
    return { ok: true, upToDate: true, tag: rel.tag };
  }
  const name = assetName();
  const base = `${REPO}/download/${encodeURIComponent(rel.tag)}`;

  const sumsText = await (await http(`${base}/SHA2-256SUMS`)).text();
  const line = sumsText.split(/\r?\n/).map((l) => l.trim()).find((l) => /\s\*?/.test(l) && l.replace(/^\S+\s+\*?/, '') === name);
  const expected = line ? line.split(/\s+/)[0].toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('SHA-256 checksum not found for this file.');

  const buf = Buffer.from(await (await http(`${base}/${name}`, { timeoutMs: 300000 })).arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== expected) throw new Error('SHA-256 checksum does not match: file rejected.');

  const tmp = `${destPath}.new`;
  const bak = `${destPath}.old`;
  fs.writeFileSync(tmp, buf, { mode: 0o755 });
  try {
    fs.rmSync(bak, { force: true });
    if (fs.existsSync(destPath)) fs.renameSync(destPath, bak);
    fs.renameSync(tmp, destPath);
  } catch (e) {
    try { if (!fs.existsSync(destPath) && fs.existsSync(bak)) fs.renameSync(bak, destPath); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
    throw new Error('Could not replace yt-dlp (is it in use?).');
  }
  const v = await versionFn();
  if (!v) {
    try { fs.rmSync(destPath, { force: true }); fs.renameSync(bak, destPath); } catch (_) { /* ignore */ }
    throw new Error('The new version does not start: the previous one was restored.');
  }
  try { fs.rmSync(bak, { force: true }); } catch (_) { /* ignore */ }
  return { ok: true, upToDate: false, tag: rel.tag, sha256: got };
}

module.exports = { checkLatest, updateBinary, compareVersions, assetName, latestRelease };
