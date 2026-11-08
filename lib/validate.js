'use strict';
/**
 * Validation of everything that comes from the window (the renderer) before it
 * reaches the settings file or the yt-dlp command line.
 * The renderer is treated as untrusted: only known keys, known values, sane sizes.
 * No Electron dependency, so it can be tested on its own (tests/validate.test.js).
 */

const COOKIE_SOURCES = ['', 'firefox', 'edge', 'chrome', 'brave', 'safari', 'file'];
const AUDIO_FORMATS = ['mp3', 'm4a'];
const CONTAINERS = ['mp4', 'mkv'];
const KINDS = ['video', 'audio'];
const HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const LIMITS = ['', '500K', '1M', '2M', '5M', '10M'];
const MAX_ITEMS = 1000;

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';

/** « fr, EN ,pt-BR » -> « fr,en,pt-BR » ; null if invalid. At most 8 languages. */
function normalizeSubLangs(v) {
  if (!isStr(v)) return null;
  const parts = v.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const out = [];
  for (const p of parts) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(p)) return null;
    const [lang, ...rest] = p.split('-');
    const code = [lang.toLowerCase(), ...rest].join('-');
    if (!out.includes(code)) out.push(code);
  }
  return out.join(',');
}

/** Proxy address for yt-dlp: http(s)/socks URL without spaces. '' = no proxy. */
function validProxy(v) {
  if (!isStr(v)) return null;
  const s = v.trim();
  if (s === '') return '';
  if (s.length > 200) return null;
  return /^(https?|socks4a?|socks5h?):\/\/(?:[^\s@\/]+@)?[^\s@\/:]+(?::\d{1,5})?\/?$/i.test(s) ? s : null;
}

/**
 * Cleans a settings patch coming from the window.
 * Unknown keys and invalid values are dropped (never thrown): the valid part still applies.
 * `langs` = supported interface languages.
 */
function sanitizeSettingsPatch(patch, { langs = ['en', 'fr'] } = {}) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  const p = patch;
  if (isStr(p.folder) && p.folder.length > 0 && p.folder.length < 1024 && !p.folder.includes('\0')) out.folder = p.folder;
  if (KINDS.includes(p.kind)) out.kind = p.kind;
  if (p.quality === 'best' || (Number.isInteger(p.quality) && HEIGHTS.includes(p.quality))) out.quality = p.quality;
  if (AUDIO_FORMATS.includes(p.audioFormat)) out.audioFormat = p.audioFormat;
  if (CONTAINERS.includes(p.container)) out.container = p.container;
  if (isBool(p.subs)) out.subs = p.subs;
  if (COOKIE_SOURCES.includes(p.cookies)) out.cookies = p.cookies;
  if (isStr(p.accent) && /^#[0-9a-fA-F]{6}$/.test(p.accent)) out.accent = p.accent.toLowerCase();
  if (isBool(p.sound)) out.sound = p.sound;
  if (langs.includes(p.lang)) out.lang = p.lang;
  if (isBool(p.welcomeSeen)) out.welcomeSeen = p.welcomeSeen;
  if (isBool(p.platformTheme)) out.platformTheme = p.platformTheme;
  if (isBool(p.autoCheck)) out.autoCheck = p.autoCheck;
  if (LIMITS.includes(p.limitRate)) out.limitRate = p.limitRate;
  if ('proxy' in p) { const v = validProxy(p.proxy); if (v !== null) out.proxy = v; }
  if ('subLangs' in p) { const v = normalizeSubLangs(p.subLangs); if (v !== null) out.subLangs = v; }
  return out;
}

/** "1,2,3,5,6,7" -> [1,2,3,5,6,7] ; invalid entries dropped ; sorted, unique, max 1000. */
function cleanItems(v) {
  if (!Array.isArray(v)) return [];
  const set = new Set();
  for (const n of v) {
    if (Number.isInteger(n) && n >= 1 && n <= 100000) set.add(n);
    if (set.size >= MAX_ITEMS) break;
  }
  return [...set].sort((a, b) => a - b);
}

/** [1,2,3,5,6,7,9] -> "1-3,5-7,9" (value of yt-dlp's --playlist-items) */
function itemsToSpec(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j + 1 < items.length && items[j + 1] === items[j] + 1) j += 1;
    out.push(j > i ? `${items[i]}-${items[j]}` : String(items[i]));
    i = j + 1;
  }
  return out.join(',');
}

/**
 * Cleans the options of a download. Anything missing or invalid falls back to the
 * saved setting (`settings`) or to a safe default: yt-dlp never sees raw window input.
 */
function sanitizeDownloadOpts(opts, settings = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const kind = KINDS.includes(o.kind) ? o.kind : 'video';
  const height = o.height === 'best' || (Number.isInteger(o.height) && HEIGHTS.includes(o.height)) ? o.height : 1080;
  const audioFormat = AUDIO_FORMATS.includes(o.audioFormat) ? o.audioFormat : 'mp3';
  const container = CONTAINERS.includes(o.container) ? o.container : (CONTAINERS.includes(settings.container) ? settings.container : 'mp4');
  const playlist = o.playlist === true;
  const items = playlist ? cleanItems(o.playlistItems) : [];
  return {
    kind,
    height,
    audioFormat,
    container,
    subs: o.subs === true,
    playlist,
    playlistItems: items,
    title: isStr(o.title) ? o.title.slice(0, 300) : '',
    thumbnail: isStr(o.thumbnail) && /^https:\/\//i.test(o.thumbnail) ? o.thumbnail.slice(0, 1000) : '',
  };
}

module.exports = {
  COOKIE_SOURCES, AUDIO_FORMATS, CONTAINERS, KINDS, HEIGHTS, LIMITS, MAX_ITEMS,
  normalizeSubLangs, validProxy, sanitizeSettingsPatch, sanitizeDownloadOpts, cleanItems, itemsToSpec,
};
