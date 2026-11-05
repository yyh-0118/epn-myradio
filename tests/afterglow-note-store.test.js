'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { AfterglowNoteStore } = require('../desktop/afterglow-note-store');

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))));
function createStore(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afterglow-store-'));
  roots.push(root);
  return { root, store: new AfterglowNoteStore({ userDataPath: root, ...options }) };
}
function moment(id, body = '一句话') {
  return { id, trackId: 'netease:42', trackTitle: '回声', artist: '测试', lineId: 'line-1', quote: '晚风回响', at: 12.5, capturedAt: Date.now(), title: '', body, createdAt: '2026-10-22T10:00:00.000Z', updatedAt: new Date().toISOString(), token: 'must-not-persist' };
}
function track(id = 'netease:42') {
  return { id, provider: 'netease', sourceId: '42', title: '回声', artist: '测试', duration: 180, lyricSource: 'lrc', audio: Buffer.from('secret'), url: 'https://secret.example', playbackRef: { provider: 'netease', id: '42', name: '回声', artist: '测试', audioUrl: 'https://secret.example/audio', localPath: 'C:/secret.mp3', cookie: 'secret', token: 'secret' }, lyrics: [{ id: 'line-1', text: '晚风回响', t: 12, duration: 5, secret: 'no' }] };
}

test('initializes, upserts, deletes and strips unknown sensitive fields', async () => {
  const { root, store } = createStore();
  assert.deepEqual((await store.listMoments()).moments, []);
  await store.saveTrackSnapshot(track());
  await store.saveMoment(moment('one'));
  await store.saveMoment(moment('one', '更新后的文字'));
  const result = await store.listMoments();
  assert.equal(result.moments.length, 1);
  assert.equal(result.moments[0].body, '更新后的文字');
  assert.equal('token' in result.moments[0], false);
  const tracks = (await store.listTrackSnapshots()).trackSnapshots;
  assert.equal(tracks.length, 1);
  assert.equal('audio' in tracks[0], false);
  assert.equal('url' in tracks[0], false);
  assert.equal(tracks[0].playbackRef.id, '42');
  assert.equal(tracks[0].playbackRef.provider, 'netease');
  assert.equal('audioUrl' in tracks[0].playbackRef, false);
  assert.equal('localPath' in tracks[0].playbackRef, false);
  assert.equal('cookie' in tracks[0].playbackRef, false);
  assert.equal('token' in tracks[0].playbackRef, false);
  assert.equal('secret' in tracks[0].lyrics[0], false);
  await store.deleteMoment('one');
  assert.equal((await store.listMoments()).moments.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'afterglow', 'notebook.json'), 'utf8')).schemaVersion, 1);
});

test('serializes concurrent mutations without losing notes', async () => {
  const { store } = createStore();
  await Promise.all(Array.from({ length: 40 }, (_, index) => store.saveMoment(moment(`note-${index}`))));
  assert.equal((await store.listMoments()).moments.length, 40);
});

test('recovers from a valid backup when primary is corrupt', async () => {
  const { root, store } = createStore();
  await store.saveMoment(moment('first'));
  await store.saveMoment(moment('second'));
  const directory = path.join(root, 'afterglow');
  fs.writeFileSync(path.join(directory, 'notebook.json'), '{broken', 'utf8');
  const recovered = new AfterglowNoteStore({ userDataPath: root });
  const result = await recovered.listMoments();
  assert.equal(result.recoveredFromBackup, true);
  assert.equal(result.moments.some((item) => item.id === 'first'), true);
});

test('blocks unknown higher schema and preserves original file', async () => {
  const { root } = createStore();
  const directory = path.join(root, 'afterglow');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'notebook.json');
  const original = JSON.stringify({ schemaVersion: 99, updatedAt: new Date().toISOString(), moments: [], trackSnapshots: [] });
  fs.writeFileSync(file, original);
  const store = new AfterglowNoteStore({ userDataPath: root });
  await assert.rejects(() => store.listMoments(), /UNSUPPORTED_SCHEMA_VERSION/);
  await assert.rejects(() => store.saveMoment(moment('blocked')), /UNSUPPORTED_SCHEMA_VERSION/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('rejects oversized note fields and invalid identities', async () => {
  const { store } = createStore();
  await assert.rejects(() => store.saveMoment({ ...moment(''), id: '' }), /INVALID_AFTERGLOW_DATA/);
  const result = await store.saveMoment({ ...moment('trimmed'), body: 'a'.repeat(100500) });
  assert.equal(result.moment.body.length, 100000);
});

test('exports a complete privacy-filtered archive and imports it round trip', async () => {
  const source = createStore().store;
  await source.saveTrackSnapshot(track());
  await source.saveMoment(moment('round-trip', '完整备份'));
  const archive = await source.exportNotebook();
  const serialized = JSON.stringify(archive);
  assert.equal(archive.type, 'mineradio.afterglow.notebook');
  assert.equal(serialized.includes('secret.example'), false);
  assert.equal(serialized.includes('C:/secret.mp3'), false);
  assert.equal(serialized.includes('must-not-persist'), false);

  const target = createStore().store;
  const prepared = await target.prepareImport(archive);
  assert.equal(prepared.preview.moments.added, 1);
  assert.equal(prepared.preview.tracks.added, 1);
  await target.commitImport({ token: prepared.token, strategy: 'safe' });
  assert.equal((await target.listMoments()).moments[0].body, '完整备份');
  assert.equal((await target.listTrackSnapshots()).trackSnapshots[0].playbackRef.id, '42');
});

test('previews conflicts and rejects a stale import session', async () => {
  const { store } = createStore();
  await store.saveMoment(moment('same', '本机版本'));
  const archive = await store.exportNotebook();
  archive.state.moments[0] = { ...archive.state.moments[0], body: '导入版本', updatedAt: new Date(Date.now() + 10_000).toISOString() };
  const prepared = await store.prepareImport(archive);
  assert.equal(prepared.preview.moments.incomingNewer, 1);
  await store.saveMoment(moment('other', '预览后的新变更'));
  await assert.rejects(() => store.commitImport({ token: prepared.token, strategy: 'safe' }), /AFTERGLOW_IMPORT_STALE/);
  assert.equal((await store.listMoments()).moments.some((item) => item.body === '导入版本'), false);
});

test('rejects malformed archives and duplicate identities without changing state', async () => {
  const { store } = createStore();
  await store.saveMoment(moment('safe'));
  const before = await store.exportNotebook();
  await assert.rejects(() => store.prepareImport({ type: 'unknown', state: before.state }), /INVALID_AFTERGLOW_IMPORT_TYPE/);
  await assert.rejects(() => store.prepareImport({ ...before, state: { ...before.state, moments: [before.state.moments[0], before.state.moments[0]] } }), /AFTERGLOW_IMPORT_DUPLICATE_ID/);
  assert.equal((await store.listMoments()).moments.length, 1);
});

test('rotates immutable backups and restores a selected version', async () => {
  const { store } = createStore({ maxBackups: 3 });
  for (let index = 0; index < 6; index++) await store.saveMoment(moment(`note-${index}`));
  const listed = await store.listBackups();
  assert.equal(listed.backups.length, 3);
  const oldest = listed.backups[listed.backups.length - 1];
  const beforeRestoreCount = (await store.listMoments()).moments.length;
  const restored = await store.restoreBackup({ id: oldest.id, expectedUpdatedAt: listed.currentUpdatedAt });
  assert.equal(restored.moments < beforeRestoreCount, true);
  assert.equal((await store.listBackups()).backups.length, 3);
});

test('reports recovery metadata until it is explicitly acknowledged', async () => {
  const { root, store } = createStore();
  await store.saveMoment(moment('first'));
  await store.saveMoment(moment('second'));
  fs.writeFileSync(path.join(root, 'afterglow', 'notebook.json'), '{broken', 'utf8');
  const recovered = new AfterglowNoteStore({ userDataPath: root });
  const initial = await recovered.listMoments();
  assert.equal(initial.recoveredFromBackup, true);
  assert.equal(initial.recovery.reason, 'PRIMARY_CORRUPT');
  await recovered.acknowledgeRecovery();
  assert.equal((await recovered.listMoments()).recoveredFromBackup, false);
});
