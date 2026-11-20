'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'js', 'modules', '05-playback', '02b-listen-insights.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = sandbox;
const plain = (value) => JSON.parse(JSON.stringify(value));

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('night hours run from 23:00 to 04:59 and the small hours belong to the previous night', () => {
  assert.deepStrictEqual(plain([22, 23, 0, 4, 5].map(api.listenIsNightHour)), [false, true, true, true, false]);
  assert.strictEqual(api.listenNightKey(at(2026, 11, 13, 23, 30)), '2026-11-13');
  assert.strictEqual(api.listenNightKey(at(2026, 11, 14, 1, 10)), '2026-11-13');
  assert.strictEqual(api.listenNightKey(at(2026, 11, 14, 4, 59)), '2026-11-13');
});

test('a song only counts as repeated at night after two different nights, not two plays in one night', () => {
  const song = { key: 'song:1', name: '歌A', artist: '甲', plays: 0, listenMs: 0 };
  api.listenRecordNight(song, at(2026, 11, 13, 23, 30), 200000);
  api.listenRecordNight(song, at(2026, 11, 14, 0, 40), 180000);
  assert.strictEqual(song.night, 2);
  assert.strictEqual(song.nightDays, 1);
  assert.deepStrictEqual(plain(api.listenNightSongs([song])), []);
  api.listenRecordNight(song, at(2026, 11, 16, 23, 5), 200000);
  assert.strictEqual(song.nightDays, 2);
  const [first] = api.listenNightSongs([song]);
  assert.strictEqual(first.nightDays, 2);
  assert.strictEqual(first.nights, 3);
  assert.strictEqual(first.minutes, Math.round(580000 / 60000));
});

test('daytime listens and bad timestamps leave the night counters untouched', () => {
  const song = { key: 'song:2' };
  api.listenRecordNight(song, at(2026, 11, 13, 14), 100000);
  api.listenRecordNight(song, 0, 100000);
  api.listenRecordNight(song, NaN, 100000);
  assert.strictEqual(song.night, undefined);
  assert.strictEqual(song.nightDays, undefined);
});

test('night songs are ranked by distinct nights, then plays', () => {
  const list = api.listenNightSongs([
    { key: 'a', name: 'A', nightDays: 2, night: 9, nightMs: 1 },
    { key: 'b', name: 'B', nightDays: 4, night: 4, nightMs: 1 },
    { key: 'c', name: 'C', nightDays: 4, night: 6, nightMs: 1 },
    { key: 'd', name: 'D', nightDays: 1, night: 30, nightMs: 1 },
  ]);
  assert.deepStrictEqual(plain(list.map((item) => item.name)), ['C', 'B', 'A']);
});

test('ask lines written by the question helper are not counted as the user\'s own notes', () => {
  assert.strictEqual(api.listenNoteText('> 这句让你想起了谁？\n\n问：旧版的问题\n今晚又听了一遍。'), '今晚又听了一遍。');
  const index = api.listenNoteIndex([
    { trackId: 'song:1', trackTitle: '歌A', artist: '甲', body: '> 只有 AI 的提问', updatedAt: '2026-11-01T00:00:00.000Z' },
    { trackId: 'song:1', body: '写了点什么', updatedAt: '2026-11-02T00:00:00.000Z' },
    { trackId: 'song:2', trackTitle: '歌B', body: '也写了', updatedAt: '2026-11-03T00:00:00.000Z' },
    { trackId: '', body: '没有曲目' },
  ]);
  assert.strictEqual(index['song:1'].notes, 1);
  assert.strictEqual(index['song:2'].notes, 1);
  assert.strictEqual(Object.keys(index).length, 2);
});

test('write-versus-listen finds the most written songs and the often-played ones never written about', () => {
  const songs = [
    { key: 'song:1', name: '歌A', artist: '甲', plays: 12, listenMs: 3600000 },
    { key: 'song:2', name: '歌B', artist: '乙', plays: 8, listenMs: 1200000 },
    { key: 'song:3', name: '歌C', artist: '丙', plays: 2, listenMs: 300000 },
  ];
  const moments = [
    { trackId: 'song:2', trackTitle: '歌B', body: '一', updatedAt: '2026-11-01' },
    { trackId: 'song:2', body: '二', updatedAt: '2026-11-02' },
    { trackId: 'song:9', trackTitle: '只写过没听统计', artist: '丁', body: '三', updatedAt: '2026-11-03' },
  ];
  const result = api.listenWriteVsListen(songs, api.listenNoteIndex(moments));
  assert.strictEqual(result.totalNotes, 3);
  assert.deepStrictEqual(plain(result.mostWritten.map((item) => [item.name, item.notes, item.plays])), [['歌B', 2, 8], ['只写过没听统计', 1, 0]]);
  assert.deepStrictEqual(plain(result.listenedNotWritten.map((item) => item.name)), ['歌A']);
});
