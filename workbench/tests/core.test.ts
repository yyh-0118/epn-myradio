import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrc, parseLyrics, parseYrc, activeLineIndex, formatTime } from '../src/lib/lyrics';
import { buildApp } from '../server/app';
import { ANALYSIS_TIMEOUT_MS, estimateAnalysisMaxTokens } from '../vendor/epn/server/services/AnalysisService';
import { READING_EMOTION_MAX, READING_NOTE_MAX, ReadingUnavailableError, buildReadingPrompt, normalizeReading, parseReadingLine, streamReading } from '../server/reading';
import { evidenceToLineIndexes, toBarViews, toInsightViews } from '../server/analysis-view';
import { REVIEW_DATA_DELIMITER, ReviewUnavailableError, createReviewSplitter, parseJsonObject, runReview, streamReview } from '../server/review';
import { createSseParser } from '../src/lib/sse';
import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import { ASK_MAX_CHARS, AskUnavailableError, buildAskPrompt, cleanQuestion, runAsk, streamAsk } from '../server/ask';
import { PolishUnavailableError, streamPolish } from '../server/polish';
import { DATA_DELIMITER } from '../server/stream';
import { locateInSong, stripAskLines } from '../src/lib/writing';
import { TasteUnavailableError, buildTastePrompt, runTaste, streamTaste } from '../server/taste';
import { addReviewRecord, clearReviewHistory, deleteReviewRecord, describeAgo, earlierNotesForTrack, readConsent, readReviewHistory, reviewNudge, selectReviewNotes, writeConsent, REVIEW_HISTORY_LIMIT, type KeyValueStore } from '../src/lib/review-store';
import type { Moment, ReviewRecord } from '../src/types';

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

test('review keeps only mood hints that map to real notes, one per note, with clamped tone', async () => {
  const result = await runReview({ notes: reviewNotes }, fakeClient({
    overview: '你最近反复回到同一首歌。',
    themes: [{ title: '反复听', body: '两条都提到了歌A。', noteIds: ['N1'] }],
    moods: [
      { noteId: 'N1', mood: '想念', tone: -5 },
      { noteId: 'N1', mood: '重复的', tone: 1 },
      { noteId: 'n2', mood: '平静', tone: 'x' },
      { noteId: 'N9', mood: '凭空', tone: 1 },
      { noteId: 'N2', mood: '', tone: 1 },
    ],
    question: '',
  }));
  assert.deepEqual(result.moods, [{ noteId: 'real-1', mood: '想念', tone: -1 }, { noteId: 'real-2', mood: '平静', tone: 0 }]);
  const none = await runReview({ notes: reviewNotes }, fakeClient({ overview: '少量笔记。', themes: [] }));
  assert.deepEqual(none.moods, []);
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}
const moment = (id: string, createdAt: string, body = '写了点什么', trackId = 'song-a'): Moment => ({ id, trackId, trackTitle: '歌A', artist: '甲', lineId: '', quote: '', at: 0, capturedAt: 0, title: '', body, createdAt, updatedAt: createdAt });
const record = (id: string, createdAt: string): ReviewRecord => ({ id, createdAt, rangeId: '30', rangeLabel: '最近 30 天', focus: '', refs: {}, data: { overview: '概览', themes: [], moods: [], question: '', noteCount: 1, warnings: [] } });

test('notes consent defaults to off and can be revoked', () => {
  const store = memoryStore();
  assert.equal(readConsent(store), false);
  writeConsent(true, store);
  assert.equal(readConsent(store), true);
  writeConsent(false, store);
  assert.equal(readConsent(store), false);
  assert.equal(readConsent(null), false);
});

test('review history saves newest first, is capped, and each entry can be deleted or cleared', () => {
  const store = memoryStore();
  addReviewRecord(record('a', '2026-11-01T00:00:00.000Z'), store);
  addReviewRecord(record('b', '2026-11-02T00:00:00.000Z'), store);
  assert.deepEqual(readReviewHistory(store).map((item) => item.id), ['b', 'a']);
  assert.deepEqual(deleteReviewRecord('b', store).map((item) => item.id), ['a']);
  for (let index = 0; index < REVIEW_HISTORY_LIMIT + 5; index++) addReviewRecord(record(`n${index}`, new Date(Date.UTC(2026, 0, 1 + index)).toISOString()), store);
  assert.equal(readReviewHistory(store).length, REVIEW_HISTORY_LIMIT);
  clearReviewHistory(store);
  assert.deepEqual(readReviewHistory(store), []);
  store.data.set('afterglow-review-history-v1', '{not json');
  assert.deepEqual(readReviewHistory(store), []);
  store.data.set('afterglow-review-history-v1', JSON.stringify([{ id: 'old', createdAt: '2026-01-01T00:00:00.000Z', rangeLabel: '旧', data: { overview: 'x', themes: [] } }, { bogus: true }]));
  const migrated = readReviewHistory(store);
  assert.equal(migrated.length, 1);
  assert.deepEqual(migrated[0].data.moods, []);
});

test('review nudge only fires after enough recent notes and a week without a review', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const recent = [moment('1', '2026-11-17T10:00:00.000Z'), moment('2', '2026-11-16T10:00:00.000Z'), moment('3', '2026-11-15T10:00:00.000Z')];
  assert.deepEqual(reviewNudge(recent, [], now), { recentCount: 3, daysSince: null, due: true });
  assert.equal(reviewNudge(recent.slice(0, 2), [], now).due, false);
  assert.equal(reviewNudge([...recent, moment('4', '2026-11-14T10:00:00.000Z', '   ')], [], now).recentCount, 3);
  assert.equal(reviewNudge(recent, [record('r', '2026-11-16T12:00:00.000Z')], now).due, false);
  assert.equal(reviewNudge(recent, [record('r', '2026-11-10T12:00:00.000Z')], now).due, true);
});

test('review note selection honours range, skips empty notes and reports how many were eligible', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const list = [moment('new', '2026-11-17T00:00:00.000Z'), moment('old', '2026-08-01T00:00:00.000Z'), moment('blank', '2026-11-17T00:00:00.000Z', '  ')];
  assert.deepEqual(selectReviewNotes(list, 30, now).picked.map((item) => item.id), ['new']);
  assert.equal(selectReviewNotes(list, 0, now).eligible, 2);
});

test('earlier notes for a track exclude the current note and describe time naturally', () => {
  const list = [moment('a', '2025-03-10T00:00:00.000Z'), moment('b', '2026-06-01T00:00:00.000Z'), moment('c', '2026-11-01T00:00:00.000Z', 'x', 'song-b'), moment('d', '2026-07-01T00:00:00.000Z', '  ')];
  const found = earlierNotesForTrack(list, 'song-a', 'b');
  assert.deepEqual(found.notes.map((item) => item.id), ['a']);
  assert.equal(found.total, 1);
  assert.equal(earlierNotesForTrack(list, 'song-a').total, 2);
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  assert.equal(describeAgo('2025-03-10T00:00:00.000Z', now), '去年 3 月');
  assert.equal(describeAgo('2024-05-10T00:00:00.000Z', now), '2024 年 5 月');
  assert.equal(describeAgo('2026-08-18T00:00:00.000Z', now), '3 个月前');
  assert.equal(describeAgo('2026-11-14T00:00:00.000Z', now), '4 天前');
  assert.equal(describeAgo('2026-11-18T01:00:00.000Z', now), '今天');
});

function feedChunks(text: string, size: number) { const out: string[] = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out; }

test('review splitter streams prose, holds back a split delimiter, and hands over the trailing JSON', () => {
  const full = `你最近反复回到同一首歌。\n${REVIEW_DATA_DELIMITER}\n{"themes":[]}`;
  for (const size of [1, 2, 3, 7, 50]) {
    let shown = '';
    const splitter = createReviewSplitter((text) => { shown += text; });
    for (const chunk of feedChunks(full, size)) splitter.push(chunk);
    const done = splitter.finish();
    assert.equal(shown.trim(), '你最近反复回到同一首歌。', `chunk size ${size}`);
    assert.ok(!shown.includes('==='), `delimiter leaked at size ${size}`);
    assert.equal(done.overview, '你最近反复回到同一首歌。');
    assert.deepEqual(parseJsonObject(done.data), { themes: [] });
  }
  let plain = '';
  const noDelimiter = createReviewSplitter((text) => { plain += text; });
  for (const chunk of feedChunks('只有正文，模型忘了写数据。', 4)) noDelimiter.push(chunk);
  assert.equal(noDelimiter.finish().overview, '只有正文，模型忘了写数据。');
  assert.equal(plain, '只有正文，模型忘了写数据。');
  let jsonOnly = '';
  const asJson = createReviewSplitter((text) => { jsonOnly += text; });
  for (const chunk of feedChunks('{"overview":"x","themes":[]}', 5)) asJson.push(chunk);
  assert.equal(jsonOnly, '');
  assert.equal(parseJsonObject(asJson.finish().data)?.overview, 'x');
});

test('parseJsonObject tolerates fences and rejects garbage', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseJsonObject('not json'), null);
  assert.equal(parseJsonObject('{"a":'), null);
  assert.equal(parseJsonObject('[1,2]'), null);
});

test('SSE parser handles arbitrary chunking, CRLF, comments and multi-line data', () => {
  const wire = ': ping\n\nevent: text\ndata: {"text":"你"}\n\nevent: text\r\ndata: {"text":"好"}\r\n\r\n: ping\n\nevent: done\ndata: {"ok":1}\n\n';
  for (const size of [1, 4, 9, wire.length]) {
    const parser = createSseParser();
    const got = feedChunks(wire, size).flatMap((chunk) => parser.feed(chunk));
    assert.deepEqual(got.map((message) => message.event), ['text', 'text', 'done'], `size ${size}`);
    assert.equal(JSON.parse(got[1].data).text, '好');
  }
});

const streamingClient = (chunks: string[], finishReason: string | null = 'stop') => ({
  isConfigured: true,
  streamChat: async (input: { onContent: (text: string) => void; onThinking?: () => void }) => { input.onThinking?.(); for (const chunk of chunks) input.onContent(chunk); return { finishReason }; },
}) as never;

test('streamReview emits prose first, then validated themes and moods keyed to real notes', async () => {
  const body = JSON.stringify({ themes: [{ title: '反复听', body: '两条都提到了歌A。', noteIds: ['N1', 'N9'] }, { title: '凭空', body: '无依据', noteIds: ['N7'] }], moods: [{ noteId: 'N2', mood: '失眠', tone: -1 }], question: '它让你想起了什么？' });
  const wire = `你最近反复回到同一首歌。\n${REVIEW_DATA_DELIMITER}\n${body}`;
  let text = ''; let thinking = 0;
  const result = await streamReview({ notes: reviewNotes }, { onText: (piece) => { text += piece; }, onThinking: () => { thinking++; } }, streamingClient(feedChunks(wire, 6)));
  assert.equal(text.trim(), '你最近反复回到同一首歌。');
  assert.equal(thinking, 1);
  assert.equal(result.overview, '你最近反复回到同一首歌。');
  assert.deepEqual(result.themes.map((theme) => theme.noteIds), [['real-1']]);
  assert.deepEqual(result.moods, [{ noteId: 'real-2', mood: '失眠', tone: -1 }]);
  assert.equal(result.warnings.length, 1);
});

test('streamReview keeps the prose and warns when the trailing JSON is missing or truncated', async () => {
  const cut = await streamReview({ notes: reviewNotes }, { onText: () => {} }, streamingClient([`已经写好的回顾。\n${REVIEW_DATA_DELIMITER}\n{"themes":[{"title":"x"`], 'length'));
  assert.equal(cut.overview, '已经写好的回顾。');
  assert.deepEqual(cut.themes, []);
  assert.match(cut.warnings.join(''), /截断/);
  const bare = await streamReview({ notes: reviewNotes }, { onText: () => {} }, streamingClient(['只有一段回顾。']));
  assert.equal(bare.overview, '只有一段回顾。');
  assert.match(bare.warnings.join(''), /没有解析出来/);
  await assert.rejects(streamReview({ notes: reviewNotes }, { onText: () => {} }, streamingClient([])), /REVIEW_EMPTY/);
  await assert.rejects(streamReview({ notes: reviewNotes }, { onText: () => {} }, fakeClient({}, false)), ReviewUnavailableError);
});

test('streaming endpoint validates input and reports missing LLM config as an SSE error event', async () => {
  const app = buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/review/stream', payload: { notes: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/review/stream', headers: { origin: 'https://unrelated.example' }, payload: { notes: [reviewNotes[0]] } })).statusCode, 403);
    const response = await app.inject({ method: 'POST', url: '/api/review/stream', payload: { notes: [reviewNotes[0]] } });
    assert.match(response.body, /event: error/);
    assert.match(response.body, /LLM_NOT_CONFIGURED/);
    assert.ok(!response.body.includes('想起以前的夏天'));
  } finally { await app.close(); }
});

test('DeepSeekClient.streamChat reports thinking, streams content, and gives up only after an idle gap', async () => {
  const original = globalThis.fetch;
  const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const encoder = new TextEncoder();
  const { serverEnv } = await import('../vendor/epn/server/config/env');
  const saved = { url: serverEnv.llmApiUrl, model: serverEnv.llmModel };
  try {
    Object.assign(serverEnv, { llmApiUrl: 'https://llm.invalid/v1/chat/completions', llmModel: 'm' });
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        for (const delta of [{ reasoning_content: '想' }, { reasoning_content: '想' }, { content: '你' }, { content: '好' }]) controller.enqueue(encoder.encode(sse({ choices: [{ delta }] })));
        controller.enqueue(encoder.encode(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })));
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
      },
    }), { status: 200 })) as typeof fetch;
    const client = new DeepSeekClient();
    let text = ''; let thinking = 0;
    const done = await client.streamChat({ messages: [], onContent: (piece) => { text += piece; }, onThinking: () => { thinking++; } });
    assert.equal(text, '你好'); assert.equal(thinking, 1); assert.equal(done.finishReason, 'stop');

    globalThis.fetch = ((_url: unknown, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason)); },
    }), { status: 200 }))) as typeof fetch;
    await assert.rejects(client.streamChat({ messages: [], idleTimeoutMs: 80, onContent: () => {} }), /长时间没有返回/);
  } finally { globalThis.fetch = original; Object.assign(serverEnv, { llmApiUrl: saved.url, llmModel: saved.model }); }
});

test('stripAskLines drops only the AI question lines; locateInSong gives a rough place in the song', () => {
  assert.equal(stripAskLines('问：它让你想起谁？\n\n昨晚又听了一遍。\n  问: 为什么是现在？\n很想她。'), '昨晚又听了一遍。\n\n很想她。');
  assert.equal(stripAskLines('我问：你好吗'), '我问：你好吗');
  assert.equal(stripAskLines('问：只有问题'), '');
  assert.equal(stripAskLines('> 这句让你想起了谁？\n\n昨晚又听了一遍。\n> 为什么是现在？\n很想她。'), '昨晚又听了一遍。\n\n很想她。');
  assert.equal(stripAskLines('昨晚听了 > 三遍'), '昨晚听了 > 三遍');
  const line = (id: string, t: number, text: string) => ({ id, t, text }) as never;
  const lines = [line('1', 20, '第一句歌词在这里'), line('2', 30, '第二句歌词在这里'), line('3', 60, '重复的副歌句子'), line('4', 90, '另一句歌词内容'), line('5', 120, '重复的副歌句子')];
  assert.equal(locateInSong(5, 200, lines).section, '前奏');
  assert.equal(locateInSong(61, 200, lines).section, '副歌');
  assert.equal(locateInSong(35, 200, lines).section, '主歌');
  assert.equal(locateInSong(198, 200, lines).section, '尾声');
  assert.deepEqual(locateInSong(12.6, 0, lines), { seconds: 13, section: '' });
});

test('streamAsk streams one short question, strips the leading label and caps the length', async () => {
  let text = '';
  const result = await streamAsk(askInput, { onText: (piece) => { text += piece; } }, streamingClient(['问：', '这句让你', '想起了谁？\n多余的第二行']));
  assert.equal(result.question, '这句让你想起了谁？');
  assert.equal(text, '这句让你想起了谁？');
  assert.equal(cleanQuestion('好'.repeat(80)).length, ASK_MAX_CHARS);
  await assert.rejects(streamAsk(askInput, { onText: () => {} }, streamingClient([])), /ASK_EMPTY/);
  await assert.rejects(streamAsk(askInput, { onText: () => {} }, fakeClient({}, false)), AskUnavailableError);
});

test('ask prompt carries the position in the song', () => {
  assert.match(buildAskPrompt({ ...askInput, position: { seconds: 75, section: '副歌' } }), /1 分 15 秒|75|副歌/);
});

test('streamTaste streams the impression first and validates trailing points', async () => {
  const wire = `你最近常在深夜听同一位歌手。\n${DATA_DELIMITER}\n${JSON.stringify({ points: [{ title: '深夜', body: '23 点最集中。' }, { title: '', body: 'x' }], hint: '' })}`;
  let text = '';
  const result = await streamTaste(tasteInput, { onText: (piece) => { text += piece; } }, streamingClient(feedChunks(wire, 5)));
  assert.equal(text.trim(), '你最近常在深夜听同一位歌手。');
  assert.equal(result.summary, '你最近常在深夜听同一位歌手。');
  assert.equal(result.points.length, 1);
  const bare = await streamTaste(tasteInput, { onText: () => {} }, streamingClient(['只有印象。']));
  assert.equal(bare.points.length, 0);
  assert.ok(bare.warnings.length >= 1);
  await assert.rejects(streamTaste(tasteInput, { onText: () => {} }, fakeClient({}, false)), TasteUnavailableError);
});

const polishDraft = '昨晚又把这首歌听了一遍。\n问：它让你想起谁？\n想起她走的那天，站台很冷，我没有说话。';

test('streamPolish streams the organised paragraph, cleans decoration and warns when it grows', async () => {
  let text = '';
  const result = await streamPolish({ track: { title: '歌A', artist: '甲' }, quote: '晚风回响', draft: polishDraft }, { onText: (piece) => { text += piece; } },
    streamingClient(['“昨晚又把这首歌听了一遍，', '想起她走的那天，站台很冷，我没有说话。”']));
  assert.equal(result.text, '昨晚又把这首歌听了一遍，想起她走的那天，站台很冷，我没有说话。');
  assert.equal(text.includes('“'), false);
  assert.deepEqual(result.warnings, []);
  const grown = await streamPolish({ track: { title: '歌A', artist: '' }, quote: '', draft: polishDraft }, { onText: () => {} }, streamingClient(['好'.repeat(200)]));
  assert.match(grown.warnings.join(''), /比原文长/);
  const cut = await streamPolish({ track: { title: '歌A', artist: '' }, quote: '', draft: polishDraft }, { onText: () => {} }, streamingClient(['整理到一半'], 'length'));
  assert.match(cut.warnings.join(''), /截断/);
});

test('streamPolish refuses drafts that are too short once the question lines are removed', async () => {
  await assert.rejects(streamPolish({ track: { title: '歌A', artist: '' }, quote: '', draft: '问：这是一个很长很长很长很长很长很长的问题吗？\n好' }, { onText: () => {} }, streamingClient(['x'])), /POLISH_TOO_SHORT/);
  await assert.rejects(streamPolish({ track: { title: '歌A', artist: '' }, quote: '', draft: polishDraft }, { onText: () => {} }, fakeClient({}, false)), PolishUnavailableError);
  await assert.rejects(streamPolish({ track: { title: '歌A', artist: '' }, quote: '', draft: polishDraft }, { onText: () => {} }, streamingClient([])), /POLISH_EMPTY/);
});

test('ask, taste and polish streaming endpoints validate input and report missing LLM config as SSE errors', async () => {
  const app = buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/ask/stream', payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/taste/stream', payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/polish/stream', payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/polish/stream', payload: { track: { title: '歌A' }, draft: '好'.repeat(3001) } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/polish/stream', headers: { origin: 'https://unrelated.example' }, payload: { track: { title: '歌A' }, draft: polishDraft } })).statusCode, 403);
    const ask = await app.inject({ method: 'POST', url: '/api/ask/stream', payload: { ...askInput, draft: '私人草稿内容' } });
    assert.match(ask.body, /LLM_NOT_CONFIGURED/);
    assert.ok(!ask.body.includes('私人草稿内容'));
    assert.match((await app.inject({ method: 'POST', url: '/api/taste/stream', payload: tasteInput })).body, /LLM_NOT_CONFIGURED/);
    const polish = await app.inject({ method: 'POST', url: '/api/polish/stream', payload: { track: { title: '歌A', artist: '' }, quote: '', draft: polishDraft } });
    assert.match(polish.body, /LLM_NOT_CONFIGURED/);
    assert.ok(!polish.body.includes('站台很冷'));
  } finally { await app.close(); }
});

test('taste prompt adds night songs and note counts only when provided, and never carries note text', () => {
  const plain = buildTastePrompt(tasteInput);
  assert.ok(!plain.includes('深夜（23 点') && !plain.includes('笔记'));
  const rich = buildTastePrompt({
    ...tasteInput,
    nightSongs: [{ name: '歌A', artist: '甲', nightDays: 3, nights: 5, minutes: 20, plays: 9 }],
    notes: { totalNotes: 4, mostWritten: [{ name: '歌B', artist: '乙', notes: 3, plays: 8, minutes: 30 }], listenedNotWritten: [{ name: '歌A', artist: '甲', plays: 9, minutes: 40 }] },
  });
  assert.match(rich, /3 个夜晚\/5 次/);
  assert.match(rich, /写得最多的歌：歌B - 乙（3 条笔记\/听了 8 次）/);
  assert.match(rich, /常听但一条没写过：歌A - 甲（9 次）/);
});

test('taste endpoint accepts the optional night and note summaries but rejects stray fields in notes', async () => {
  const app = buildApp();
  try {
    const notes = { totalNotes: 1, mostWritten: [{ name: '歌B', notes: 1 }], listenedNotWritten: [] };
    const ok = await app.inject({ method: 'POST', url: '/api/taste/stream', payload: { ...tasteInput, nightSongs: [{ name: '歌A', nightDays: 2 }], notes } });
    assert.match(ok.body, /LLM_NOT_CONFIGURED/);
    const bad = await app.inject({ method: 'POST', url: '/api/taste/stream', payload: { ...tasteInput, notes: { ...notes, body: '私人笔记正文' } } });
    assert.ok(bad.statusCode === 400 || !bad.body.includes('私人笔记正文'));
  } finally { await app.close(); }
});

test('analysis view only exposes model-written line text, clamps it, and maps evidence to real line indexes', () => {
  const bars = [{ energy: 0.4, tension: 0.2, emotion: '  怅然  ', annotations: ['  回头看，已经走远了。  '] }, { energy: 0.1, tension: 0.9 }, { energy: 0.5, tension: 0.5, emotion: '好'.repeat(30), annotations: ['长'.repeat(200)] }];
  const shown = toBarViews(bars, true);
  assert.deepEqual(shown[0], { energy: 0.4, tension: 0.2, emotion: '怅然', note: '回头看，已经走远了。' });
  assert.deepEqual(shown[1], { energy: 0.1, tension: 0.9 });
  assert.equal(shown[2].emotion?.length, 12);
  assert.equal(shown[2].note?.length, 80);
  assert.deepEqual(toBarViews(bars, false).map((bar) => Object.keys(bar).sort()), [['energy', 'tension'], ['energy', 'tension'], ['energy', 'tension']]);
  assert.deepEqual(evidenceToLineIndexes(['line-3', 'line-1', 'line-3', 'line-99', 'line-0', 'x', 7], 5), [0, 2]);
  assert.deepEqual(toInsightViews([{ title: '甲', body: '乙', evidenceIds: ['line-2'] }, { title: '丙', body: '丁', evidenceIds: ['line-99'] }], 3), [{ title: '甲', body: '乙', evidence: [1] }, { title: '丙', body: '丁' }]);
});

test('reading lines parse strictly: out-of-range, malformed and duplicate rows are dropped, text is clamped', () => {
  assert.deepEqual(parseReadingLine('3|怅然|像是在说那个人已经走远了', 5), { index: 2, emotion: '怅然', note: '像是在说那个人已经走远了' });
  assert.deepEqual(parseReadingLine('- 1｜克制｜“话没有说出口”', 5), { index: 0, emotion: '克制', note: '话没有说出口' });
  assert.equal(parseReadingLine('9|怅然|越界', 5), null);
  assert.equal(parseReadingLine('0|怅然|越界', 5), null);
  assert.equal(parseReadingLine('这一句很好', 5), null);
  assert.equal(parseReadingLine('2||没有情绪词', 5), null);
  assert.equal(parseReadingLine(`2|${'好'.repeat(30)}|解读`, 5), null);
  assert.equal(parseReadingLine(`2|${'好'.repeat(12)}|${'长'.repeat(200)}`, 5)?.emotion.length, READING_EMOTION_MAX);
  assert.equal(parseReadingLine(`2|怅然|${'长'.repeat(200)}`, 5)?.note.length, READING_NOTE_MAX);
  const prose = '2|怅然|一\n2|重复|重复的\n1|平静|二\nxx\n7|越界|丢掉';
  const result = normalizeReading(prose, '{"insights":[{"title":"离别","body":"整首都在告别。","lines":[2,2,9,1]},{"title":"","body":"空标题"}]}', 3);
  assert.deepEqual(result.lines.map((item) => item.index), [0, 1]);
  assert.deepEqual(result.insights, [{ title: '离别', body: '整首都在告别。', lines: [0, 1] }]);
  assert.throws(() => normalizeReading('没有任何有效行', '', 3), /READING_EMPTY/);
});

test('streamReading streams only the reading rows, keeps going without trailing JSON, and flags truncation', async () => {
  const wire = `2|怅然|像是在回头看\n4|克制|话留在了心里\n${DATA_DELIMITER}\n{"insights":[{"title":"离别","body":"整首都在告别。","lines":[2,4]}]}`;
  let text = '';
  const full = await streamReading({ track: { title: '歌A', artist: '甲' }, lines: ['一', '二', '三', '四'] }, { onText: (piece) => { text += piece; } }, streamingClient(feedChunks(wire, 7)));
  assert.equal(text.includes(DATA_DELIMITER), false);
  assert.deepEqual(full.lines.map((item) => item.index), [1, 3]);
  assert.deepEqual(full.insights[0].lines, [1, 3]);
  assert.deepEqual(full.warnings, []);
  const bare = await streamReading({ track: { title: '歌A', artist: '' }, lines: ['一', '二'] }, { onText: () => {} }, streamingClient(['1|平静|只有解读行']));
  assert.equal(bare.insights.length, 0);
  assert.match(bare.warnings.join(''), /没有生成/);
  const cut = await streamReading({ track: { title: '歌A', artist: '' }, lines: ['一', '二'] }, { onText: () => {} }, streamingClient(['1|平静|解读到一半'], 'length'));
  assert.match(cut.warnings.join(''), /截断/);
  await assert.rejects(streamReading({ track: { title: '歌A', artist: '' }, lines: ['一'] }, { onText: () => {} }, streamingClient([])), /READING_EMPTY/);
  await assert.rejects(streamReading({ track: { title: '歌A', artist: '' }, lines: ['一'] }, { onText: () => {} }, fakeClient({}, false)), ReadingUnavailableError);
});

test('reading prompt numbers the lyrics so the model can refer to them', () => {
  assert.match(buildReadingPrompt({ track: { title: '歌A', artist: '甲' }, lines: ['第一句', '第二句'] }), /歌曲：《歌A》 - 甲[\s\S]*1\. 第一句\n2\. 第二句/);
});

test('reading endpoint validates input, caps lyric size, and reports a missing model without echoing lyrics', async () => {
  const app = buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', payload: { lines: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', payload: { lines: ['好'.repeat(201)] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', payload: { lines: Array.from({ length: 201 }, () => '好') } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', payload: { lines: Array.from({ length: 70 }, () => '好'.repeat(190)) } })).statusCode, 413);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reading/stream', headers: { origin: 'https://unrelated.example' }, payload: { lines: ['晚风'] } })).statusCode, 403);
    const response = await app.inject({ method: 'POST', url: '/api/reading/stream', payload: { track: { title: '歌A' }, lines: ['独特的一句歌词'] } });
    assert.match(response.body, /LLM_NOT_CONFIGURED/);
    assert.ok(!response.body.includes('独特的一句歌词'));
  } finally { await app.close(); }
});

test('analysis output budget scales with lyric length so long songs are not truncated into the rules fallback', () => {
  assert.equal(estimateAnalysisMaxTokens(3, 2400), 3400);
  assert.ok(estimateAnalysisMaxTokens(22, 2400) >= 7700 + 800);
  assert.equal(estimateAnalysisMaxTokens(500, 2400), 16000);
  assert.equal(estimateAnalysisMaxTokens(1, 20000), 20000);
  assert.equal(estimateAnalysisMaxTokens(0, 2400), 2800);
  assert.ok(ANALYSIS_TIMEOUT_MS > 45_000);
});
