import type { Moment, Track } from '../types';
import { storage } from '../lib/storage';
import type { MineradioBridge } from './bridge-client';
import type { BackupInfo, ImportPreview, RecoveryInfo } from './contract';

function assertOk<T extends { ok: boolean; error?: string }>(result: T): T {
  if (!result.ok) throw new Error(result.error || '本机存储失败。');
  return result;
}

export interface RepositoryBootstrap {
  moments: Moment[];
  tracks: Track[];
  recoveredFromBackup: boolean;
  recovery: RecoveryInfo | null;
}

export interface PreparedImport { token: string; baseUpdatedAt: string; preview: ImportPreview }
export interface BackupList { currentUpdatedAt: string; backups: BackupInfo[] }

export class HostRepository {
  constructor(private bridge: MineradioBridge, readonly persistent: boolean) {}

  async bootstrap(): Promise<RepositoryBootstrap> {
    if (!this.persistent) return { moments: await storage.moments(), tracks: await storage.tracks(), recoveredFromBackup: false, recovery: null };
    const [momentResult, trackResult] = await Promise.all([
      this.bridge.requestStorage('listMoments'), this.bridge.requestStorage('listTracks'),
    ]).then((results) => results.map(assertOk));
    let moments = Array.isArray(momentResult.moments) ? momentResult.moments as Moment[] : [];
    let tracks = Array.isArray(trackResult.trackSnapshots) ? trackResult.trackSnapshots as Track[] : [];
    if (!moments.length) {
      const legacyMoments = await storage.moments().catch(() => []);
      const legacyTracks = await storage.tracks().catch(() => []);
      for (const track of legacyTracks) assertOk(await this.bridge.requestStorage('saveTrack', track));
      for (const moment of legacyMoments) assertOk(await this.bridge.requestStorage('saveMoment', moment));
      if (legacyMoments.length) moments = legacyMoments;
      if (legacyTracks.length) tracks = legacyTracks;
    }
    return {
      moments, tracks,
      recoveredFromBackup: momentResult.recoveredFromBackup === true,
      recovery: momentResult.recovery || null,
    };
  }

  async moments(): Promise<Moment[]> { return (await this.bootstrap()).moments; }
  async tracks(): Promise<Track[]> { return (await this.bootstrap()).tracks; }

  async saveMoment(moment: Moment) {
    if (!this.persistent) return storage.saveMoment(moment);
    assertOk(await this.bridge.requestStorage('saveMoment', moment));
  }

  async deleteMoment(id: string) {
    if (!this.persistent) return storage.deleteMoment(id);
    assertOk(await this.bridge.requestStorage('deleteMoment', id));
  }

  async saveTrack(track: Track) {
    if (!this.persistent) return storage.saveTrack(track);
    assertOk(await this.bridge.requestStorage('saveTrack', track));
  }

  async exportNotebook() { return assertOk(await this.bridge.requestStorage('exportNotebook')); }

  async prepareImport(): Promise<PreparedImport | null> {
    const result = assertOk(await this.bridge.requestStorage('prepareImport'));
    if (result.canceled) return null;
    if (!result.token || !result.baseUpdatedAt || !result.preview) throw new Error('INVALID_IMPORT_PREVIEW');
    return { token: result.token, baseUpdatedAt: result.baseUpdatedAt, preview: result.preview };
  }

  async commitImport(token: string, strategy: 'safe' | 'incoming' | 'replace') {
    return assertOk(await this.bridge.requestStorage('commitImport', { token, strategy }));
  }

  async listBackups(): Promise<BackupList> {
    const result = assertOk(await this.bridge.requestStorage('listBackups'));
    return { currentUpdatedAt: result.currentUpdatedAt || '', backups: result.backups || [] };
  }

  async restoreBackup(id: string, expectedUpdatedAt: string) {
    return assertOk(await this.bridge.requestStorage('restoreBackup', { id, expectedUpdatedAt }));
  }

  async acknowledgeRecovery() { return assertOk(await this.bridge.requestStorage('acknowledgeRecovery')); }
}
