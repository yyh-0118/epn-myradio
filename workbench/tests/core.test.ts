import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrc, parseLyrics, parseYrc, activeLineIndex, formatTime } from '../src/lib/lyrics';
import { buildApp } from '../server/app';
import { ReviewUnavailableError, runReview } from '../server/review';
import { AskUnavailableError, runAsk } from '../server/ask';
import { TasteUnavailableError, runTaste } from '../server/taste';

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

const reviewNotes = [
  { id: 'real-1', title: '', body: '今天又听了这首，想起以前的夏天。', quote: '晚风回响', trackTitle: '歌A', artist: '甲', createdAt: '2026-11-10T20:00:00.000Z' },
  { id: 'real-2', title: '失眠', body: '半夜还在循环同一首。', quote: '', trackTitle: '歌A', artist: '甲', createdAt: '2026-11-12T01:00:00.000Z' },
];
const fakeClient = (payload: unknown, configured = true) => ({ isConfigured: configured, completeJson: async () => payload }) as never;

test('review maps note labels back to real ids and drops unsupported themes', async () => {
  const result = await runReview({ notes: reviewNotes }, fakeClient({
    overview: '你最近反复回到同一首歌。',
    themes: [
      { title: '反复听', body: '两条都提到了歌A。', noteIds: ['N1', 'n2', 'N9', 'N1'] },
      { title: '凭空', body: '没有任何依据。', noteIds: ['N7'] },
    ],
    question: '它让你想起了什么？',
  }));
  assert.deepEqual(result.themes.map((theme) => theme.noteIds), [['real-1', 'real-2']]);
  assert.equal(result.noteCount, 2);
  assert.equal(result.warnings.length, 1);
});

test('review refuses to run without a configured model and rejects empty output', async () => {
  await assert.rejects(runReview({ notes: reviewNotes }, fakeClient({}, false)), ReviewUnavailableError);
  await assert.rejects(runReview({ notes: reviewNotes }, fakeClient({ overview: '', themes: [] })), /REVIEW_EMPTY/);
});

test('review endpoint validates input and reports missing LLM config without leaking notes', async () => {
  const app = buildApp();
  try {
    for (const payload of [{ notes: [] }, { notes: [{ id: 'x', body: '', createdAt: 'now' }] }, { notes: [{ id: 'x', createdAt: 'now' }] }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/review/run', payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/review/run', headers: { origin: 'https://unrelated.example' }, payload: { notes: [reviewNotes[0]] } })).statusCode, 403);
    const response = await app.inject({ method: 'POST', url: '/api/review/run', payload: { notes: [reviewNotes[0]] } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'LLM_NOT_CONFIGURED');
    assert.ok(!response.body.includes('想起以前的夏天'));
  } finally { await app.close(); }
});

const askInput = { track: { title: '歌A', artist: '甲' }, quote: '晚风回响', context: ['前一句', '晚风回响', '后一句'], draft: '', earlier: [{ body: '去年夏天也听过。', createdAt: '2026-06-01T00:00:00.000Z' }] };

test('ask returns one trimmed question and fails clearly when unavailable', async () => {
  const result = await runAsk(askInput, fakeClient({ question: '  “这句让你想起了谁？”  ' }));
  assert.equal(result.question, '这句让你想起了谁？');
  await assert.rejects(runAsk(askInput, fakeClient({ question: '' })), /ASK_EMPTY/);
  await assert.rejects(runAsk(askInput, fakeClient({}, false)), AskUnavailableError);
});

test('ask endpoint validates input and does not echo notes when the model is not configured', async () => {
  const app = buildApp();
  try {
    for (const payload of [{}, { track: {} }, { track: { title: '歌A' }, draft: '好'.repeat(3001) }, { track: { title: '歌A' }, context: ['一', '二', '三', '四', '五', '六', '七'] }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/ask/run', payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/ask/run', headers: { origin: 'https://unrelated.example' }, payload: askInput })).statusCode, 403);
    const response = await app.inject({ method: 'POST', url: '/api/ask/run', payload: { ...askInput, draft: '私人草稿内容' } });
    assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes('私人草稿内容'));
  } finally { await app.close(); }
});

const tasteInput = { totalMinutes: 320, sessions: 40, topSongs: [{ name: '歌A', artist: '甲', plays: 12, minutes: 50 }], topArtists: [{ name: '甲', plays: 12, minutes: 50 }], byHour: Array.from({ length: 24 }, (_, hour) => (hour === 23 ? 90 : 0)), last14Days: [{ date: '2026-11-16', minutes: 30 }], recent: [{ name: '歌A', artist: '甲', at: '2026-11-16T23:10', listenMin: 4, completed: true }] };

test('taste returns a bounded summary and fails clearly when unavailable', async () => {
  const result = await runTaste(tasteInput, fakeClient({ summary: '你最近常在深夜听同一位歌手。', points: [{ title: '深夜', body: '23 点最集中。' }, { title: '', body: 'x' }], hint: '' }));
  assert.equal(result.points.length, 1);
  await assert.rejects(runTaste(tasteInput, fakeClient({ summary: '', points: [] })), /TASTE_EMPTY/);
  await assert.rejects(runTaste(tasteInput, fakeClient({}, false)), TasteUnavailableError);
});

test('taste endpoint validates input and reports missing LLM config', async () => {
  const app = buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/taste/run', payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/taste/run', payload: { ...tasteInput, byHour: [1, 2] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/taste/run', headers: { origin: 'https://unrelated.example' }, payload: tasteInput })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/taste/run', payload: tasteInput })).statusCode, 503);
  } finally { await app.close(); }
});
