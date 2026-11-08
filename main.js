'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, powerSaveBlocker, Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Engine, friendlyError } = require('./lib/engine');
const { sanitizeSettingsPatch, sanitizeDownloadOpts } = require('./lib/validate');
const { checkApp } = require('./lib/appupdate');
const { compareVersions } = require('./lib/updater');
const pkg = require('./package.json');

const isMac = process.platform === 'darwin';
if (process.platform === 'win32') app.setAppUserModelId('com.mehdi.easytube');
// macOS: EasyTube never needs the user's Keychain. With the cookie-encryption fuse off, Chromium could still
// read its "EasyTube Safe Storage" key now and then (a Mac that ran an older build, a reboot...) and macOS
// would ask "EasyTube wants to use your confidential information". This switch (the one Electron's own tests
// use against that dialog) points Chromium to an in-memory keychain: it can never ask. It must be set before
// the app is ready.
if (isMac) app.commandLine.appendSwitch('use-mock-keychain');

// ---------------------------------------------------------------- données
// Windows : si le dossier d'installation est modifiable, tout (réglages, yt-dlp mis à
// jour, cache) reste dans <installation>\data. Sinon on utilise le profil Windows.
// macOS : jamais dans l'app (écrire dans le .app casserait sa signature) : on garde
// le dossier standard ~/Library/Application Support/EasyTube.
if (app.isPackaged && process.platform === 'win32') {
  try {
    const dataDir = path.join(path.dirname(process.execPath), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    app.setPath('userData', dataDir);
  } catch (_) { /* on garde le dossier par défaut */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// -------------------------------------------------------------- réglages
const DEFAULTS = {
  folder: '',
  kind: 'video',
  quality: 1080,
  audioFormat: 'mp3',
  subs: false,
  accent: '#8b5cf6',
  sound: true,
  lang: 'en',
  welcomeSeen: false,
  platformTheme: true,
  pendingUpdate: '',
  pendingAppUpdate: '',
  cookies: '',
  cookiesFile: '',
  container: 'mp4',
  limitRate: '',
  proxy: '',
  subLangs: 'fr,en,ar',
  autoCheck: true,
  jsHelper: true,
  history: [],
  lastUpdateCheck: 0,
};
let settings = { ...DEFAULTS };
const HISTORY_MAX = 10;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// --------------------------------------------------------------- langues
// Les textes vivent dans locales/en.json et locales/fr.json (anglais par défaut).
const LANGS = ['en', 'fr'];
const locales = {};
for (const l of LANGS) {
  try { locales[l] = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${l}.json`), 'utf8')); } catch (_) { locales[l] = {}; }
}
/** Texte pour le processus principal (notifications, boîtes de dialogue). */
const tm = (key) => (locales[settings.lang] && locales[settings.lang][key]) || (locales.en && locales.en[key]) || key;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    // Same validation as for the window: a hand-edited or damaged file cannot inject odd values.
    Object.assign(settings, sanitizeSettingsPatch(raw, { langs: LANGS }));
    if (Array.isArray(raw.history)) settings.history = raw.history;
    if (typeof raw.pendingUpdate === 'string') settings.pendingUpdate = raw.pendingUpdate.slice(0, 40);
    if (typeof raw.pendingAppUpdate === 'string') settings.pendingAppUpdate = raw.pendingAppUpdate.slice(0, 40);
    if (Number.isFinite(raw.lastUpdateCheck)) settings.lastUpdateCheck = raw.lastUpdateCheck;
    if (typeof raw.cookiesFile === 'string' && raw.cookiesFile.length < 1024) settings.cookiesFile = raw.cookiesFile;
  } catch (_) { /* first launch */ }
  if (!LANGS.includes(settings.lang)) settings.lang = 'en';
  // A pending "new EasyTube" notice is dropped once the user is up to date.
  if (settings.pendingAppUpdate && compareVersions(settings.pendingAppUpdate, app.getVersion()) <= 0) settings.pendingAppUpdate = '';
  settings.history = (Array.isArray(settings.history) ? settings.history : [])
    .filter((h) => h && typeof h === 'object')
    .slice(0, HISTORY_MAX)
    .map((h) => ({ ...h, id: typeof h.id === 'string' && h.id ? h.id : newId() }));
  if (!settings.folder) settings.folder = path.join(app.getPath('videos'), 'EasyTube');
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    const tmp = settingsFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, settingsFile());
  } catch (_) { /* non bloquant */ }
}

// ---------------------------------------------------------------- moteur
const isWin = process.platform === 'win32';
const binName = (n) => (isWin ? `${n}.exe` : n);
// Packaged: <app>/resources/bin. In development: resources/bin (Windows) or resources/bin-mac-<arch> (macOS).
const bundledDir = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'resources', isMac ? `bin-mac-${process.arch}` : 'bin'));

/** macOS: a file copied out of a downloaded app may carry the "quarantine" flag, which makes Gatekeeper ask about it. */
function stripQuarantine(file) {
  if (!isMac) return;
  try {
    require('child_process').execFileSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file], { stdio: 'ignore', timeout: 5000 });
  } catch (_) { /* flag absent or xattr unavailable: nothing to do */ }
}

/** yt-dlp vit dans le dossier de données : il peut ainsi se mettre à jour seul. */
function resolveYtdlp() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const bundled = path.join(bundledDir(), binName('yt-dlp'));
  const dstDir = path.join(app.getPath('userData'), 'bin');
  const dst = path.join(dstDir, binName('yt-dlp'));
  try {
    fs.mkdirSync(dstDir, { recursive: true });
    if (!fs.existsSync(dst) || fs.statSync(bundled).mtimeMs > fs.statSync(dst).mtimeMs) {
      fs.copyFileSync(bundled, dst);
      if (!isWin) {
        try { fs.chmodSync(dst, 0o755); } catch (_) { /* best effort */ }
        stripQuarantine(dst);
      }
    }
    return dst;
  } catch (_) {
    return bundled;
  }
}

let engine;
let win = null;
let active = null;
const knownPaths = new Set();

/** Cookie source for the engine: the cookies.txt file only counts while it still exists. */
const cookiesFileOk = () => !!settings.cookiesFile && fs.existsSync(settings.cookiesFile);

function engineSettings() {
  return {
    cookiesBrowser: settings.cookies,
    cookiesFile: cookiesFileOk() ? settings.cookiesFile : '',
    proxy: settings.proxy,
    limitRate: settings.limitRate,
    subLangs: settings.subLangs,
  };
}

function createEngine() {
  engine = new Engine({
    ytdlpPath: resolveYtdlp(),
    ffmpegDir: process.env.FFMPEG_DIR || bundledDir(),
    ...engineSettings(),
  });
  applyJsHelper();
}

/**
 * YouTube needs a JavaScript runtime. EasyTube lends its own (Electron contains Node.js):
 * the engine tests it for real and only uses it if it answers correctly. Can be turned off in Settings.
 */
function applyJsHelper() {
  if (settings.jsHelper && !process.env.EASYTUBE_NO_JSHELPER) {
    if (!engine.jsRuntimePath) engine.initJsRuntime(process.execPath);
  } else {
    engine.jsRuntimePath = '';
    engine.jsRuntime = { ok: false, version: '', reason: 'disabled' };
    engine.ready = Promise.resolve();
  }
}

// --------------------------------------------------------------- fenêtre
function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 900,
    minHeight: 660,
    show: false,
    title: 'EasyTube',
    backgroundColor: '#0A0A0E',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Windows: the system buttons are drawn over our bar. macOS: the traffic lights sit at the top left.
    ...(isMac
      ? { trafficLightPosition: { x: 20, y: 17 } }
      : { titleBarOverlay: { color: '#0A0A0E', symbolColor: '#F3F3F8', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** macOS needs a real menu: Cmd+C / Cmd+V / Cmd+Q and the Edit commands only work through it. */
function buildMacMenu() {
  const toWindow = (action) => () => {
    if (win && !win.isDestroyed()) win.webContents.send('ui:menu', action);
    else if (action === 'about') createWindow();
  };
  return Menu.buildFromTemplate([
    {
      label: 'EasyTube',
      submenu: [
        { label: tm('menu.about'), click: toWindow('about') },
        { type: 'separator' },
        // No accelerator on purpose: the window already handles Cmd+, itself.
        { label: tm('menu.settings'), click: toWindow('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]);
}
const applyMenu = () => Menu.setApplicationMenu(isMac ? buildMacMenu() : null);

app.whenReady().then(() => {
  loadSettings();
  applyMenu();
  if (isMac && app.dock && !app.isPackaged) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (_) { /* cosmetic */ }
  }
  settings.history.forEach((h) => h && h.file && knownPaths.add(path.resolve(h.file)));
  createEngine();
  createWindow();
  setTimeout(checkForUpdate, 8000);
});

app.on('window-all-closed', () => {
  if (active) active.cancel();
  // macOS keeps the app alive without a window (Dock icon, Cmd+Q to quit); elsewhere closing quits.
  if (!isMac) app.quit();
});

// macOS: a click on the Dock icon opens a window again.
app.on('activate', () => {
  if (isMac && app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ------------------------------------------------ new versions available?
// We only read the number of the latest version (at most every 12 hours, can be turned
// off in Settings). Nothing is installed without a click.
const DAY = 12 * 3600 * 1000;
async function checkForUpdate() {
  if (!settings.autoCheck || active || Date.now() - settings.lastUpdateCheck < DAY) return;
  try {
    const r = await engine.checkUpdate();
    settings.lastUpdateCheck = Date.now();
    settings.pendingUpdate = r.available ? r.latest : '';
    saveSettings();
    if (r.available && win && !win.isDestroyed()) win.webContents.send('engine:update-available', r);
  } catch (_) { /* silent: no connection, etc. */ }
  await checkAppUpdate();
}

/** New EasyTube release? Only when the project page is known (package.json "repository"). */
async function checkAppUpdate() {
  const repo = repoUrl();
  if (!repo) return { ok: false };
  try {
    const r = await checkApp({ repo, current: app.getVersion() });
    settings.pendingAppUpdate = r.available ? r.latest : '';
    saveSettings();
    if (r.available && win && !win.isDestroyed()) win.webContents.send('app:update-available', { latest: r.latest });
    return { ok: true, available: r.available, latest: r.latest };
  } catch (_) {
    return { ok: false };
  }
}

// ------------------------------------------------------------------- IPC
function toUrl(input) {
  const s = String(input || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('i18n:get', () => locales);

ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(settings, sanitizeSettingsPatch(patch, { langs: LANGS }));
  if (!LANGS.includes(settings.lang)) settings.lang = 'en';
  if (engine) {
    engine.configure(engineSettings());
    applyJsHelper();
  }
  if (isMac && app.isReady()) applyMenu();
  saveSettings();
  return settings;
});

// cookies.txt exported from a browser (an alternative to reading the browser directly).
ipcMain.handle('cookies:chooseFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: tm('dialog.cookies'),
    properties: ['openFile'],
    filters: [{ name: 'cookies.txt', extensions: ['txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
  const file = r.filePaths[0];
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 5 * 1024 * 1024) return { ok: false, code: 'badfile' };
    const head = fs.readFileSync(file, 'utf8').slice(0, 4096);
    const looksOk = /^# (Netscape )?HTTP Cookie File/im.test(head) || /^[^\s#][^\t\n]*\t(TRUE|FALSE)\t/im.test(head) || /^#HttpOnly_/m.test(head);
    if (!looksOk) return { ok: false, code: 'badfile' };
  } catch (_) {
    return { ok: false, code: 'badfile' };
  }
  settings.cookiesFile = file;
  settings.cookies = 'file';
  engine.configure(engineSettings());
  saveSettings();
  return { ok: true, name: path.basename(file), settings };
});
ipcMain.handle('cookies:clearFile', () => {
  settings.cookiesFile = '';
  if (settings.cookies === 'file') settings.cookies = '';
  engine.configure(engineSettings());
  saveSettings();
  return settings;
});

ipcMain.handle('clipboard:read', () => clipboard.readText() || '');

// Copier un lien de l'historique (seuls les liens déjà présents dans l'historique sont acceptés).
ipcMain.handle('clipboard:write', (_e, text) => {
  const ok = typeof text === 'string' && settings.history.some((h) => h && h.url === text);
  if (ok) clipboard.writeText(text);
  return ok;
});

ipcMain.handle('history:remove', (_e, id) => {
  settings.history = settings.history.filter((h) => h && h.id !== id);
  saveSettings();
  return settings.history;
});
ipcMain.handle('history:clear', () => {
  settings.history = [];
  saveSettings();
  return settings.history;
});

ipcMain.handle('analyze', async (_e, input) => {
  const url = toUrl(input);
  if (!url) {
    return {
      ok: false,
      error: { code: 'notlink', suggestUpdate: false, detail: '' },
    };
  }
  try {
    return { ok: true, info: await engine.analyze(url) };
  } catch (err) {
    return { ok: false, error: err.friendly || friendlyError(err.message) };
  }
});

ipcMain.handle('download:start', async (e, opts) => {
  if (active) {
    return { ok: false, error: { code: 'busy', suggestUpdate: false, detail: '' } };
  }
  const url = toUrl(opts && opts.url);
  if (!url) return { ok: false, error: friendlyError('Unsupported URL') };
  // Only known, validated options reach yt-dlp (never raw text from the window).
  const clean = sanitizeDownloadOpts(opts, settings);
  const outDir = settings.folder;
  const sender = e.sender;
  // The engine may still be testing its JavaScript helper (about a second at start-up):
  // hold a placeholder so a second download cannot start, and honour a cancel made meanwhile.
  let cancelledEarly = false;
  active = { cancel: () => { cancelledEarly = true; } };
  await engine.ready;
  if (cancelledEarly) {
    active = null;
    return { ok: false, cancelled: true };
  }
  const blocker = powerSaveBlocker.start('prevent-app-suspension');
  let lastTitle = '';
  const handle = engine.download({ ...clean, url, outDir }, (p) => {
    if (p.title) lastTitle = p.title;
    if (!sender.isDestroyed()) sender.send('download:progress', p);
    if (win && !win.isDestroyed()) win.setProgressBar(Math.max(0.02, p.pct / 100));
  });
  active = handle;
  try {
    const res = await handle.promise;
    const file = res.files[res.files.length - 1] || '';
    res.files.forEach((f) => knownPaths.add(path.resolve(f)));
    knownPaths.add(path.resolve(outDir));
    settings.history = [
      {
        id: newId(),
        title: clean.title || lastTitle || path.basename(file),
        url: url.slice(0, 2000),
        kind: clean.kind,
        quality: clean.kind === 'audio'
          ? clean.audioFormat.toUpperCase()
          : `${clean.height === 'best' ? 'Max' : `${clean.height}p`}${clean.container === 'mkv' ? ' MKV' : ''}`,
        file,
        count: res.files.length,
        date: Date.now(),
      },
      // un même lien (même type) n'apparaît qu'une fois : la dernière version remplace l'ancienne
      ...settings.history.filter((h) => h && h.file !== file && !(h.url === url && h.kind === clean.kind)),
    ].slice(0, HISTORY_MAX);
    saveSettings();
    if (win && !win.isDestroyed() && !win.isFocused()) {
      win.flashFrame(true);
      if (Notification.isSupported()) {
        const n = new Notification({
          title: tm('notify.title'),
          body: clean.title || lastTitle || path.basename(file),
          icon: path.join(__dirname, 'build', 'icon.png'),
        });
        n.on('click', () => { if (file) shell.showItemInFolder(file); });
        n.show();
      }
    }
    return { ok: true, files: res.files, failed: !!res.failed, outDir, history: settings.history };
  } catch (err) {
    if (err && err.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: (err && err.friendly) || friendlyError(err && err.message) };
  } finally {
    active = null;
    powerSaveBlocker.stop(blocker);
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
});

ipcMain.handle('download:cancel', () => {
  if (active) active.cancel();
  return true;
});

ipcMain.handle('folder:choose', async (_e, current) => {
  const start = current && fs.existsSync(current) ? current : app.getPath('videos');
  const r = await dialog.showOpenDialog(win, {
    title: tm('dialog.folder'),
    defaultPath: start,
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

const allowedPath = (p) => {
  if (!p || typeof p !== 'string') return false;
  const r = path.resolve(p);
  return knownPaths.has(r) || r === path.resolve(settings.folder) || r.startsWith(path.resolve(settings.folder) + path.sep);
};

ipcMain.handle('shell:openFolder', async (_e, p) => {
  const target = p && allowedPath(p) ? p : settings.folder;
  try { fs.mkdirSync(target, { recursive: true }); } catch (_) { /* ignore */ }
  return shell.openPath(target);
});
ipcMain.handle('shell:showItem', (_e, p) => {
  if (allowedPath(p)) shell.showItemInFolder(path.resolve(p));
});
ipcMain.handle('shell:openPath', (_e, p) => (allowedPath(p) ? shell.openPath(path.resolve(p)) : 'Path not allowed'));
ipcMain.handle('shell:openData', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('app:info', async () => ({
  appVersion: app.getVersion(),
  ytdlp: await engine.version(),
  dataDir: app.getPath('userData'),
}));

// ---------------------------------------------------------- à propos
/** Adresse du projet (champ « repository » de package.json). Rien n'est affiché tant qu'elle n'est pas renseignée. */
function repoUrl() {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
  const url = String(raw).replace(/^git\+/, '').replace(/\.git$/, '');
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url) ? url : '';
}
const licensesDir = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'licenses')
  : path.join(__dirname, 'licenses'));

ipcMain.handle('about:info', async () => ({
  appVersion: app.getVersion(),
  license: pkg.license || 'MIT',
  repo: repoUrl(),
  ytdlp: await engine.version(),
  ffmpeg: await engine.ffmpegVersion(),
  electron: process.versions.electron || '',
  chrome: process.versions.chrome || '',
}));
/** Text a user can paste into a bug report (no link, no folder, no proxy address: nothing personal). */
async function diagnosticsText() {
  const js = engine.jsRuntime || {};
  let writable = 'no';
  try { fs.mkdirSync(settings.folder, { recursive: true }); fs.accessSync(settings.folder, fs.constants.W_OK); writable = 'yes'; } catch (_) { /* no */ }
  const rows = [
    `EasyTube ${app.getVersion()}${app.isPackaged ? '' : ' (development)'}`,
    isMac
      ? `System: macOS ${process.getSystemVersion()} ${process.arch}${app.runningUnderRosettaTranslation ? ' (Rosetta)' : ''}`
      : `System: ${os.type()} ${os.release()} ${process.arch}`,
    `Electron ${process.versions.electron || '?'} / Chromium ${process.versions.chrome || '?'} / Node ${process.versions.node || '?'}`,
    `yt-dlp: ${(await engine.version()) || 'not found'}`,
    `FFmpeg: ${(await engine.ffmpegVersion()) || 'not found'}`,
    `YouTube JavaScript helper: ${js.ok ? `OK (${js.version})` : `not used (${js.reason || 'off'})`}`,
    `Settings: kind=${settings.kind} quality=${settings.quality} container=${settings.container} audio=${settings.audioFormat} subs=${settings.subs} (${settings.subLangs})`,
    `Network: cookies=${settings.cookies || 'none'}${settings.cookies === 'file' ? (cookiesFileOk() ? ' (file found)' : ' (file missing)') : ''} proxy=${settings.proxy ? 'yes' : 'no'} limit=${settings.limitRate || 'none'} autoCheck=${settings.autoCheck}`,
    `Download folder writable: ${writable}`,
  ];
  return rows.join('\n');
}

ipcMain.handle('diagnostics:copy', async (_e, extra) => {
  let text = await diagnosticsText();
  if (typeof extra === 'string' && extra.trim()) text += `\n\n--- Details ---\n${extra.trim().slice(0, 4000)}`;
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('app:checkUpdate', () => checkAppUpdate());
ipcMain.handle('app:openReleases', () => {
  const url = repoUrl();
  return url ? shell.openExternal(`${url}/releases/latest`) : false;
});

ipcMain.handle('about:openLicenses', () => {
  const dir = licensesDir();
  return fs.existsSync(dir) ? shell.openPath(dir) : 'Licenses folder not found';
});
ipcMain.handle('about:openRepo', () => {
  const url = repoUrl();
  return url ? shell.openExternal(url) : false;
});

ipcMain.handle('engine:update', async () => {
  if (active) return { ok: false, busy: true };
  const r = await engine.update();
  if (r.ok) {
    settings.lastUpdateCheck = Date.now();
    settings.pendingUpdate = '';
    saveSettings();
  }
  return r;
});
