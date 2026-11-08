'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProgressParser } = require('../lib/engine');

const P = (st, d, t, fid, item = 1, items = 1) => ['PROG', st, d, t, 'NA', 1e6, 2, 'NA', 'NA', item, items, fid].join('|');

function run(lines) {
  const events = [];
  const p = new ProgressParser((e) => events.push({ ...e }));
  lines.forEach((l) => p.feed(l));
  return { events, parser: p };
}

test('video + audio: the bar never goes backwards and stays under 100 %', () => {
  const { events } = run([
    'TITLE|Hello', 'FMT|399+251',
    P('downloading', 0, 100, '399'), P('downloading', 50, 100, '399'), P('finished', 100, 100, '399'),
    P('downloading', 1, 10, '251'), P('finished', 10, 10, '251'),
  ]);
  const pcts = events.map((e) => e.pct);
  for (let i = 1; i < pcts.length; i += 1) assert.ok(pcts[i] >= pcts[i - 1], `step ${i}: ${pcts}`);
  assert.ok(Math.max(...pcts) <= 99);
  assert.ok(pcts.includes(45), 'half of the picture = 45 %');
  assert.equal(events[0].title, 'Hello');
});

test('a single stream uses the whole bar', () => {
  const { events } = run(['FMT|18', P('downloading', 50, 100, '18'), P('finished', 100, 100, '18')]);
  assert.equal(events[0].pct, 50);
  assert.equal(events[events.length - 1].pct, 99);
});

test('subtitle files (no format id) are ignored by the bar', () => {
  const { events } = run(['FMT|18', P('downloading', 50, 100, '18'), P('finished', 5, 5, 'NA'), P('finished', 5, 5, '')]);
  assert.equal(events.length, 1);
});

test('playlist: the bar covers all items', () => {
  const { events } = run(['FMT|18', P('finished', 100, 100, '18', 1, 4), P('downloading', 50, 100, '18', 2, 4)]);
  assert.equal(events[0].pct, 25);
  assert.equal(events[1].item, 2);
  assert.equal(events[1].items, 4);
  assert.equal(events[1].pct, 37.5);
});

test('post-processing phases', () => {
  const phases = ['Merger', 'ExtractAudio', 'EmbedThumbnail', 'EmbedSubtitle', 'Metadata'].map((pp) => run([`POST|started|${pp}`]).events[0].phase);
  assert.deepEqual(phases, ['merge', 'audio', 'cover', 'subs', 'final']);
});

test('final files are collected; junk lines are ignored', () => {
  const { parser, events } = run(['FILE|C:\\Out\\a.mp4', 'FILE|C:\\Out\\b.mp4', '', 'random text', 'TITLE|NA', 'POST|finished|Merger']);
  assert.deepEqual(parser.files, ['C:\\Out\\a.mp4', 'C:\\Out\\b.mp4']);
  assert.equal(events.length, 0);
});

test('long titles are cut', () => {
  const { events } = run([`TITLE|${'x'.repeat(1000)}`]);
  assert.equal(events[0].title.length, 300);
});
