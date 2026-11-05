export const HOST_CHANNEL = 'mineradio.afterglow' as const;
export const HOST_VERSION = 2 as const;

export interface HostWord { text: string; t: number; d: number; c0: number; c1: number }
export interface HostLyricLine { id: string; text: string; t: number | null; duration?: number; words?: HostWord[] }
export interface HostPlaybackRef {
  provider?: string; source?: string; type?: string; id?: string | number; mid?: string; songmid?: string;
  mediaMid?: string; qqId?: string; spotifyId?: string; spotifyUri?: string; uri?: string;
  hash?: string; fileHash?: string; audioHash?: string; albumId?: string | number; albumMid?: string;
  albumAudioId?: string | number; mixSongId?: string | number; hqHash?: string; sqHash?: string; resHash?: string;
  providerSongId?: string | number; programId?: string | number; radioId?: string | number;
  localKey?: string; localFileId?: string; name?: string; title?: string; artist?: string; album?: string;
  duration?: number; durationMs?: number; dt?: number; fee?: number; playable?: boolean;
}
export interface HostTrack {
  id: string;
  provider: string;
  sourceId: string;
  title: string;
  artist: string;
  duration: number;
  playbackRef?: HostPlaybackRef;
}
export interface HostPlayback { time: number; duration: number; playing: boolean; rate: number; sampledAt: number }
export interface HostCapabilities { seek: boolean; play: boolean; pause: boolean; capture: boolean; playTrack: boolean; epnAnalysis: boolean; persistentStorage: boolean; notebookArchive?: boolean; backupRestore?: boolean; closeFlush?: boolean }
export interface HostSnapshot { capabilities: HostCapabilities; track: HostTrack | null; lyrics: HostLyricLine[]; playback: HostPlayback }
export interface HostCapture { commandId: string; track: HostTrack; time: number; capturedAt: number; line?: HostLyricLine; reason: 'host-button' | 'hotkey' | 'child-request' | 'stage-lyric' }
export type StorageOperation = 'listMoments' | 'saveMoment' | 'deleteMoment' | 'listTracks' | 'saveTrack' | 'exportNotebook' | 'prepareImport' | 'commitImport' | 'listBackups' | 'restoreBackup' | 'acknowledgeRecovery';
export interface StorageRequest { operation: StorageOperation; payload?: unknown }
export interface RecoveryInfo { backupId: string; backupUpdatedAt: string; recoveredAt: string; reason: string }
export interface ImportPreview {
  moments: { added: number; incomingNewer: number; localNewer: number; diverged: number; unchanged: number };
  tracks: { added: number; conflict: number; unchanged: number };
  orphanedMoments: number;
  incoming: { moments: number; tracks: number };
  local: { moments: number; tracks: number };
}
export interface BackupInfo { id: string; createdAt: string; updatedAt: string; moments: number; tracks: number; bytes: number }
export interface StorageResponse {
  ok: boolean; error?: string; canceled?: boolean; moments?: unknown[]; moment?: unknown;
  trackSnapshots?: unknown[]; trackSnapshot?: unknown; deleted?: boolean; recoveredFromBackup?: boolean;
  recovery?: RecoveryInfo | null; token?: string; baseUpdatedAt?: string; preview?: ImportPreview;
  backups?: BackupInfo[]; currentUpdatedAt?: string; tracks?: number;
}
export interface PlaybackResponse { ok: boolean; error?: string; mode?: 'seek' | 'track'; trackId?: string }
export interface BridgeEnvelope<T = unknown> {
  channel: typeof HOST_CHANNEL;
  version: typeof HOST_VERSION;
  sessionId: string;
  seq: number;
  type: string;
  requestId?: string;
  payload?: T;
}
export function isEnvelope(value: unknown): value is BridgeEnvelope {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<BridgeEnvelope>;
  return message.channel === HOST_CHANNEL && message.version === HOST_VERSION && typeof message.type === 'string' && typeof message.sessionId === 'string' && typeof message.seq === 'number';
}
