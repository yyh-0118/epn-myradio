'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const EXPORT_TYPE = 'mineradio.afterglow.notebook';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MOMENTS = 20000;
const MAX_TRACKS = 5000;
const MAX_BACKUPS = 5;
const IMPORT_SESSION_MS = 15 * 60 * 1000;

function storeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function string(value, max, required = false) {
  const result = String(value == null ? '' : value).slice(0, max);
  if (required && !result) throw storeError('INVALID_AFTERGLOW_DATA');
  return result;
}

function finite(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw storeError('INVALID_AFTERGLOW_DATA');
  return date.toISOString();
}

function normalizeMoment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storeError('INVALID_AFTERGLOW_MOMENT');
  return {
    id: string(input.id, 256, true),
    trackId: string(input.trackId, 512, true),
    trackTitle: string(input.trackTitle, 500),
    artist: string(input.artist, 500),
    lineId: string(input.lineId, 256),
    quote: string(input.quote, 20000),
    at: Math.max(0, finite(input.at)),
    capturedAt: Math.max(0, finite(input.capturedAt, Date.now())),
    title: string(input.title, 120),
    body: string(input.body, 100000),
    createdAt: iso(input.createdAt),
    updatedAt: iso(input.updatedAt),
  };
}

function normalizeWord(input) {
  if (!input || typeof input !== 'object') throw storeError('INVALID_AFTERGLOW_TRACK');
  return {
    text: string(input.text, 1000),
    t: Math.max(0, finite(input.t)),
    d: Math.max(0, finite(input.d)),
    c0: Math.max(0, Math.floor(finite(input.c0))),
    c1: Math.max(0, Math.floor(finite(input.c1))),
  };
}

function normalizeLine(input, index) {
  if (!input || typeof input !== 'object') throw storeError('INVALID_AFTERGLOW_TRACK');
  const line = {
    id: string(input.id || `line-${index + 1}`, 256, true),
    text: string(input.text, 20000),
    t: input.t == null ? null : Math.max(0, finite(input.t)),
  };
  if (input.duration != null) line.duration = Math.max(0, finite(input.duration));
  if (Array.isArray(input.words)) line.words = input.words.slice(0, 500).map(normalizeWord);
  return line;
}

function normalizePlaybackRef(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const output = {};
  const strings = ['provider', 'source', 'type', 'mid', 'songmid', 'mediaMid', 'qqId', 'spotifyId', 'spotifyUri', 'uri', 'hash', 'fileHash', 'audioHash', 'albumMid', 'hqHash', 'sqHash', 'resHash', 'localKey', 'localFileId', 'name', 'title', 'artist', 'album'];
  const identifiers = ['id', 'albumId', 'albumAudioId', 'mixSongId', 'providerSongId', 'programId', 'radioId'];
  const numbers = ['duration', 'durationMs', 'dt', 'fee'];
  for (const key of strings) { const value = string(input[key], key === 'name' || key === 'title' || key === 'artist' || key === 'album' ? 500 : 512); if (value) output[key] = value; }
  for (const key of identifiers) if (input[key] != null && input[key] !== '') output[key] = string(input[key], 512);
  for (const key of numbers) if (input[key] != null) output[key] = Math.max(0, finite(input[key]));
  if (typeof input.playable === 'boolean') output.playable = input.playable;
  return Object.keys(output).length ? output : undefined;
}

function normalizeTrack(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storeError('INVALID_AFTERGLOW_TRACK');
  const source = ['demo', 'lrc', 'yrc', 'text', 'none'].includes(input.lyricSource) ? input.lyricSource : 'none';
  const track = {
    id: string(input.id, 512, true),
    provider: string(input.provider, 80),
    sourceId: string(input.sourceId, 512),
    title: string(input.title, 500),
    artist: string(input.artist, 500),
    duration: Math.max(0, finite(input.duration)),
    lyricSource: source,
    lyrics: Array.isArray(input.lyrics) ? input.lyrics.slice(0, 1000).map(normalizeLine) : [],
  };
  const playbackRef = normalizePlaybackRef(input.playbackRef);
  if (playbackRef) track.playbackRef = playbackRef;
  return track;
}

function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storeError('INVALID_AFTERGLOW_STORE');
  if (Number(input.schemaVersion) > SCHEMA_VERSION) throw storeError('UNSUPPORTED_SCHEMA_VERSION');
  if (Number(input.schemaVersion) !== SCHEMA_VERSION) throw storeError('INVALID_AFTERGLOW_STORE');
  const moments = Array.isArray(input.moments) ? input.moments.slice(0, MAX_MOMENTS).map(normalizeMoment) : [];
  const trackSnapshots = Array.isArray(input.trackSnapshots) ? input.trackSnapshots.slice(0, MAX_TRACKS).map(normalizeTrack) : [];
  return { schemaVersion: SCHEMA_VERSION, updatedAt: iso(input.updatedAt), moments, trackSnapshots };
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date(0).toISOString(), moments: [], trackSnapshots: [] };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function strictImportState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storeError('INVALID_AFTERGLOW_IMPORT');
  let state = input;
  if ('type' in input || 'state' in input) {
    if (input.type !== EXPORT_TYPE || !input.state || typeof input.state !== 'object') throw storeError('INVALID_AFTERGLOW_IMPORT_TYPE');
    state = input.state;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw storeError('INVALID_AFTERGLOW_IMPORT');
  if (Number(state.schemaVersion) > SCHEMA_VERSION) throw storeError('UNSUPPORTED_SCHEMA_VERSION');
  if (Number(state.schemaVersion) !== SCHEMA_VERSION || !Array.isArray(state.moments) || !Array.isArray(state.trackSnapshots)) throw storeError('INVALID_AFTERGLOW_IMPORT');
  if (state.moments.length > MAX_MOMENTS || state.trackSnapshots.length > MAX_TRACKS) throw storeError('AFTERGLOW_IMPORT_LIMIT');
  const moments = state.moments.map(normalizeMoment);
  const trackSnapshots = state.trackSnapshots.map(normalizeTrack);
  if (new Set(moments.map((item) => item.id)).size !== moments.length || new Set(trackSnapshots.map((item) => item.id)).size !== trackSnapshots.length) {
    throw storeError('AFTERGLOW_IMPORT_DUPLICATE_ID');
  }
  return { schemaVersion: SCHEMA_VERSION, updatedAt: iso(state.updatedAt), moments, trackSnapshots };
}

function importPreview(local, incoming) {
  const localMoments = new Map(local.moments.map((item) => [item.id, item]));
  const localTracks = new Map(local.trackSnapshots.map((item) => [item.id, item]));
  const moments = { added: 0, incomingNewer: 0, localNewer: 0, diverged: 0, unchanged: 0 };
  const tracks = { added: 0, conflict: 0, unchanged: 0 };
  for (const item of incoming.moments) {
    const current = localMoments.get(item.id);
    if (!current) moments.added++;
    else if (same(current, item)) moments.unchanged++;
    else if (item.updatedAt > current.updatedAt) moments.incomingNewer++;
    else if (item.updatedAt < current.updatedAt) moments.localNewer++;
    else moments.diverged++;
  }
  for (const item of incoming.trackSnapshots) {
    const current = localTracks.get(item.id);
    if (!current) tracks.added++;
    else if (same(current, item)) tracks.unchanged++;
    else tracks.conflict++;
  }
  const mergedTrackIds = new Set([...local.trackSnapshots, ...incoming.trackSnapshots].map((item) => item.id));
  const orphanedMoments = incoming.moments.filter((item) => !mergedTrackIds.has(item.trackId)).length;
  return {
    moments, tracks, orphanedMoments,
    incoming: { moments: incoming.moments.length, tracks: incoming.trackSnapshots.length },
    local: { moments: local.moments.length, tracks: local.trackSnapshots.length },
  };
}

function mergeImport(local, incoming, strategy) {
  if (strategy === 'replace') return clone(incoming);
  const incomingWins = strategy === 'incoming';
  const moments = new Map(local.moments.map((item) => [item.id, item]));
  const tracks = new Map(local.trackSnapshots.map((item) => [item.id, item]));
  for (const item of incoming.moments) {
    const current = moments.get(item.id);
    if (!current || incomingWins || item.updatedAt > current.updatedAt) moments.set(item.id, item);
  }
  for (const item of incoming.trackSnapshots) if (!tracks.has(item.id) || incomingWins) tracks.set(item.id, item);
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: local.updatedAt,
    moments: [...moments.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    trackSnapshots: [...tracks.values()],
  };
}

class AfterglowNoteStore {
  constructor({ userDataPath, maxBackups = MAX_BACKUPS }) {
    if (!path.isAbsolute(String(userDataPath || ''))) throw storeError('INVALID_AFTERGLOW_STORE_PATH');
    this.directory = path.join(path.resolve(userDataPath), 'afterglow');
    this.file = path.join(this.directory, 'notebook.json');
    this.backup = `${this.file}.bak`;
    this.backupDirectory = path.join(this.directory, 'backups');
    this.maxBackups = Math.max(1, Math.min(20, Number(maxBackups) || MAX_BACKUPS));
    this.state = null;
    this.recoveryInfo = null;
    this.blockedByNewerSchema = false;
    this.mutationQueue = Promise.resolve();
    this.importSessions = new Map();
  }

  async readCandidate(file) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw storeError('AFTERGLOW_STORE_TOO_LARGE');
      return normalizeState(JSON.parse(await fs.promises.readFile(file, 'utf8')));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async backupFiles() {
    try {
      const names = await fs.promises.readdir(this.backupDirectory);
      const entries = await Promise.all(names.filter((name) => /^notebook-[\w.-]+\.json$/.test(name)).map(async (name) => {
        const file = path.join(this.backupDirectory, name);
        const stat = await fs.promises.stat(file);
        return { id: name, file, createdAt: stat.mtime.toISOString(), bytes: stat.size, mtime: stat.mtimeMs };
      }));
      return entries.sort((a, b) => b.mtime - a.mtime);
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async ensureLoaded() {
    if (this.state) return;
    await fs.promises.mkdir(this.directory, { recursive: true });
    let primaryError = null;
    try {
      const primary = await this.readCandidate(this.file);
      if (primary) { this.state = primary; return; }
    } catch (error) {
      if (error && error.code === 'UNSUPPORTED_SCHEMA_VERSION') { this.blockedByNewerSchema = true; throw error; }
      primaryError = error;
    }
    const candidates = await this.backupFiles();
    candidates.push({ id: 'legacy', file: this.backup, createdAt: '', bytes: 0, mtime: 0 });
    for (const candidate of candidates) {
      try {
        const backup = await this.readCandidate(candidate.file);
        if (!backup) continue;
        this.state = backup;
        this.recoveryInfo = {
          backupId: candidate.id,
          backupUpdatedAt: backup.updatedAt,
          recoveredAt: new Date().toISOString(),
          reason: primaryError ? 'PRIMARY_CORRUPT' : 'PRIMARY_MISSING',
        };
        return;
      } catch (error) {
        if (error && error.code === 'UNSUPPORTED_SCHEMA_VERSION') { this.blockedByNewerSchema = true; throw error; }
      }
    }
    if (primaryError) throw storeError('AFTERGLOW_STORE_CORRUPT');
    this.state = emptyState();
  }

  async writeBody(file, body) {
    const handle = await fs.promises.open(file, 'wx', 0o600);
    try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  }

  async createVersionedBackup(state, token) {
    await fs.promises.mkdir(this.backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('Z', 'Z');
    const id = `notebook-${timestamp}-${crypto.randomBytes(3).toString('hex')}.json`;
    const temporary = path.join(this.backupDirectory, `${id}.${token}.tmp`);
    const target = path.join(this.backupDirectory, id);
    const body = `${JSON.stringify(state, null, 2)}\n`;
    await this.writeBody(temporary, body);
    await fs.promises.rename(temporary, target);
    const legacyTemporary = `${this.backup}.${token}.tmp`;
    await this.writeBody(legacyTemporary, body);
    await fs.promises.rm(this.backup, { force: true });
    await fs.promises.rename(legacyTemporary, this.backup);
    const entries = await this.backupFiles();
    await Promise.all(entries.slice(this.maxBackups).map((entry) => fs.promises.rm(entry.file, { force: true })));
    return id;
  }

  async writeState(next) {
    if (this.blockedByNewerSchema) throw storeError('UNSUPPORTED_SCHEMA_VERSION');
    const normalized = normalizeState(next);
    const body = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw storeError('AFTERGLOW_STORE_TOO_LARGE');
    await fs.promises.mkdir(this.directory, { recursive: true });
    const token = `${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    const temporary = `${this.file}.${token}.tmp`;
    try {
      await this.writeBody(temporary, body);
      let primary = null;
      try { primary = await this.readCandidate(this.file); } catch (error) {
        if (error && error.code === 'UNSUPPORTED_SCHEMA_VERSION') throw error;
      }
      if (primary) await this.createVersionedBackup(primary, token);
      await fs.promises.rm(this.file, { force: true });
      await fs.promises.rename(temporary, this.file);
      this.state = normalized;
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
  }

  mutate(operation) {
    const task = this.mutationQueue.then(async () => {
      await this.ensureLoaded();
      const draft = clone(this.state);
      const result = await operation(draft);
      draft.updatedAt = new Date().toISOString();
      await this.writeState(draft);
      return result;
    });
    this.mutationQueue = task.catch(() => {});
    return task;
  }

  async settle() { await this.mutationQueue; await this.ensureLoaded(); }

  async listMoments() {
    await this.settle();
    return { ok: true, schemaVersion: SCHEMA_VERSION, recoveredFromBackup: !!this.recoveryInfo, recovery: this.recoveryInfo && { ...this.recoveryInfo }, moments: this.state.moments.map((item) => ({ ...item })) };
  }

  async saveMoment(input) {
    const moment = normalizeMoment(input);
    return this.mutate((state) => {
      const index = state.moments.findIndex((item) => item.id === moment.id);
      if (index >= 0) state.moments[index] = moment;
      else { if (state.moments.length >= MAX_MOMENTS) throw storeError('AFTERGLOW_MOMENT_LIMIT'); state.moments.unshift(moment); }
      state.moments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ok: true, moment };
    });
  }

  async deleteMoment(id) {
    const safeId = string(id, 256, true);
    return this.mutate((state) => {
      const before = state.moments.length;
      state.moments = state.moments.filter((item) => item.id !== safeId);
      return { ok: true, id: safeId, deleted: state.moments.length !== before };
    });
  }

  async listTrackSnapshots() {
    await this.settle();
    return { ok: true, schemaVersion: SCHEMA_VERSION, trackSnapshots: clone(this.state.trackSnapshots) };
  }

  async saveTrackSnapshot(input) {
    const track = normalizeTrack(input);
    return this.mutate((state) => {
      const index = state.trackSnapshots.findIndex((item) => item.id === track.id);
      if (index >= 0) state.trackSnapshots[index] = track;
      else { if (state.trackSnapshots.length >= MAX_TRACKS) state.trackSnapshots.pop(); state.trackSnapshots.unshift(track); }
      return { ok: true, trackSnapshot: track };
    });
  }

  async exportNotebook() {
    await this.settle();
    return { type: EXPORT_TYPE, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), state: clone(this.state) };
  }

  async prepareImport(input) {
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    if (bytes > MAX_FILE_BYTES) throw storeError('AFTERGLOW_IMPORT_TOO_LARGE');
    const incoming = strictImportState(input);
    await this.settle();
    const token = crypto.randomBytes(24).toString('hex');
    const preview = importPreview(this.state, incoming);
    this.importSessions.set(token, { incoming, baseUpdatedAt: this.state.updatedAt, expiresAt: Date.now() + IMPORT_SESSION_MS });
    for (const [id, session] of this.importSessions) if (session.expiresAt < Date.now()) this.importSessions.delete(id);
    return { ok: true, token, baseUpdatedAt: this.state.updatedAt, preview };
  }

  async commitImport({ token, strategy = 'safe' } = {}) {
    const safeToken = String(token || '');
    const mode = ['safe', 'incoming', 'replace'].includes(strategy) ? strategy : 'safe';
    const session = this.importSessions.get(safeToken);
    if (!session || session.expiresAt < Date.now()) throw storeError('INVALID_AFTERGLOW_IMPORT_SESSION');
    const result = await this.mutate((state) => {
      if (state.updatedAt !== session.baseUpdatedAt) throw storeError('AFTERGLOW_IMPORT_STALE');
      const merged = mergeImport(state, session.incoming, mode);
      state.moments = merged.moments;
      state.trackSnapshots = merged.trackSnapshots;
      return { ok: true, strategy: mode, moments: merged.moments.length, tracks: merged.trackSnapshots.length };
    });
    this.importSessions.delete(safeToken);
    return result;
  }

  async listBackups() {
    await this.settle();
    const entries = await this.backupFiles();
    const backups = [];
    for (const entry of entries) {
      try {
        const state = await this.readCandidate(entry.file);
        if (state) backups.push({ id: entry.id, createdAt: entry.createdAt, updatedAt: state.updatedAt, moments: state.moments.length, tracks: state.trackSnapshots.length, bytes: entry.bytes });
      } catch (_) {}
    }
    return { ok: true, currentUpdatedAt: this.state.updatedAt, backups };
  }

  async restoreBackup({ id, expectedUpdatedAt } = {}) {
    const safeId = String(id || '');
    if (!/^notebook-[\w.-]+\.json$/.test(safeId)) throw storeError('INVALID_AFTERGLOW_BACKUP');
    const file = path.join(this.backupDirectory, safeId);
    const task = this.mutationQueue.then(async () => {
      await this.ensureLoaded();
      if (expectedUpdatedAt && this.state.updatedAt !== String(expectedUpdatedAt)) throw storeError('AFTERGLOW_IMPORT_STALE');
      const restored = await this.readCandidate(file);
      if (!restored) throw storeError('INVALID_AFTERGLOW_BACKUP');
      restored.updatedAt = new Date().toISOString();
      await this.writeState(restored);
      return { ok: true, moments: restored.moments.length, tracks: restored.trackSnapshots.length, updatedAt: restored.updatedAt };
    });
    this.mutationQueue = task.catch(() => {});
    return task;
  }

  async acknowledgeRecovery() {
    await this.settle();
    this.recoveryInfo = null;
    return { ok: true };
  }
}

module.exports = {
  AfterglowNoteStore, SCHEMA_VERSION, EXPORT_TYPE, MAX_FILE_BYTES,
  normalizeMoment, normalizeTrack, strictImportState, importPreview,
};
