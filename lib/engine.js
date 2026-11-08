'use strict';
/**
 * Moteur : pilote yt-dlp (analyse d'un lien, téléchargement, mise à jour).
 * Aucune dépendance à Electron : testable seul avec Node.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const updater = require('./updater');
const { itemsToSpec } = require('./validate');

const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === 'NA' || s === 'None') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Classe une erreur yt-dlp. Retourne un code (« bot », « network »…) ; le texte
 * affiché (titre + piste pour s'en sortir) vient des fichiers de langue
 * (locales/*.json, clés « err.<code>.title » et « err.<code>.hint »).
 */
function friendlyError(raw) {
  const t = String(raw || '');
  const rules = [
    // Cookies from a browser (Chromium browsers often fail on Windows) : before the "sign in" rules.
    // (macOS: Safari needs Full Disk Access, Chromium browsers need the Keychain.)
    [/Could not copy .*cookie|cookies? database|Failed to decrypt|DPAPI|Could not find .* cookies? (database|file)|cookie.*(locked|in use)|binarycookies|Safe Storage|keychain/i, 'cookies', false],
    [/confirm your age|age-restricted|inappropriate for some users/i, 'age', false],
    [/confirm you.?re not a bot|Sign in to confirm/i, 'bot', true],
    [/Private video|This video is private|video is private/i, 'private', false],
    [/members-only|Join this channel/i, 'members', false],
    [/live event will begin|Premieres in|is upcoming/i, 'upcoming', false],
    // YouTube without a JavaScript runtime / failed challenge: must come before "format" and "unavailable".
    [/supported JavaScript runtime|JavaScript runtime|challenge solving|n challenge|signature solving/i, 'jsrt', false],
    [/Requested format is not available|No video formats found|Only images are available|requested format.*not available/i, 'format', true],
    [/Video unavailable|has been removed|no longer available|not available|does not exist|Unable to extract/i, 'unavailable', true],
    [/Unsupported URL/i, 'unsupported', false],
    [/subtitles?/i, 'subs', false],
    [/HTTP Error 429|Too Many Requests/i, 'rate', false],
    [/HTTP Error 403|Forbidden/i, 'forbidden', true],
    [/ffmpeg|ffprobe/i, 'ffmpeg', false],
    [/HTTP Error 404|404: Not Found/i, 'notfound', false],
    [/getaddrinfo|Network is unreachable|Temporary failure|Name or service not known|timed out|Connection (reset|refused|aborted)|Failed to resolve|WinError 10060|WinError 10061/i, 'network', false],
    [/CERTIFICATE_VERIFY_FAILED|SSLError|SSL:|certificate verify|Unable to connect to proxy|Tunnel connection|EOF occurred|ProxyError/i, 'ssl', false],
    [/No space left|Errno 28|not enough space/i, 'disk', false],
    [/Permission denied|Errno 13|Access is denied/i, 'perm', false],
  ];
  for (const [re, code, update] of rules) {
    if (re.test(t)) return { code, suggestUpdate: update, detail: t };
  }
  return { code: 'generic', suggestUpdate: true, detail: t };
}

function pickThumb(i) {
  if (!i) return null;
  if (i.thumbnail) return i.thumbnail;
  if (Array.isArray(i.thumbnails) && i.thumbnails.length) {
    const withUrl = i.thumbnails.filter((x) => x && x.url);
    if (withUrl.length) {
      withUrl.sort((a, b) => (b.preference || 0) - (a.preference || 0) || (b.width || 0) - (a.width || 0));
      const web = withUrl.find((x) => !/\.webp(\?|$)/.test(x.url)) || withUrl[0];
      return web.url;
    }
  }
  if (i.id && /youtube/i.test(String(i.ie_key || i.extractor || ''))) {
    return `https://i.ytimg.com/vi/${i.id}/hqdefault.jpg`;
  }
  return null;
}

function sizeOf(f, duration) {
  if (!f) return 0;
  const s = f.filesize || f.filesize_approx;
  if (s) return s;
  if (f.tbr && duration) return Math.round((f.tbr * 1000 * duration) / 8);
  return 0;
}

const FALLBACK_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

function summarize(info, url) {
  if (info && info._type === 'playlist') {
    const raw = Array.isArray(info.entries) ? info.entries : [];
    const entries = raw.filter(Boolean);
    // Position = place in the playlist (what yt-dlp's --playlist-items expects). Capped at 1000 rows.
    const items = raw
      .map((e, i) => (e ? { index: i + 1, title: String(e.title || '').slice(0, 200), duration: e.duration || null } : null))
      .filter(Boolean)
      .slice(0, 1000);
    return {
      kind: 'playlist',
      url,
      title: info.title || '',
      uploader: info.uploader || info.channel || '',
      count: info.playlist_count || entries.length,
      items,
      thumbnail: pickThumb(info) || pickThumb(entries[0]),
      duration: null,
      heights: FALLBACK_HEIGHTS.map((h) => ({ h, size: 0 })),
      audioSize: 0,
    };
  }
  const duration = info.duration || null;
  const fmts = Array.isArray(info.formats) ? info.formats : [];
  const audios = fmts.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  audios.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const audioSize = sizeOf(audios[0], duration);

  const byHeight = new Map();
  for (const f of fmts) {
    if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
    const cur = byHeight.get(f.height);
    if (!cur || (f.tbr || 0) > (cur.tbr || 0)) byHeight.set(f.height, f);
  }
  const heights = [...byHeight.entries()]
    .map(([h, f]) => ({ h, size: sizeOf(f, duration) + (f.acodec === 'none' ? audioSize : 0) }))
    .sort((a, b) => b.h - a.h);

  return {
    kind: 'video',
    url,
    id: info.id,
    title: info.title || '',
    uploader: info.uploader || info.channel || '',
    duration,
    thumbnail: pickThumb(info),
    heights,
    audioSize,
    extractor: info.extractor_key || info.extractor || '',
  };
}

/** Arguments shared by every yt-dlp call. `cfg` comes from the settings (already validated). */
function buildCommonArgs(cfg = {}) {
  const a = ['--ignore-config', '--color', 'never', '--socket-timeout', '30'];
  if (cfg.ffmpegDir) a.push('--ffmpeg-location', cfg.ffmpegDir);
  if (cfg.cookiesBrowser === 'file') {
    if (cfg.cookiesFile) a.push('--cookies', cfg.cookiesFile);
  } else if (cfg.cookiesBrowser) {
    a.push('--cookies-from-browser', cfg.cookiesBrowser);
  }
  if (cfg.proxy) a.push('--proxy', cfg.proxy);
  // Extra JavaScript runtime for YouTube (see probeJsRuntime): "node:<path>". Deno stays enabled by default.
  if (cfg.jsRuntimePath) a.push('--js-runtimes', `node:${cfg.jsRuntimePath}`);
  return a;
}

/** « fr,en » -> « fr,en,fr-orig,en-orig » (YouTube names the original auto-captions « xx-orig »). */
function subLangsArg(langs) {
  const codes = String(langs || 'fr,en,ar').split(',').map((c) => c.trim()).filter(Boolean);
  return [...codes, ...codes.map((c) => `${c}-orig`)].join(',');
}

/**
 * Builds the yt-dlp command line of a download (pure function: no process is started).
 * opts : { url, kind:'video'|'audio', height, audioFormat:'mp3'|'m4a', container:'mp4'|'mkv',
 *          subs, playlist, playlistItems:[n…], outDir }
 * cfg  : see buildCommonArgs, plus { limitRate, subLangs }
 */
function buildDownloadArgs(opts, cfg = {}) {
  const {
    url, kind, height, audioFormat = 'mp3', container = 'mp4', subs, playlist, playlistItems, outDir,
  } = opts;
  const args = [
    ...buildCommonArgs(cfg),
    '--quiet', '--progress', '--newline', '--no-simulate',
    '--no-mtime', '--windows-filenames', '--trim-filenames', '180',
    '--concurrent-fragments', '4', '--retries', '10', '--fragment-retries', '10',
    '-P', outDir,
    '--print', 'after_move:FILE|%(filepath)s',
    // Same path, written to a file in UTF-8. On Windows yt-dlp.exe (PyInstaller) ignores PYTHONUTF8 and
    // PYTHONIOENCODING, so through a pipe it writes the console's ANSI code page and silently drops what it
    // cannot encode: « Vidéos » or an Arabic title arrives broken and "Listen" / "Show in folder" find nothing.
    // The stdout line above stays as a fallback. (Engine.download adds pathsFile.)
    ...(opts.pathsFile ? ['--print-to-file', 'after_move:%(filepath)s', String(opts.pathsFile).replace(/%/g, '%%')] : []),
    '--print', 'before_dl:FMT|%(format_id)s',
    '--print', 'before_dl:TITLE|%(title)s',
    '--progress-template',
    'download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.playlist_index)s|%(info.n_entries)s|%(info.format_id)s',
    '--progress-template',
    'postprocess:POST|%(progress.status)s|%(progress.postprocessor)s',
  ];
  if (cfg.limitRate) args.push('--limit-rate', cfg.limitRate);

  args.push(playlist ? '--yes-playlist' : '--no-playlist');
  if (playlist && Array.isArray(playlistItems) && playlistItems.length) {
    args.push('--playlist-items', itemsToSpec(playlistItems));
  }
  args.push('-o', playlist
    ? '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s'
    : '%(title)s.%(ext)s');

  if (kind === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', audioFormat, '--audio-quality', '0',
      '--embed-thumbnail', '--convert-thumbnails', 'jpg', '--embed-metadata');
  } else {
    const filter = height && height !== 'best' ? `[height<=?${height}]` : '';
    // MP4: H.264/AAC first (plays everywhere). MKV: no codec preference, so 1440p/4K (VP9/AV1) work.
    const sort = container === 'mkv' ? 'res' : 'res,vcodec:h264,acodec:aac';
    args.push('-f', `bv*${filter}+ba/b${filter}`,
      '-S', sort,
      '--merge-output-format', container === 'mkv' ? 'mkv' : 'mp4', '--embed-metadata');
    if (subs) {
      // Exact languages ("fr.*" also fetched dozens of auto-translations and YouTube answered 429).
      // --ignore-errors: a missing subtitle must never prevent getting the video.
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', subLangsArg(cfg.subLangs),
        '--embed-subs', '--sleep-subtitles', '1', '--ignore-errors');
    }
  }
  args.push('--', url);
  return args;
}

/**
 * Reads yt-dlp's output lines (PROG| POST| FMT| TITLE| FILE|) and turns them into
 * progress events. Pure state machine: feed(line) for every line, files = final paths.
 */
class ProgressParser {
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.files = [];
    this.pendingStreams = 1;
    this.streamState = { n: 1, fids: [], max: 0 };
    this.curItem = null;
    this.last = {
      pct: 0, phase: 'download', speed: null, eta: null, downloaded: 0, total: null, item: 1, items: 1, title: '',
    };
  }

  emit(patch) {
    this.last = { ...this.last, ...patch };
    if (this.onProgress) this.onProgress(this.last);
  }

  feed(line) {
    if (!line) return;
    if (line.startsWith('PROG|')) {
      const f = line.split('|');
      const status = f[1];
      const downloaded = num(f[2]);
      const total = num(f[3]) || num(f[4]);
      const speed = num(f[5]);
      const eta = num(f[6]);
      const fragI = num(f[7]);
      const fragN = num(f[8]);
      const item = num(f[9]) || 1;
      const items = num(f[10]) || 1;
      const fid = f[11] || '';
      // Subtitles are small separate files (no format id): not counted in the bar,
      // otherwise it jumps to 99 % and falls back.
      if (!fid || fid === 'NA') return;
      if (item !== this.curItem) { this.curItem = item; this.streamState = { n: this.pendingStreams, fids: [], max: 0 }; }

      // yt-dlp downloads the picture then the sound, one after the other:
      // picture = 0 to 90 % of the bar, sound = 90 to 100 %.
      const st = this.streamState;
      let idx = st.fids.indexOf(fid);
      if (idx === -1) { st.fids.push(fid); idx = st.fids.length - 1; }
      const n = st.n;
      const weights = n === 2 ? [0.9, 0.1] : Array(n).fill(1 / n);
      const k = Math.min(idx, n - 1);
      const base = weights.slice(0, k).reduce((a, w) => a + w, 0);

      let frac = 0;
      if (status === 'finished') frac = 1;
      else if (total && downloaded != null) frac = Math.min(1, downloaded / total);
      else if (fragN && fragI != null) frac = Math.min(1, fragI / fragN);

      // The bar never goes backwards.
      st.max = Math.max(st.max, base + weights[k] * frac);
      const overall = ((item - 1) + st.max) / items;
      this.emit({
        pct: Math.min(99, Math.max(0, overall * 100)),
        phase: 'download',
        speed: status === 'finished' ? null : speed,
        eta: status === 'finished' ? null : eta,
        downloaded: downloaded || 0,
        total: total || null,
        item,
        items,
      });
    } else if (line.startsWith('POST|')) {
      const f = line.split('|');
      if (f[1] === 'started') {
        const pp = f[2] || '';
        const p = /Merger/i.test(pp) ? 'merge'
          : /ExtractAudio/i.test(pp) ? 'audio'
            : /Thumbnail/i.test(pp) ? 'cover'
              : /Subtitle/i.test(pp) ? 'subs'
                : 'final';
        this.emit({ phase: p, speed: null, eta: null });
      }
    } else if (line.startsWith('FMT|')) {
      const ids = line.slice(4).split('+').filter(Boolean);
      this.pendingStreams = Math.max(1, Math.min(ids.length, 3));
      if (this.curItem === null) this.streamState.n = this.pendingStreams;
    } else if (line.startsWith('TITLE|')) {
      const title = line.slice(6).trim().slice(0, 300);
      if (title && title !== 'NA') this.emit({ title });
    } else if (line.startsWith('FILE|')) {
      this.files.push(line.slice(5));
    }
  }
}

/**
 * Can this program act as a JavaScript runtime for yt-dlp?
 * YouTube needs one to solve its "n challenge". EasyTube is Electron, so it contains Node.js:
 * started with ELECTRON_RUN_AS_NODE=1, EasyTube.exe behaves like node.exe. We try it for real
 * (same flags as yt-dlp: node --permission -) and only trust it if it answers correctly.
 * Resolves { ok, version, reason } and never rejects.
 */
function probeJsRuntime(execPath, { timeoutMs = 10000 } = {}) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const run = (args, stdin) => new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(execPath, args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ code: -1, out, err: String(e.message || e) }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } resolve({ code: -2, out, err: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 2000) out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e.message || e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => { /* closed early */ });
    if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
  });
  return (async () => {
    if (!execPath) return { ok: false, version: '', reason: 'no path' };
    const v = await run(['--version']);
    const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(v.out.trim());
    if (v.code !== 0 || !m) return { ok: false, version: '', reason: `no version (${v.err.trim().slice(0, 120) || `code ${v.code}`})` };
    const tuple = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (tuple[0] < 20) return { ok: false, version: v.out.trim(), reason: 'too old' };
    // Same permission flag as yt-dlp: stable since 23.5.0 (also 22.13+), experimental before.
    const stable = tuple[0] > 23 || (tuple[0] === 23 && tuple[1] >= 5) || (tuple[0] === 22 && tuple[1] >= 13);
    const flags = stable ? ['--permission'] : ['--experimental-permission', '--no-warnings=ExperimentalWarning'];
    const r = await run([...flags, '-'], 'process.stdout.write(String(6 * 7))');
    if (r.code === 0 && r.out.trim() === '42') return { ok: true, version: v.out.trim(), reason: '' };
    return { ok: false, version: v.out.trim(), reason: `test failed (${(r.err.trim() || `code ${r.code}`).slice(0, 120)})` };
  })();
}

/**
 * Options for starting yt-dlp. On macOS/Linux the child gets its own process group, so that
 * cancelling stops yt-dlp AND what it started (its PyInstaller child, ffmpeg), like taskkill /T on Windows.
 */
const childOpts = (env) => ({ windowsHide: true, env, detached: process.platform !== 'win32' });

class Engine {
  /**
   * cfg: { ytdlpPath, ffmpegDir, cookiesBrowser, cookiesFile, proxy, limitRate, subLangs, jsRuntimePath }
   */
  constructor(cfg) {
    this.ytdlpPath = cfg.ytdlpPath;
    this.ffmpegDir = cfg.ffmpegDir;
    this.cookiesBrowser = cfg.cookiesBrowser || '';
    this.cookiesFile = cfg.cookiesFile || '';
    this.proxy = cfg.proxy || '';
    this.limitRate = cfg.limitRate || '';
    this.subLangs = cfg.subLangs || 'fr,en,ar';
    this.jsRuntimePath = cfg.jsRuntimePath || '';
    this.jsRuntime = { ok: !!cfg.jsRuntimePath, version: '', reason: '' };
    this.ready = Promise.resolve();
    this.current = null;
  }

  /** Applies settings changes (everything is read again at each call). */
  configure(patch) {
    for (const k of ['cookiesBrowser', 'cookiesFile', 'proxy', 'limitRate', 'subLangs']) {
      if (k in patch) this[k] = patch[k] || (k === 'subLangs' ? 'fr,en,ar' : '');
    }
  }

  _cfg() {
    return {
      ffmpegDir: this.ffmpegDir,
      cookiesBrowser: this.cookiesBrowser,
      cookiesFile: this.cookiesFile,
      proxy: this.proxy,
      limitRate: this.limitRate,
      subLangs: this.subLangs,
      jsRuntimePath: this.jsRuntimePath,
    };
  }

  /**
   * Tests the program (normally EasyTube.exe itself) as a JavaScript runtime.
   * `this.ready` resolves when the test is done: callers wait for it before the first yt-dlp call.
   */
  initJsRuntime(execPath) {
    this.ready = probeJsRuntime(execPath).then((r) => {
      this.jsRuntime = r;
      this.jsRuntimePath = r.ok ? execPath : '';
      return r;
    });
    return this.ready;
  }

  _env() {
    const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
    if (this.jsRuntimePath) env.ELECTRON_RUN_AS_NODE = '1';
    return env;
  }

  _common() {
    return buildCommonArgs(this._cfg());
  }

  _run(args, { timeoutMs = 0 } = {}) {
    return new Promise((resolve) => {
      const child = spawn(this.ytdlpPath, args, childOpts(this._env()));
      let out = '';
      let err = '';
      let timer = null;
      if (timeoutMs) timer = setTimeout(() => this._kill(child), timeoutMs);
      child.stdout.on('data', (d) => (out += d.toString('utf8')));
      child.stderr.on('data', (d) => (err += d.toString('utf8')));
      child.on('error', (e) => {
        if (timer) clearTimeout(timer);
        resolve({ code: -1, out, err: err + String(e.message || e) });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, out, err });
      });
    });
  }

  _kill(child) {
    if (!child || child.killed) return;
    if (process.platform === 'win32') {
      // yt-dlp.exe starts a child process: stop the whole tree.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    }
    // macOS/Linux: the child leads its own process group (see childOpts). Ask politely first, then insist.
    const signalGroup = (sig) => {
      try { process.kill(-child.pid, sig); } catch (_) {
        try { child.kill(sig); } catch (__) { /* already stopped */ }
      }
    };
    signalGroup('SIGTERM');
    const insist = setTimeout(() => signalGroup('SIGKILL'), 2500);
    insist.unref();
  }

  async version() {
    const r = await this._run(['--version'], { timeoutMs: 15000 });
    return r.code === 0 ? r.out.trim() : null;
  }

  /** FFmpeg version (shown in "About"). Read once: the file does not change. */
  ffmpegVersion() {
    if (this._ffv !== undefined) return Promise.resolve(this._ffv);
    return new Promise((resolve) => {
      const done = (v) => { this._ffv = v; resolve(v); };
      if (!this.ffmpegDir) return done(null);
      const bin = path.join(this.ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      let out = '';
      let child;
      try { child = spawn(bin, ['-hide_banner', '-version'], { windowsHide: true }); } catch (_) { return done(null); }
      const timer = setTimeout(() => { this._kill(child); done(null); }, 8000);
      child.stdout.on('data', (d) => { if (out.length < 4000) out += d.toString('utf8'); });
      child.on('error', () => { clearTimeout(timer); done(null); });
      child.on('close', () => {
        clearTimeout(timer);
        const m = /version\s+(\S+)/i.exec(out);
        done(m ? m[1].replace(/-(essentials|full)_build.*$/i, '') : null);
      });
    });
  }

  /** Is there a newer yt-dlp? (a simple read, nothing is installed) */
  async checkUpdate() {
    const current = await this.version();
    return updater.checkLatest(current);
  }

  /** Installs the latest official version, SHA-256 verified. */
  async update() {
    const before = await this.version();
    try {
      const r = await updater.updateBinary({
        destPath: this.ytdlpPath,
        current: before,
        versionFn: () => this.version(),
      });
      const after = await this.version();
      return {
        before, after, ok: true,
        upToDate: !!r.upToDate,
        changed: !!before && !!after && before !== after,
        log: r.upToDate ? 'Already up to date' : `Installed ${r.tag}`,
      };
    } catch (e) {
      return { before, after: before, ok: false, upToDate: false, changed: false, log: String(e.message || e) };
    }
  }

  /** Friendly error, with the "no JavaScript runtime" case recognised from yt-dlp's warnings. */
  _friendly(msg, fullStderr) {
    const f = friendlyError(msg);
    if (['format', 'unavailable', 'generic'].includes(f.code) && /supported JavaScript runtime|JavaScript runtime/i.test(fullStderr || '')) {
      return { ...friendlyError('JavaScript runtime'), detail: f.detail };
    }
    return f;
  }

  async analyze(url) {
    await this.ready;
    const args = [
      ...this._common(),
      '-J', '--flat-playlist', '--no-playlist', '--no-warnings',
      '--', url,
    ];
    const r = await this._run(args, { timeoutMs: 90000 });
    if (r.code !== 0 || !r.out.trim()) {
      const lines = r.err.split(/\r?\n/).filter((l) => /ERROR/i.test(l));
      const msg = (lines.pop() || r.err || 'Analysis failed').trim();
      throw Object.assign(new Error(msg), { friendly: this._friendly(msg, r.err) });
    }
    let info;
    try {
      info = JSON.parse(r.out);
    } catch (e) {
      throw Object.assign(new Error('Unreadable response'), { friendly: friendlyError('Unable to extract') });
    }
    return summarize(info, url);
  }

  /**
   * opts : { url, kind, height, audioFormat, container, subs, playlist, playlistItems, outDir }
   * onProgress(p) : { pct, phase, speed, eta, downloaded, total, item, items, title }
   * Returns a promise { files, failed }; rejects { cancelled } or { friendly }.
   */
  download(opts, onProgress) {
    const pathsFile = path.join(os.tmpdir(), `easytube-paths-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.txt`);
    const args = buildDownloadArgs({ ...opts, pathsFile }, this._cfg());
    /** Final files as yt-dlp wrote them (UTF-8 file) or, failing that, as read from its stdout. */
    const readFiles = (fromStdout) => {
      let fromFile = [];
      try {
        fromFile = fs.readFileSync(pathsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } catch (_) { /* nothing written (failed download, or an old yt-dlp): use stdout */ }
      try { fs.unlinkSync(pathsFile); } catch (_) { /* already gone */ }
      return fromFile.length ? fromFile : fromStdout;
    };
    const child = spawn(this.ytdlpPath, args, childOpts(this._env()));
    const handle = { child, cancelled: false };
    this.current = handle;

    const parser = new ProgressParser(onProgress);
    let lastError = '';
    let stderrAll = '';

    const splitter = (cb) => {
      let buf = '';
      return (chunk) => {
        buf += chunk.toString('utf8');
        const parts = buf.split(/\r\n|\n|\r/);
        buf = parts.pop();
        parts.forEach(cb);
      };
    };
    child.stdout.on('data', splitter((l) => parser.feed(l)));
    child.stderr.on('data', splitter((l) => {
      stderrAll += l + '\n';
      if (/ERROR/i.test(l)) lastError = l.trim();
    }));

    const promise = new Promise((resolve, reject) => {
      child.on('error', (e) => {
        readFiles([]);
        reject({ friendly: friendlyError(String(e.message || e)), message: String(e.message || e) });
      });
      child.on('close', (code) => {
        this.current = null;
        const files = readFiles(parser.files);
        if (handle.cancelled) return reject({ cancelled: true });
        if (code === 0) return resolve({ files, failed: false });
        if (files.length > 0) return resolve({ files, failed: true });
        const msg = lastError || stderrAll.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
        reject({ friendly: this._friendly(msg, stderrAll), message: msg });
      });
    });

    return {
      promise,
      cancel: () => { handle.cancelled = true; this._kill(child); },
    };
  }
}

module.exports = {
  Engine, friendlyError, summarize, buildCommonArgs, buildDownloadArgs, subLangsArg, ProgressParser, probeJsRuntime,
};
