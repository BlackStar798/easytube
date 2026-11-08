#!/usr/bin/env node
'use strict';
/**
 * Checks the translation files:
 *   1. en.json and fr.json have exactly the same keys, none empty
 *   2. both use the same {placeholders}
 *   3. every key used in renderer/index.html (data-i18n, data-i18n-attr) and in
 *      renderer/app.js (t('key')) and main.js (tm('key')) exists
 *   4. warns about keys that are never used (they may be built dynamically)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const en = JSON.parse(read('locales/en.json'));
const fr = JSON.parse(read('locales/fr.json'));
const errors = [];
const warnings = [];

const kEn = Object.keys(en);
const kFr = new Set(Object.keys(fr));
for (const k of kEn) if (!kFr.has(k)) errors.push(`missing in fr.json: ${k}`);
for (const k of kFr) if (!(k in en)) errors.push(`missing in en.json: ${k}`);
for (const [lang, d] of [['en', en], ['fr', fr]]) {
  for (const [k, v] of Object.entries(d)) if (typeof v !== 'string' || !v.trim()) errors.push(`${lang}.json: empty value for ${k}`);
}
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of kEn) if (k in fr && ph(en[k]) !== ph(fr[k])) errors.push(`placeholders differ for ${k}: en {${ph(en[k])}} vs fr {${ph(fr[k])}}`);

const used = new Set();
const html = read('renderer/index.html');
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
  m[1].split(';').forEach((pair) => { const key = pair.split(':')[1]; if (key) used.add(key.trim()); });
}
for (const f of ['renderer/app.js', 'main.js']) {
  for (const m of read(f).matchAll(/\bt[m]?\(\s*'([\w.]+)'/g)) used.add(m[1]);
}
for (const k of used) if (!(k in en)) errors.push(`used in the code but not defined: ${k}`);
const dynamic = /^(swatch\.|err\.|site\.|kind\.|q\.)/;
for (const k of kEn) if (!used.has(k) && !dynamic.test(k)) warnings.push(`never used (maybe built dynamically): ${k}`);

if (process.argv.includes('--verbose')) warnings.forEach((w) => console.log(`warning: ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`error: ${e}`));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`Locales OK: ${kEn.length} keys in each language, ${used.size} used by the code.`);
if (warnings.length) console.log(`(${warnings.length} keys are not found as literals in the code, probably built dynamically; --verbose lists them)`);
