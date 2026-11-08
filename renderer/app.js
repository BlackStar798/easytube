'use strict';
(() => {
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const app = $('#app');
  const frame = $('#frame');
  const urlInput = $('#url');

  // ------------------------------------------------------------- langues
  // Les textes sont dans locales/en.json et locales/fr.json (chargés par le processus principal).
  let LOCALES = {};
  let LANG = 'en';
  // The main process tells us the platform; without it (tests in a browser) we guess from the browser.
  const IS_MAC = ((window.api && window.api.platform) || (/Mac/i.test(navigator.platform || '') ? 'darwin' : 'win32')) === 'darwin';
  document.documentElement.dataset.platform = IS_MAC ? 'darwin' : 'win32';
  const t = (key, vars) => {
    const dict = LOCALES[LANG] || {};
    let str = null;
    // "<key>.mac" replaces a text that only makes sense on Windows (antivirus, .exe, ...).
    if (IS_MAC) str = dict[`${key}.mac`] != null ? dict[`${key}.mac`] : (LOCALES.en || {})[`${key}.mac`];
    if (str == null) str = dict[key];
    if (str == null) str = (LOCALES.en || {})[key];
    if (str == null) str = key;
    if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : vars[k]));
    return IS_MAC ? str.replace(/Ctrl\+/g, '⌘') : str;
  };
  const hasKey = (key) => key in (LOCALES[LANG] || {}) || key in (LOCALES.en || {});
  let nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  let nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  let rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const S = {
    settings: null,
    info: null,
    kind: 'video',
    height: 1080,
    audioFormat: 'mp3',
    container: 'mp4',
    subs: false,
    lastClip: '',
    result: null,
    plSel: new Set(),       // playlist: positions of the checked videos
    queue: [],              // jobs waiting (and failed ones, until the next run)
    queueRun: null,         // state of the running queue, or null
    curJob: null,
    appUpdate: '',
  };

  // --------------------------------------------------------------- outils
  const fmtBytes = (n) => {
    if (!n) return '';
    if (n >= 1073741824) return `${nf1.format(n / 1073741824)} ${t('unit.gb')}`;
    if (n >= 1048576) return `${nf0.format(n / 1048576)} ${t('unit.mb')}`;
    return `${nf0.format(Math.max(1, n / 1024))} ${t('unit.kb')}`;
  };
  const fmtSpeed = (n) => (n ? `${nf1.format(n / 1048576)} ${t('unit.mbs')}` : '—');
  const fmtEta = (s) => {
    if (s == null) return '—';
    s = Math.round(s);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  const fmtDuration = (s) => {
    if (!s) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();
  const shortPath = (p) => {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean);
    if (parts.length <= 3) return p;
    const sep = p.includes('\\') ? '\\' : '/';
    return `${parts[0]}${sep}…${sep}${parts.slice(-2).join(sep)}`;
  };
  const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
  /** Every http(s) link found in a text (one per line, or separated by spaces), without duplicates. */
  function extractUrls(text) {
    const found = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    return [...new Set(found.map((u) => u.replace(/[),.;]+$/, '')))];
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return String(u || ''); } };
  /** A pure playlist address (youtube.com/playlist?list=…): downloaded as a whole playlist. */
  const isPlaylistUrl = (u) => { try { const x = new URL(u); return /\/playlist\/?$/.test(x.pathname) && x.searchParams.has('list'); } catch (_) { return false; } };
  const flashLabel = (btn, key, ms = 1400) => {
    const old = btn.textContent;
    btn.textContent = t(key);
    setTimeout(() => { if (btn.isConnected) btn.textContent = old; }, ms);
  };
  const fmtWhen = (ts) => {
    const days = Math.round((ts - Date.now()) / 86400000);
    return rel.format(Math.min(0, days), 'day');
  };
  const TAGS = { 4320: '8K', 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD', 480: 'Standard' };
  const tagFor = (h) => (h === 360 ? t('tag.360') : TAGS[h] || '');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // -------------------------------------------------------------- couleurs
  const DEFAULT_ACCENT = '#8b5cf6';
  const PRESETS = [
    ['Mauve', '#8b5cf6'], ['Rouge', '#e5283a'], ['Rose', '#ec4899'], ['Orange', '#f97316'],
    ['Or', '#f5b301'], ['Vert', '#22c55e'], ['Turquoise', '#14b8a6'], ['Bleu', '#3b82f6'],
  ];
  const isHex = (h) => /^#[0-9a-f]{6}$/i.test(String(h || ''));
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, sat = 0;
    const l = (max + min) / 2;
    if (d) {
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, sat * 100, l * 100];
  }
  function hslToRgb(h, sat, l) {
    sat /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  const linear = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  /** Dérive toute la palette (dégradé, halo, texte) à partir d'une seule couleur. */
  function applyAccent(hex) {
    if (!isHex(hex)) hex = DEFAULT_ACCENT;
    const [h, s0, l0] = hexToHsl(hex);
    const neutral = s0 < 12;                       // gris / blanc (ex. X) : on reste neutre au lieu de forcer une teinte
    const sat = neutral ? 0 : Math.max(s0, 45);
    const base = neutral ? 80 : Math.min(Math.max(l0, 42), 62);
    const css = (l, sSat = sat) => `hsl(${Math.round(h)} ${Math.round(sSat)}% ${Math.round(l)}%)`;
    const rgb = hslToRgb(h, sat, base);
    const white = 1.05 / (luminance(rgb) + 0.05);
    const warm = h <= 20 || h >= 335;
    const orange = h > 20 && h < 70;
    const st = document.documentElement.style;
    st.setProperty('--accent', css(base));
    st.setProperty('--accent-hi', css(base + 9));
    st.setProperty('--accent-lo', css(base - 9));
    st.setProperty('--accent-text', css(neutral ? 90 : 76, Math.min(sat, 95)));
    st.setProperty('--glow', `rgba(${rgb.join(',')}, 0.2)`);
    st.setProperty('--glow-strong', `rgba(${rgb.join(',')}, 0.55)`);
    st.setProperty('--on-accent', white >= 3.3 ? '#fff' : '#0a0a0e');
    st.setProperty('--danger', warm ? '#ffb454' : orange ? '#ff6b6b' : '#ff8f7e');
  }

  // ------------------------------------------------------ thème selon le site
  // Couleur de chaque site (la teinte du thème se recalcule à partir d'elle, comme pour le choix manuel).
  const SITES = [
    { name: 'YouTube', color: '#ff0000', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
    { name: 'Twitch', color: '#9146ff', hosts: ['twitch.tv'] },
    { name: 'Facebook', color: '#1877f2', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
    { name: 'Instagram', color: '#e1306c', hosts: ['instagram.com'] },
    { name: 'TikTok', color: '#fe2c55', hosts: ['tiktok.com'] },
    { name: 'X', color: '#e7e9ea', hosts: ['x.com', 'twitter.com'] },
    { name: 'Vimeo', color: '#1ab7ea', hosts: ['vimeo.com'] },
    { name: 'Dailymotion', color: '#0066dc', hosts: ['dailymotion.com', 'dai.ly'] },
    { name: 'Reddit', color: '#ff4500', hosts: ['reddit.com', 'redd.it'] },
    { name: 'SoundCloud', color: '#ff5500', hosts: ['soundcloud.com', 'snd.sc'] },
    { name: 'Kick', color: '#53fc18', hosts: ['kick.com'] },
    { name: 'Rumble', color: '#85c742', hosts: ['rumble.com'] },
    { name: 'Bilibili', color: '#00a1d6', hosts: ['bilibili.com', 'b23.tv'] },
    { name: 'Pinterest', color: '#e60023', hosts: ['pinterest.com', 'pin.it'] },
  ];
  /** Reconnaît le site d'un lien (null si inconnu). « evilyoutube.com » ou « youtube.com.autre.fr » ne comptent pas. */
  function detectSite(input) {
    const raw = String(input || '').trim();
    if (!raw || /\s/.test(raw) || raw.length > 2000) return null;
    let host = '';
    try {
      host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    } catch (_) { return null; }
    return SITES.find((x) => x.hosts.some((d) => host === d || host.endsWith(`.${d}`))) || null;
  }

  /** Site à afficher : le lien de la barre à l'accueil, le lien analysé ensuite. */
  function currentSite() {
    const url = app.dataset.state === 'idle' || !S.info ? urlInput.value : S.info.url;
    return detectSite(url);
  }

  /** Applique la couleur du site (si l'option est active) ou, sinon, la couleur choisie dans les Réglages. */
  function refreshTheme() {
    if (!S.settings) return;
    const site = currentSite();
    const useSite = site && S.settings.platformTheme !== false && !S.themeSuspended;
    const hex = useSite ? site.color : (isHex(S.settings.accent) ? S.settings.accent : DEFAULT_ACCENT);
    if (hex !== S.appliedHex) { applyAccent(hex); S.appliedHex = hex; }
    const chip = $('#site-chip');
    const shown = !!site && !S.themeSuspended;
    if (shown) $('#site-name').textContent = site.name;
    if (chip.hidden === shown) chip.hidden = !shown;
  }

  function renderSwatches() {
    const box = $('#swatches');
    const custom = $('#swatch-custom');
    $$('.swatch[data-preset]', box).forEach((n) => n.remove());
    const cur = String(S.settings.accent || DEFAULT_ACCENT).toLowerCase();
    let matched = false;
    PRESETS.forEach(([name, hex]) => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.dataset.preset = hex;
      const label = t(`swatch.${name}`);
      b.title = label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', label);
      b.style.setProperty('--c', hex);
      const on = hex === cur;
      matched = matched || on;
      b.setAttribute('aria-checked', String(on));
      b.addEventListener('click', () => pickAccent(hex));
      box.insertBefore(b, custom);
    });
    custom.classList.toggle('on', !matched);
    custom.style.setProperty('--c', cur);
    $('#custom-color').value = cur;
  }

  async function pickAccent(hex) {
    S.settings = await api.setSettings({ accent: hex.toLowerCase() });
    S.appliedHex = null;
    refreshTheme();
    renderSwatches();
  }

  // ---------------------------------------------------- confettis et son
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function confetti() {
    if (reduceMotion()) return;
    const cv = $('#confetti');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(window.innerWidth * dpr);
    cv.height = Math.round(window.innerHeight * dpr);
    cv.hidden = false;
    const cs = getComputedStyle(document.documentElement);
    const pick = (n) => cs.getPropertyValue(n).trim();
    const colors = [pick('--accent-hi'), pick('--accent-text'), pick('--accent'), '#ffffff', '#ffd166'];
    const seal = $('.seal').getBoundingClientRect();
    const ox = (seal.left + seal.width / 2) * dpr;
    const oy = (seal.top + seal.height / 2) * dpr;
    const parts = Array.from({ length: 150 }, () => {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.25;
      const v = (7 + Math.random() * 11) * dpr;
      return {
        x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: (6 + Math.random() * 6) * dpr, h: (4 + Math.random() * 5) * dpr,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
        c: colors[Math.floor(Math.random() * colors.length)],
        round: Math.random() < 0.3, life: 120 + Math.random() * 80,
      };
    });
    let frame = 0;
    const tick = () => {
      frame += 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = 0;
      parts.forEach((p) => {
        p.vy += 0.34 * dpr; p.vx *= 0.987; p.vy *= 0.987;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (frame > p.life || p.y > cv.height + 40) return;
        alive += 1;
        ctx.globalAlpha = Math.min(1, (p.life - frame) / 40);
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.6, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (alive && frame < 260) requestAnimationFrame(tick);
      else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
    };
    requestAnimationFrame(tick);
  }

  let actx = null;
  function warmAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (_) { /* pas de son, tant pis */ }
  }
  function chime() {
    if (!S.settings.sound) return;
    try {
      warmAudio();
      const t = actx.currentTime;
      [[659.25, 0], [880, 0.11], [1318.5, 0.22]].forEach(([f, d]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.linearRampToValueAtTime(0.09, t + d + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
        o.connect(g); g.connect(actx.destination);
        o.start(t + d); o.stop(t + d + 0.65);
      });
    } catch (_) { /* ignore */ }
  }

  // --------------------------------------------------------------- états
  // Filet de sécurité : si aucune progression n'arrive, la barre devient « en attente »
  // au lieu de rester figée à 0 %.
  let indetTimer = null;
  function stopIndet() {
    clearTimeout(indetTimer);
    indetTimer = null;
    $('#track').classList.remove('indet');
  }
  function armIndet() {
    stopIndet();
    S.gotProgress = false;
    indetTimer = setTimeout(() => {
      if (!S.gotProgress && app.dataset.state === 'downloading') {
        setStep('📥', 'step.waiting');
        $('#track').classList.add('indet');
      }
    }, 4000);
  }

  function setState(s) {
    app.dataset.state = s;
    if (s !== 'downloading' && s !== 'cancelling') stopIndet();
    const busy = s === 'loading' || s === 'downloading' || s === 'cancelling';
    urlInput.disabled = busy;
    $('#btn-paste').disabled = busy;
    $('#btn-analyze').disabled = busy;
    $('#btn-settings').disabled = s === 'downloading' || s === 'cancelling';
    refreshTheme();
    updateQueueUi();
  }

  function setProgress(pct) {
    const v = Math.max(0, Math.min(100, pct));
    frame.style.setProperty('--p', `${v}%`);
    app.style.setProperty('--p', `${v}%`);
    $('#track').setAttribute('aria-valuenow', String(Math.floor(v)));
    $('#pct').textContent = String(Math.floor(v));
  }

  // ------------------------------------------------------------- dossier
  function renderDest() {
    const p = S.settings.folder;
    ['#dest-path-idle', '#dest-path', '#dest-path-set'].forEach((sel) => {
      const n = $(sel);
      n.textContent = shortPath(p);
      n.title = p;
    });
  }

  async function chooseFolder() {
    const d = await api.chooseFolder(S.settings.folder);
    if (!d) return;
    S.settings = await api.setSettings({ folder: d });
    renderDest();
  }

  // ----------------------------------------------------------- historique
  function icon(id, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  function actionBtn(act, iconId, label) {
    const b = el('button', 'h-act');
    b.type = 'button';
    b.dataset.act = act;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(iconId));
    return b;
  }

  function renderRecents() {
    const list = $('#recent-list');
    list.innerHTML = '';
    const items = (S.settings.history || []).filter(Boolean);
    $('#recents').hidden = items.length === 0;
    $('#tips').hidden = items.length > 0;
    items.forEach((h) => {
      const site = detectSite(h.url);
      const li = el('li', 'h-item');

      const main = el('button', 'h-main');
      main.type = 'button';
      main.title = h.url ? `${t('history.reuse')}\n${h.url}` : (h.file || '');
      const dot = el('span', 'h-dot');
      if (site) dot.style.setProperty('--c', site.color);
      const text = el('span', 'h-text');
      const name = h.count > 1 ? t('recents.many', { title: h.title, count: h.count }) : h.title;
      text.append(el('span', 'r-title', `${h.kind === 'audio' ? '🎧' : '🎞️'}  ${name}`));
      text.append(el('span', 'r-meta', `${site ? `${site.name} · ` : ''}${h.quality}, ${fmtWhen(h.date)}`));
      main.append(dot, text);
      // clic = on remet le lien dans la barre et on l'analyse ; anciennes entrées sans lien : on montre le fichier
      main.addEventListener('click', () => {
        if (h.url) { urlInput.value = h.url; analyze(h.url); } else if (h.file) api.showItem(h.file);
      });
      li.append(main);

      const acts = el('span', 'h-actions');
      if (h.url) {
        const copy = actionBtn('copy', 'i-copy', t('history.copy'));
        copy.addEventListener('click', async () => {
          if (!(await api.copyText(h.url))) return;
          copy.classList.add('ok');
          copy.replaceChildren(icon('i-check'));
          copy.title = t('history.copied');
          copy.setAttribute('aria-label', t('history.copied'));
          setTimeout(() => {
            if (!copy.isConnected) return;
            copy.classList.remove('ok');
            copy.replaceChildren(icon('i-copy'));
            copy.title = t('history.copy');
            copy.setAttribute('aria-label', t('history.copy'));
          }, 1400);
        });
        acts.append(copy);
      }
      if (h.file) {
        const show = actionBtn('show', 'i-folder', t('history.show'));
        show.addEventListener('click', () => api.showItem(h.file));
        acts.append(show);
      }
      const del = actionBtn('remove', 'i-x', t('history.remove'));
      del.addEventListener('click', async () => {
        S.settings.history = await api.removeHistory(h.id);
        renderRecents();
      });
      acts.append(del);
      li.append(acts);
      list.append(li);
    });
    disarmClear();
  }

  // « Tout effacer » demande une deuxième confirmation (3 secondes pour confirmer).
  let clearTimer = null;
  function disarmClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    $('#btn-clear-history').textContent = t('history.clear');
  }
  $('#btn-clear-history').addEventListener('click', async () => {
    if (!clearTimer) {
      $('#btn-clear-history').textContent = t('history.confirm');
      clearTimer = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    S.settings.history = await api.clearHistory();
    renderRecents();
  });

  // -------------------------------------------------------- presse-papiers
  async function checkClipboard() {
    if (app.dataset.state !== 'idle' || urlInput.value.trim()) return;
    const t = (await api.readClipboard()).trim();
    if (looksLikeUrl(t) && t !== S.lastClip) {
      S.clipCandidate = t;
      $('#clip-hint').hidden = false;
    } else {
      $('#clip-hint').hidden = true;
    }
  }

  // -------------------------------------------------------------- analyse
  /** Titre + piste d'une erreur, dans la langue choisie (l'erreur arrive avec un simple code). */
  function errText(e) {
    const code = e && e.code && hasKey(`err.${e.code}.title`) ? e.code : 'generic';
    return { title: t(`err.${code}.title`), hint: t(`err.${code}.hint`) };
  }

  function showIdleError(err) {
    S.idleErr = err;
    const txt = errText(err);
    $('#idle-error-title').textContent = txt.title;
    $('#idle-error-hint').textContent = txt.hint;
    $('#btn-idle-update').hidden = !err.suggestUpdate;
    $('#idle-detail').textContent = err.detail || '';
    $('#idle-details').hidden = !err.detail;
    $('#idle-details').open = false;
    $('#idle-error').hidden = false;
  }

  async function analyze(raw) {
    const value = String(raw || '').trim();
    if (!value) { urlInput.focus(); return; }
    $('#idle-error').hidden = true;
    $('#clip-hint').hidden = true;
    S.lastClip = value;
    S.info = null;
    frame.classList.remove('has-thumb');
    $('#title').textContent = '';
    $('#uploader').textContent = '';
    $('#duration').hidden = true;
    setProgress(0);
    setState('loading');

    const r = await api.analyze(value);
    if (!r.ok) {
      setState('idle');
      showIdleError(r.error);
      urlInput.focus();
      return;
    }
    S.info = r.info;
    renderInfo();
    setState('ready');
    $('#btn-download').focus();
  }

  const infoTitle = () => S.info.title || t(S.info.kind === 'playlist' ? 'playlist.title' : 'untitled');
  function renderInfoText() {
    const i = S.info;
    $('#title').textContent = infoTitle();
    $('#uploader').textContent = i.kind === 'playlist'
      ? `${t('playlist.line', { count: i.count })}${i.uploader ? `, ${i.uploader}` : ''}`
      : i.uploader;
  }

  function renderInfo() {
    const i = S.info;
    renderInfoText();
    const d = $('#duration');
    d.hidden = !i.duration;
    d.textContent = fmtDuration(i.duration);

    frame.classList.remove('has-thumb');
    if (i.thumbnail) {
      const base = $('#thumb-base');
      const col = $('#thumb-color');
      base.onload = () => frame.classList.add('has-thumb');
      base.onerror = () => frame.classList.remove('has-thumb');
      base.src = i.thumbnail;
      col.src = i.thumbnail;
    }

    $('#subs').checked = !!S.subs && i.kind !== 'playlist';
    buildPlaylistSelect();
    renderKind();
  }

  function visibleHeights(list) {
    const big = list.filter((x) => x.h >= 360);
    return big.length ? big : list;
  }

  function renderKind() {
    const i = S.info;
    $$('.seg button[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind)));
    $('#grp-quality').hidden = S.kind !== 'video';
    $('#grp-audio').hidden = S.kind !== 'audio';
    $('#row-subs').hidden = S.kind !== 'video' || i.kind === 'playlist';
    $('#row-container').hidden = S.kind !== 'video';

    if (S.kind === 'video') buildQuality(); else buildAudio();
    renderContainer();
    updateCta();
  }

  /** MP4 / MKV buttons, and the hint shown when a quality above 1080p is chosen with MP4. */
  function renderContainer() {
    $$('[data-container]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.container === S.container)));
    if (!S.info) return;
    const top = (visibleHeights(S.info.heights || [])[0] || {}).h || 0;
    const h = S.height === 'best' ? top : Number(S.height);
    $('#hint-codec').hidden = !(S.kind === 'video' && S.container === 'mp4' && h > 1080);
  }

  // ---- playlist: choose which videos to download
  const plItems = () => (S.info && S.info.kind === 'playlist' ? (S.info.items || []) : []);
  function buildPlaylistSelect() {
    const items = plItems();
    const box = $('#pl-select');
    box.hidden = items.length < 2;
    S.plSel = new Set(items.map((x) => x.index));
    if (box.hidden) return;
    const list = $('#pl-list');
    list.innerHTML = '';
    items.forEach((x) => {
      const li = el('li');
      const lab = el('label', 'pl-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.value = String(x.index);
      cb.addEventListener('change', () => {
        if (cb.checked) S.plSel.add(x.index); else S.plSel.delete(x.index);
        plChanged();
      });
      lab.append(cb, el('span', 'pl-n', String(x.index)), el('span', 'pl-t', x.title || t('untitled')), el('span', 'pl-d', fmtDuration(x.duration)));
      li.append(lab);
      list.append(li);
    });
    const more = $('#pl-more');
    more.hidden = !(S.info.count > items.length);
    if (!more.hidden) more.textContent = t('pl.more', { n: items.length });
    box.open = false;
    plChanged();
  }
  function plChanged() {
    const items = plItems();
    if (!items.length) return;
    $('#pl-summary').textContent = t('pl.summary', { n: S.plSel.size, total: items.length });
    $$('#pl-list input').forEach((cb) => { cb.checked = S.plSel.has(Number(cb.value)); });
    updateCta();
  }
  /** Positions to download; empty = the whole playlist. */
  function selectedItems() {
    const items = plItems();
    if (!items.length || S.plSel.size >= items.length) return [];
    return [...S.plSel].sort((a, b) => a - b);
  }

  function radioRow(name, value, h, tag, size, checked, onPick) {
    const label = el('label', 'row');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(value);
    input.checked = checked;
    input.addEventListener('change', () => onPick(value));
    // grille : [pastille][qualité][description (espace restant)][taille]
    label.append(input, el('span', 'dot'), el('span', 'h', h), el('span', 'tag', tag || ''), el('span', 'size', size || ''));
    return label;
  }

  function buildQuality() {
    const box = $('#quality-list');
    box.innerHTML = '';
    const list = visibleHeights(S.info.heights || []);
    if (!list.length) {
      S.height = 'best';
      box.append(radioRow('q', 'best', t('quality.best'), '', '', true, () => {}));
      return;
    }
    let chosen = list.find((x) => x.h <= Number(S.height) || S.height === 'best');
    if (S.height === 'best') chosen = list[0];
    if (!chosen) chosen = list[list.length - 1];
    S.height = chosen.h;
    list.forEach((x) => {
      box.append(radioRow('q', x.h, `${x.h}p`, tagFor(x.h), x.size ? `≈ ${fmtBytes(x.size)}` : '', x.h === chosen.h, (v) => {
        S.height = v;
        api.setSettings({ quality: v });
        renderContainer();
        updateCta();
      }));
    });
  }

  function buildAudio() {
    const box = $('#audio-list');
    box.innerHTML = '';
    const size = S.info.audioSize ? `≈ ${fmtBytes(S.info.audioSize)}` : '';
    const opts = [
      ['mp3', 'MP3', t('audio.mp3')],
      ['m4a', 'M4A', t('audio.m4a')],
    ];
    opts.forEach(([v, h, tag]) => {
      box.append(radioRow('a', v, h, tag, size, S.audioFormat === v, (val) => {
        S.audioFormat = val;
        api.setSettings({ audioFormat: val });
      }));
    });
  }

  function updateCta() {
    let size = '';
    let none = false;
    if (S.info.kind !== 'playlist') {
      if (S.kind === 'video') {
        const x = (S.info.heights || []).find((y) => y.h === S.height);
        if (x && x.size) size = `≈ ${fmtBytes(x.size)}`;
      } else if (S.info.audioSize) {
        size = `≈ ${fmtBytes(S.info.audioSize)}`;
      }
    } else if (selectedItems().length || (plItems().length && S.plSel.size === 0)) {
      size = t('pl.selected', { n: S.plSel.size, count: S.info.count });
      none = S.plSel.size === 0;
    } else {
      size = t('playlist.count', { count: S.info.count });
    }
    $('#cta-size').textContent = size;
    $('#btn-download').disabled = none;
    $('#btn-queue-add').disabled = none;
  }

  // ------------------------------------------------------- téléchargement
  const STEPS = {
    download: ['📥', 'step.download'],
    merge: ['🎞️', 'step.merge'],
    audio: ['🎧', 'step.audio'],
    cover: ['🖼️', 'step.cover'],
    subs: ['💬', 'step.subs'],
    final: ['✨', 'step.final'],
  };
  S.step = { emoji: '⏳', key: 'step.prepare' };
  function renderStep() {
    const { emoji, key, vars } = S.step;
    $('#step-emoji').textContent = emoji;
    $('#step-text').textContent = t(key, vars && vars.innerKey ? { ...vars, inner: t(vars.innerKey) } : vars);
  }
  function setStep(emoji, key, vars) {
    S.step = { emoji, key, vars };
    renderStep();
  }

  function onProgress(p) {
    if (app.dataset.state !== 'downloading' && app.dataset.state !== 'cancelling') return;
    S.gotProgress = true;
    $('#track').classList.remove('indet');
    setProgress(p.pct);
    const [emoji, key] = STEPS[p.phase] || STEPS.download;
    if (app.dataset.state === 'cancelling') setStep('✋', 'step.cancelling');
    else if (p.items > 1) setStep(emoji, 'step.item', { item: p.item, items: p.items, innerKey: key });
    else setStep(emoji, key);
    if (p.title && S.curJob && (S.curJob.playlist || !S.curJob.title)) $('#dl-title').textContent = p.title;
    $('#speed').textContent = fmtSpeed(p.speed);
    $('#eta').textContent = fmtEta(p.eta);
    $('#recv').textContent = p.total ? `${fmtBytes(p.downloaded)} / ${fmtBytes(p.total)}` : fmtBytes(p.downloaded) || '—';
  }

  /** What the user chose for the video on screen. */
  function currentSelection() {
    const i = S.info;
    const isPl = i.kind === 'playlist';
    return {
      url: i.url,
      title: infoTitle(),
      kind: S.kind,
      height: S.height,
      audioFormat: S.audioFormat,
      container: S.container,
      subs: S.kind === 'video' && !isPl && $('#subs').checked,
      playlist: isPl,
      playlistItems: isPl ? selectedItems() : [],
    };
  }

  /** Runs one download (single or from the queue) and resolves with the main process's answer. */
  async function runDownload(job, queueInfo) {
    setProgress(0);
    setStep('⏳', 'step.prepare');
    warmAudio();
    $('#speed').textContent = '—';
    $('#eta').textContent = '—';
    $('#recv').textContent = '—';
    $('#btn-cancel').disabled = false;
    $('#dl-title').textContent = job.title || hostOf(job.url);
    S.queueInfo = queueInfo || null;
    const q = $('#dl-queue');
    q.hidden = !queueInfo;
    if (queueInfo) q.textContent = t('queue.progress', queueInfo);
    S.curJob = job;
    setState('downloading');
    armIndet();
    const res = await api.download({
      url: job.url,
      title: job.title,
      kind: job.kind,
      height: job.height,
      audioFormat: job.audioFormat,
      container: job.container,
      subs: job.subs,
      playlist: job.playlist,
      playlistItems: job.playlistItems,
    });
    S.curJob = null;
    return res;
  }

  async function startDownload() {
    if (!S.info) return;
    S.lastWasQueue = false;
    const sel = currentSelection();
    const res = await runDownload(sel, null);

    if (res.ok) {
      S.result = res;
      S.doneQueue = null;
      S.settings.history = res.history || S.settings.history;
      showDone(res, sel.kind);
    } else if (res.cancelled) {
      setProgress(0);
      setState('ready');
      $('#btn-download').focus();
    } else {
      showError(res.error);
    }
  }

  // ------------------------------------------------------ file d'attente
  const newJobId = () => Math.random().toString(36).slice(2, 10);

  function queueMeta(j) {
    if (j.status === 'failed') return j.errTitle || t('err.generic.title');
    const site = detectSite(j.url);
    const q = j.kind === 'audio'
      ? String(j.audioFormat).toUpperCase()
      : `${j.height === 'best' ? 'Max' : `${j.height}p`} · ${String(j.container).toUpperCase()}`;
    const extra = j.playlist ? ` · ${t('playlist.title')}${j.playlistItems.length ? ` (${j.playlistItems.length})` : ''}` : '';
    return `${q}${extra}${site ? ` · ${site.name}` : ''}`;
  }

  function renderQueue() {
    const q = S.queue;
    $('#queue').hidden = q.length === 0;
    $('#queue-count').textContent = String(q.length);
    const list = $('#queue-list');
    list.innerHTML = '';
    q.forEach((j) => {
      const now = S.queueRun && S.queueRun.current === j.id;
      const li = el('li', `q-item${now ? ' now' : ''}${j.status === 'failed' ? ' failed' : ''}`);
      const text = el('span', 'q-text');
      text.append(el('span', 'q-title', j.title || hostOf(j.url)), el('span', 'q-meta', queueMeta(j)));
      li.append(text);
      if (!now) {
        const acts = el('span', 'h-actions');
        const del = actionBtn('remove', 'i-x', t('queue.remove'));
        del.addEventListener('click', () => { S.queue = S.queue.filter((x) => x.id !== j.id); renderQueue(); });
        acts.append(del);
        li.append(acts);
      }
      list.append(li);
    });
    updateQueueUi();
  }

  /** Start / Clear are only available when nothing is running. */
  function updateQueueUi() {
    const st = app.dataset.state;
    const busy = !!S.queueRun || st === 'loading' || st === 'downloading' || st === 'cancelling';
    $('#btn-queue-start').hidden = busy || S.queue.length === 0;
    $('#btn-queue-clear').hidden = !!S.queueRun || S.queue.length === 0;
  }

  function addCurrentToQueue() {
    if (!S.info) return;
    const sel = currentSelection();
    S.queue.push({ id: newJobId(), status: 'queued', ...sel });
    renderQueue();
    const b = $('#btn-queue-add');
    b.classList.add('ok');
    $('#queue-add-label').textContent = t('queue.added');
    setTimeout(() => {
      b.classList.remove('ok');
      $('#queue-add-label').textContent = t('queue.addshort');
      reset();
    }, 650);
  }

  /** Several links pasted at once: they join the queue with the current default choices. */
  function addUrlsToQueue(urls) {
    let added = 0;
    urls.forEach((u) => {
      if (S.queue.some((j) => j.url === u)) return;
      S.queue.push({
        id: newJobId(), status: 'queued', url: u, title: '', kind: S.kind, height: S.height,
        audioFormat: S.audioFormat, container: S.container, subs: S.kind === 'video' && S.subs,
        playlist: isPlaylistUrl(u), playlistItems: [],
      });
      added += 1;
    });
    urlInput.value = '';
    renderQueue();
    $('#queue-msg').textContent = t('queue.batch', { count: added });
    clearTimeout(S.queueMsgTimer);
    S.queueMsgTimer = setTimeout(() => { $('#queue-msg').textContent = ''; }, 5000);
    refreshTheme();
  }

  async function runQueue() {
    const st = app.dataset.state;
    if (S.queueRun || !S.queue.length || st === 'loading' || st === 'downloading' || st === 'cancelling') return;
    S.queue.forEach((j) => { j.status = 'queued'; j.tried = false; });
    const run = {
      total: S.queue.length, n: 0, ok: 0, failed: 0, stop: false, current: null, files: [], outDir: '', lastKind: 'video', lastErr: null,
    };
    S.queueRun = run;
    S.lastWasQueue = true;
    S.doneQueue = null;
    renderQueue();
    for (;;) {
      const job = S.queue.find((j) => !j.tried);
      if (!job || run.stop) break;
      job.tried = true;
      job.status = 'running';
      run.n += 1;
      run.current = job.id;
      renderQueue();
      const res = await runDownload(job, { n: run.n, total: run.total });
      run.current = null;
      if (res.ok) {
        run.ok += 1;
        run.files.push(...res.files);
        run.outDir = res.outDir;
        run.lastKind = job.kind;
        S.settings.history = res.history || S.settings.history;
        S.queue = S.queue.filter((x) => x !== job);
      } else if (res.cancelled) {
        run.stop = true;
        job.status = 'queued';
        job.tried = false;
      } else {
        run.failed += 1;
        run.lastErr = res.error;
        job.status = 'failed';
        job.errTitle = errText(res.error).title;
      }
      renderQueue();
    }
    S.queueRun = null;
    renderQueue();
    if (run.stop) {
      setProgress(0);
      reset();
    } else if (run.ok > 0) {
      S.result = { files: run.files, outDir: run.outDir, failed: false };
      S.doneQueue = run.total > 1 ? { ok: run.ok, failed: run.failed } : null;
      showDone(S.result, run.lastKind);
    } else {
      showError(run.lastErr);
    }
  }

  function renderDone() {
    const res = S.result;
    if (!res) return;
    const many = res.files.length > 1;
    const q = S.doneQueue;
    $('#done-file').textContent = q
      ? t('queue.summary', q)
      : (many ? t('done.many', { count: res.files.length, dir: res.outDir }) : baseName(res.files[0]));
    const note = $('#done-note');
    note.hidden = !res.failed;
    note.textContent = res.failed ? t('done.failed') : '';
    $('#btn-play').textContent = many ? t('done.play.many') : t(S.doneKind === 'audio' ? 'done.play.audio' : 'done.play.video');
    $('#done-title').textContent = q ? t('queue.done') : t(S.doneKind === 'audio' ? 'done.audio' : 'done.video');
  }

  function showDone(res, kind) {
    setProgress(100);
    frame.style.setProperty('--p', '100%');
    S.doneKind = kind || S.kind;
    renderDone();
    setState('done');
    $('#done-title').focus({ preventScroll: true });
    requestAnimationFrame(confetti);
    chime();
  }

  function renderErrorText() {
    const txt = errText(S.err);
    $('#err-title').textContent = txt.title;
    $('#err-hint').textContent = txt.hint;
  }

  function showError(err) {
    const e = err || { code: 'generic', suggestUpdate: true, detail: '' };
    S.err = e;
    renderErrorText();
    $('#err-detail').textContent = e.detail || '';
    $('#err-details').hidden = !e.detail;
    $('#err-details').open = false;
    $('#btn-err-update').hidden = !e.suggestUpdate;
    $('#err-update-status').textContent = '';
    setProgress(0);
    setState('error');
  }

  function reset() {
    S.info = null;
    urlInput.value = '';
    $('#duration').hidden = true;
    frame.classList.remove('has-thumb');
    setProgress(0);
    renderRecents();
    setState('idle');
    urlInput.focus();
    checkClipboard();
  }

  // ------------------------------------------------------ mise à jour moteur
  async function runUpdate(statusEl, btn) {
    btn.disabled = true;
    statusEl.textContent = t('upd.progress');
    const r = await api.updateEngine();
    btn.disabled = false;
    if (r.busy) statusEl.textContent = t('upd.busy');
    else if (!r.ok) statusEl.textContent = t('upd.fail');
    else statusEl.textContent = r.changed ? t('upd.changed', { v: r.after }) : t('upd.same', { v: r.after || '?' });
    if (r.ok && r.after) $('#ver').textContent = r.after;
    if (r.ok) { S.settings.pendingUpdate = ''; renderBanner(); }
    return r;
  }

  function renderBanner() {
    const v = S.settings.pendingUpdate;
    $('#upd-banner').hidden = !v;
    if (v) $('#upd-banner-text').textContent = t('banner.new', { v });
  }

  // ---------------------------------------------------------------- liens
  $('#url-form').addEventListener('submit', (e) => { e.preventDefault(); analyze(urlInput.value); });
  /** Pasted or dropped text: several links join the queue, a single link is analyzed. Returns true if handled. */
  function handlePasted(text) {
    const raw = String(text || '').trim();
    const urls = extractUrls(raw);
    if (urls.length > 1) { addUrlsToQueue(urls); return true; }
    if (looksLikeUrl(raw)) { urlInput.value = raw; analyze(raw); return true; }
    return false;
  }
  $('#btn-paste').addEventListener('click', async () => {
    const txt = (await api.readClipboard()).trim();
    if (handlePasted(txt)) return;
    if (txt) { urlInput.value = txt; analyze(txt); } else { urlInput.focus(); }
  });
  urlInput.addEventListener('paste', (e) => {
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (handlePasted(txt)) e.preventDefault();
  });
  urlInput.addEventListener('input', () => { $('#idle-error').hidden = true; refreshTheme(); });
  $('#btn-clip').addEventListener('click', () => { urlInput.value = S.clipCandidate; analyze(S.clipCandidate); });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (welcomeOpen() || app.dataset.state === 'loading' || app.dataset.state === 'downloading') return;
    handlePasted(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '');
  });
  window.addEventListener('focus', checkClipboard);

  // ------------------------------------------------------------- actions
  $$('[data-act="folder"]').forEach((b) => b.addEventListener('click', chooseFolder));
  $$('.seg button[data-kind]').forEach((b) => b.addEventListener('click', () => {
    S.kind = b.dataset.kind;
    api.setSettings({ kind: S.kind });
    renderKind();
  }));
  $$('[data-container]').forEach((b) => b.addEventListener('click', () => {
    S.container = b.dataset.container;
    api.setSettings({ container: S.container });
    renderContainer();
  }));
  $('#subs').addEventListener('change', (e) => { S.subs = e.target.checked; api.setSettings({ subs: S.subs }); });
  $('#btn-download').addEventListener('click', startDownload);
  $('#btn-queue-add').addEventListener('click', addCurrentToQueue);
  $('#btn-queue-start').addEventListener('click', runQueue);
  $('#btn-queue-clear').addEventListener('click', () => { S.queue = []; renderQueue(); });
  $('#pl-all').addEventListener('click', () => { S.plSel = new Set(plItems().map((x) => x.index)); plChanged(); });
  $('#pl-none').addEventListener('click', () => { S.plSel = new Set(); plChanged(); });
  $('#btn-err-copy').addEventListener('click', async () => {
    await api.copyDiagnostics((S.err && S.err.detail) || '');
    flashLabel($('#btn-err-copy'), 'err.copied');
  });
  $('#btn-idle-copy').addEventListener('click', async () => {
    await api.copyDiagnostics((S.idleErr && S.idleErr.detail) || '');
    flashLabel($('#btn-idle-copy'), 'err.copied');
  });
  $('#btn-app-banner').addEventListener('click', () => api.openReleases());
  $('#btn-cancel').addEventListener('click', () => {
    $('#btn-cancel').disabled = true;
    setState('cancelling');
    setStep('✋', 'step.cancelling');
    api.cancel();
  });
  $('#btn-play').addEventListener('click', () => {
    const r = S.result;
    if (!r) return;
    if (r.files.length > 1) api.openFolder(r.outDir); else api.openPath(r.files[0]);
  });
  $('#btn-show').addEventListener('click', () => {
    const r = S.result;
    if (!r) return;
    if (r.files.length > 1) api.openFolder(r.outDir); else api.showItem(r.files[0]);
  });
  $('#btn-new').addEventListener('click', reset);
  $('#btn-err-back').addEventListener('click', reset);
  $('#btn-retry').addEventListener('click', () => { if (S.lastWasQueue && S.queue.length) runQueue(); else startDownload(); });
  $('#btn-err-update').addEventListener('click', () => runUpdate($('#err-update-status'), $('#btn-err-update')));
  $('#btn-banner-update').addEventListener('click', async () => {
    const b = $('#btn-banner-update');
    b.disabled = true;
    $('#upd-banner-text').textContent = t('banner.progress');
    const r = await api.updateEngine();
    b.disabled = false;
    if (r.ok) {
      S.settings.pendingUpdate = '';
      $('#upd-banner-text').textContent = t('banner.done', { v: r.after || '' });
      $('#btn-banner-update').hidden = true;
      setTimeout(() => { $('#upd-banner').hidden = true; $('#btn-banner-update').hidden = false; }, 4000);
    } else {
      $('#upd-banner-text').textContent = t('banner.fail');
    }
  });
  $('#btn-idle-update').addEventListener('click', async () => {
    const b = $('#btn-idle-update');
    b.disabled = true;
    $('#idle-error-hint').textContent = t('idleupd.progress');
    const r = await api.updateEngine();
    b.disabled = false;
    $('#idle-error-hint').textContent = r.ok ? t('idleupd.ok') : t('idleupd.fail');
  });

  // ------------------------------------------------------------ réglages
  const dlg = $('#settings');
  const LIMIT_OPTS = ['', '500K', '1M', '2M', '5M', '10M'];
  const limitLabel = (v) => {
    if (!v) return t('settings.limit.none');
    const mb = v.endsWith('K') ? parseInt(v, 10) / 1000 : parseInt(v, 10);
    return `${nf1.format(mb)} ${t('unit.mbs')}`;
  };
  function fillLimit() {
    const sel = $('#limit');
    sel.innerHTML = '';
    LIMIT_OPTS.forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = limitLabel(v);
      sel.append(o);
    });
    sel.value = (S.settings && S.settings.limitRate) || '';
  }

  function renderSubsLabel() {
    const langs = String((S.settings && S.settings.subLangs) || 'fr,en,ar').split(',').map((c) => c.toUpperCase()).join(', ');
    $('#subs-langs').textContent = t('subs.langs', { langs });
  }

  function renderCookiesUi() {
    const v = S.settings.cookies || '';
    $('#cookies').value = v;
    $('#cookies-file-row').hidden = v !== 'file';
    $('#cookies-file-name').textContent = S.settings.cookiesFile ? baseName(S.settings.cookiesFile) : t('settings.cookies.nofile');
    $('#cookies-file-name').title = S.settings.cookiesFile || '';
    $('#cookies-warn').hidden = !(IS_MAC ? ['chrome', 'edge', 'brave', 'safari'] : ['chrome', 'edge', 'brave']).includes(v);
    $('#cookies-bad').hidden = true;
  }

  async function pickCookiesFile() {
    const r = await api.chooseCookiesFile();
    if (r.ok) S.settings = r.settings;
    renderCookiesUi();
    if (!r.ok && r.code === 'badfile') $('#cookies-bad').hidden = false;
    // chose "cookies.txt file" but picked nothing: go back to "None"
    if (!r.ok && S.settings.cookies === 'file' && !S.settings.cookiesFile) {
      S.settings = await api.setSettings({ cookies: '' });
      renderCookiesUi();
      if (r.code === 'badfile') $('#cookies-bad').hidden = false;
    }
  }

  const SUBLANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
  const PROXY_RE = /^(https?|socks4a?|socks5h?):\/\/(?:[^\s@/]+@)?[^\s@/:]+(?::\d{1,5})?\/?$/i;
  function markInvalid(input, helpEl, bad, badKey, helpKey) {
    input.setAttribute('aria-invalid', String(bad));
    helpEl.textContent = t(bad ? badKey : helpKey);
  }

  $('#btn-settings').addEventListener('click', async () => {
    renderCookiesUi();
    fillLimit();
    $('#sound').checked = !!S.settings.sound;
    $('#platform-theme').checked = S.settings.platformTheme !== false;
    $('#autocheck').checked = S.settings.autoCheck !== false;
    $('#jshelper').checked = S.settings.jsHelper !== false;
    $('#sublangs').value = S.settings.subLangs || 'fr,en,ar';
    $('#proxy').value = S.settings.proxy || '';
    markInvalid($('#sublangs'), $('#sublangs-help'), false, 'settings.sublangs.bad', 'settings.sublangs.help');
    markInvalid($('#proxy'), $('#proxy-help'), false, 'settings.proxy.bad', 'settings.proxy.help');
    S.themeSuspended = true;            // pendant les réglages, on montre la couleur choisie par l'utilisateur
    refreshTheme();
    renderSwatches();
    $('#upd-status').textContent = '';
    renderDest();
    dlg.showModal();
    const info = await api.getInfo();
    $('#ver').textContent = info.ytdlp || t('settings.engine.missing');
  });
  $('#cookies').addEventListener('change', async (e) => {
    S.settings = await api.setSettings({ cookies: e.target.value });
    renderCookiesUi();
    if (e.target.value === 'file' && !S.settings.cookiesFile) pickCookiesFile();
  });
  $('#btn-cookies-pick').addEventListener('click', pickCookiesFile);
  $('#btn-cookies-clear').addEventListener('click', async () => {
    S.settings = await api.clearCookiesFile();
    renderCookiesUi();
  });
  $('#limit').addEventListener('change', async (e) => { S.settings = await api.setSettings({ limitRate: e.target.value }); });
  $('#sublangs').addEventListener('change', async (e) => {
    const parts = e.target.value.split(/[\s,;]+/).filter(Boolean);
    const bad = !parts.length || parts.length > 8 || !parts.every((x) => SUBLANG_RE.test(x));
    markInvalid(e.target, $('#sublangs-help'), bad, 'settings.sublangs.bad', 'settings.sublangs.help');
    if (bad) return;
    S.settings = await api.setSettings({ subLangs: parts.join(',') });
    e.target.value = S.settings.subLangs;
    renderSubsLabel();
  });
  $('#proxy').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    const bad = v !== '' && !PROXY_RE.test(v);
    markInvalid(e.target, $('#proxy-help'), bad, 'settings.proxy.bad', 'settings.proxy.help');
    if (bad) return;
    S.settings = await api.setSettings({ proxy: v });
    e.target.value = S.settings.proxy;
  });
  $('#autocheck').addEventListener('change', async (e) => { S.settings = await api.setSettings({ autoCheck: e.target.checked }); });
  $('#jshelper').addEventListener('change', async (e) => { S.settings = await api.setSettings({ jsHelper: e.target.checked }); });
  $('#custom-color').addEventListener('input', (e) => { applyAccent(e.target.value); S.appliedHex = e.target.value; });
  $('#platform-theme').addEventListener('change', async (e) => {
    S.settings = await api.setSettings({ platformTheme: e.target.checked });
  });
  $('#custom-color').addEventListener('change', (e) => pickAccent(e.target.value));
  $('#sound').addEventListener('change', async (e) => {
    S.settings = await api.setSettings({ sound: e.target.checked });
    if (e.target.checked) { warmAudio(); chime(); }
  });
  $('#btn-upd').addEventListener('click', () => runUpdate($('#upd-status'), $('#btn-upd')));
  $('#btn-open-folder').addEventListener('click', () => api.openFolder(S.settings.folder));
  $('#btn-data').addEventListener('click', () => api.openDataFolder());

  // ------------------------------------------------------------- à propos
  const aboutDlg = $('#about');
  async function fillAbout() {
    let info = {};
    try { info = (await api.getAbout()) || {}; } catch (_) { /* on affiche des tirets */ }
    $('#about-ver').textContent = t('about.version', { v: info.appVersion || '' });
    $('#about-license').textContent = info.license || 'MIT';
    $('#about-ytdlp').textContent = info.ytdlp || '–';
    $('#about-ffmpeg').textContent = info.ffmpeg || '–';
    $('#about-electron').textContent = info.electron
      ? `${info.electron} · Chromium ${String(info.chrome || '').split('.')[0]}`
      : '–';
    $('#btn-repo').hidden = !info.repo;
    $('#btn-appupd').hidden = !info.repo;
  }
  $('#btn-about').addEventListener('click', () => {
    $('#about-status').textContent = '';
    aboutDlg.showModal();
    fillAbout();
  });
  $('#btn-licenses').addEventListener('click', async () => {
    const r = await api.openLicenses();
    $('#about-status').textContent = r ? t('about.missing') : '';
  });
  $('#btn-repo').addEventListener('click', () => api.openRepo());
  $('#btn-diag').addEventListener('click', async () => {
    await api.copyDiagnostics('');
    $('#about-status').textContent = t('about.diag.done');
  });
  $('#btn-appupd').addEventListener('click', async () => {
    const b = $('#btn-appupd');
    b.disabled = true;
    const r = await api.checkAppUpdate();
    b.disabled = false;
    if (r && r.ok && r.available) { S.appUpdate = r.latest; renderAppBanner(); }
    $('#about-status').textContent = !r || !r.ok ? t('about.update.fail')
      : (r.available ? t('about.update.new', { v: r.latest }) : t('about.update.none'));
  });
  dlg.addEventListener('close', () => {
    S.themeSuspended = false;
    refreshTheme();
    renderDest();
    if (!welcomeOpen()) urlInput.focus();
  });

  function renderAppBanner() {
    $('#app-banner').hidden = !S.appUpdate;
    if (S.appUpdate) $('#app-banner-text').textContent = t('banner.app', { v: S.appUpdate });
  }

  // --------------------------------------------------------- raccourcis clavier
  // Ctrl+V colle et analyse, Ctrl+L sélectionne la barre, Ctrl+Entrée télécharge, Ctrl+, ouvre les réglages.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (welcomeOpen() || dlg.open || aboutDlg.open) return;
    const st = app.dataset.state;
    const key = e.key.toLowerCase();
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    if (key === ',') {
      if (!$('#btn-settings').disabled) { e.preventDefault(); $('#btn-settings').click(); }
    } else if (key === 'l') {
      if (!urlInput.disabled) { e.preventDefault(); urlInput.focus(); urlInput.select(); }
    } else if (key === 'enter') {
      if (st === 'ready' && !$('#btn-download').disabled) { e.preventDefault(); startDownload(); }
    } else if (key === 'v' && !inField) {
      if (['idle', 'ready', 'done', 'error'].includes(st)) {
        e.preventDefault();
        api.readClipboard().then((txt) => {
          const raw = String(txt || '').trim();
          if (!handlePasted(raw) && raw) { urlInput.value = raw; analyze(raw); }
        });
      }
    }
  });

  // ----------------------------------------------------- écran de bienvenue
  const welcome = $('#welcome');
  const welcomeOpen = () => !welcome.hidden;

  function openWelcome() {
    welcome.classList.remove('leaving');
    welcome.hidden = false;
    $('main').inert = true;            // le clavier ne peut pas aller derrière l'écran
    $('#btn-settings').disabled = true;
    $('#btn-welcome').focus({ preventScroll: true });
  }

  function closeWelcome() {
    if (!welcomeOpen() || welcome.classList.contains('leaving')) return;
    welcome.classList.add('leaving');
    if (!S.settings.welcomeSeen) {
      S.settings.welcomeSeen = true;
      api.setSettings({ welcomeSeen: true });
    }
    setTimeout(() => {
      welcome.hidden = true;
      welcome.classList.remove('leaving');
      $('main').inert = false;
      setState(app.dataset.state);     // réactive le bouton Réglages
      urlInput.focus();
      checkClipboard();
    }, reduceMotion() ? 0 : 220);
  }

  $('#btn-welcome').addEventListener('click', closeWelcome);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && welcomeOpen()) closeWelcome(); });
  $('#btn-welcome-again').addEventListener('click', () => { dlg.close(); openWelcome(); });

  // ------------------------------------------------------ changement de langue
  /** Applique la langue à tout l'écran, y compris aux textes construits par le code. */
  function applyLang(lang) {
    LANG = LOCALES[lang] ? lang : 'en';
    const loc = LANG === 'fr' ? 'fr-FR' : 'en-US';
    nf0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
    nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
    rel = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
    document.documentElement.lang = LANG;

    $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    $$('[data-i18n-attr]').forEach((n) => {
      n.dataset.i18nAttr.split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        n.setAttribute(attr, t(key));
      });
    });
    $$('.lang-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === LANG)));

    // textes qui dépendent de l'état courant
    renderStep();
    renderBanner();
    renderAppBanner();
    if (S.settings) { renderRecents(); renderSwatches(); renderSubsLabel(); renderQueue(); fillLimit(); renderCookiesUi(); }
    if (S.info) { renderInfoText(); renderKind(); plChanged(); }
    if (S.queueRun && S.queueInfo) $('#dl-queue').textContent = t('queue.progress', S.queueInfo);
    if (!$('#idle-error').hidden && S.idleErr) showIdleError(S.idleErr);
    if (app.dataset.state === 'error' && S.err) renderErrorText();
    if (app.dataset.state === 'done') renderDone();
    $('#upd-status').textContent = '';
    $('#err-update-status').textContent = '';
    if (dlg.open) api.getInfo().then((info) => { $('#ver').textContent = info.ytdlp || t('settings.engine.missing'); });
    if (aboutDlg.open) fillAbout();
    $('#about-status').textContent = '';
  }

  $$('.lang-switch button').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.lang === LANG) return;
    S.settings = await api.setSettings({ lang: b.dataset.lang });
    applyLang(S.settings.lang);
  }));

  // --------------------------------------------------------------- départ
  async function init() {
    if (!IS_MAC) { const so = $('#cookies option[value="safari"]'); if (so) so.remove(); }
    // macOS application menu (About, Settings)
    if (api.onMenu) {
      api.onMenu((action) => {
        if (welcomeOpen()) return;
        if (action === 'settings') { if (!dlg.open && !$('#btn-settings').disabled) $('#btn-settings').click(); }
        if (action === 'about') {
          if (!dlg.open && !$('#btn-settings').disabled) $('#btn-settings').click();
          if (dlg.open && !aboutDlg.open) $('#btn-about').click();
        }
      });
    }
    try {
      LOCALES = (await api.getLocales()) || {};
      S.settings = await api.getSettings();
      applyLang(S.settings.lang);
    } finally {
      document.body.classList.remove('booting');
    }
    document.documentElement.classList.add('notrans');
    S.appliedHex = null;
    S.kind = S.settings.kind === 'audio' ? 'audio' : 'video';
    S.height = S.settings.quality || 1080;
    S.audioFormat = S.settings.audioFormat || 'mp3';
    S.container = S.settings.container === 'mkv' ? 'mkv' : 'mp4';
    S.subs = !!S.settings.subs;
    S.appUpdate = S.settings.pendingAppUpdate || '';
    renderSubsLabel();
    renderAppBanner();
    renderDest();
    renderRecents();
    setProgress(0);
    api.onProgress(onProgress);
    api.onUpdateAvailable((r) => { S.settings.pendingUpdate = r.latest; renderBanner(); });
    api.onAppUpdateAvailable((r) => { S.appUpdate = r.latest; renderAppBanner(); });
    renderBanner();
    setState('idle');
    refreshTheme();
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('notrans')));
    if (!S.settings.welcomeSeen) {
      openWelcome();                   // premier lancement : petite présentation
    } else {
      urlInput.focus();
      checkClipboard();
    }
  }

  init();
})();
