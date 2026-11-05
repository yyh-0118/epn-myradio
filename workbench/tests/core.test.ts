import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrc, parseLyrics, parseYrc, activeLineIndex, formatTime } from '../src/lib/lyrics';
import { buildApp } from '../server/app';

test('LRC timestamps, multi-tags, interleaved text and offsets', () => {
  const lines = parseLrc('[offset:-100]\n[00:01.50][00:03.25]晚风经过街巷\n[00:05.000]轻轻收藏[00:07.00]望向远方');
  assert.equal(lines.length, 4);
  assert.equal(lines[0].t, 1.4);
  assert.equal(lines[1].t, 3.15);
  assert.equal(lines[2].text, '轻轻收藏');
  assert.equal(lines[3].text, '望向远方');
  assert.deepEqual(lines.map((line) => line.id), ['line-1', 'line-2', 'line-3', 'line-4']);
});

test('YRC retains word times and verified character ranges', () => {
  const lines = parseYrc('[1000,2000](1000,1000,0)晚风(2000,1000,0)回响');
  assert.equal(lines[0].t, 1);
  assert.equal(lines[0].text, '晚风回响');
  assert.deepEqual(lines[0].words?.[1], { text: '回响', t: 2, d: 1, c0: 2, c1: 4 });
});

test('plain text is explicitly untimed; no guessed audio alignment', () => {
  const parsed = parseLyrics('  想起那天\n\n你望向远方 ');
  assert.equal(parsed.lyricSource, 'text');
  assert.deepEqual(parsed.lyrics.map((line) => line.t), [null, null]);
  assert.equal(activeLineIndex(parsed.lyrics, 20), -1);
  assert.equal(parseLyrics('   ').lyricSource, 'none');
});

test('active line preserves silence before first line', () => {
  const lines = parseLrc('[00:05.00]开始\n[00:10.00]后来');
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 8), 0);
  assert.equal(activeLineIndex(lines, 10), 1);
  assert.equal(formatTime(Number.NaN), '00:00');
  assert.equal(formatTime(125.9), '02:05');
});

test('EPN endpoint validates input and returns actual structured results', async () => {
  const app = buildApp();
  try {
    for (const payload of [{ rawLyrics: '' }, { rawLyrics: '   ' }, { rawLyrics: '好\n'.repeat(201) }, { rawLyrics: '好'.repeat(12001) }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/analysis/run', payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/analysis/run', headers: { origin: 'https://unrelated.example' }, payload: { rawLyrics: '晚风回响' } })).statusCode, 403);
    const response = await app.inject({ method: 'POST', url: '/api/analysis/run', payload: { rawLyrics: '晚风经过街巷\n心事轻轻收藏\n站台望向远方\n落日放在心上', track: { title: '演示', artist: 'Afterglow' } } });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.equal(result.lines.length, 4);
    assert.ok(result.steps.length > 5);
    assert.ok(Array.isArray(result.units));
    assert.ok(result.units.length > 0);
    assert.ok(result.metrics.energy >= 0 && result.metrics.energy <= 1);
    assert.ok(['rules', 'hybrid', 'llm-rules-fallback'].includes(result.source));
    for (const unit of result.units) {
      if (unit.start >= 0 && unit.end > unit.start) assert.equal(result.lines[unit.lineIndex].slice(unit.start, unit.end), unit.text);
    }
  } finally { await app.close(); }
});
