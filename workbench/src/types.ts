export interface LyricWord { text: string; t: number; d: number; c0: number; c1: number }
export interface LyricLine { id: string; text: string; t: number | null; duration?: number; words?: LyricWord[] }
export interface Track {
  id: string;
  provider?: string;
  sourceId?: string;
  playbackRef?: import('./host/contract').HostPlaybackRef;
  title: string;
  artist: string;
  duration: number;
  lyrics: LyricLine[];
  lyricSource: 'demo' | 'lrc' | 'yrc' | 'text' | 'none';
  fileName?: string;
  audio?: Blob;
}
export interface Moment {
  id: string;
  trackId: string;
  trackTitle: string;
  artist: string;
  lineId: string;
  quote: string;
  at: number;
  capturedAt: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
export interface RhymeUnit {
  lineIndex: number;
  text: string;
  start: number;
  end: number;
  group: string;
  label: string;
  note: string;
  confidence: number | null;
}
export interface AnalysisResult {
  source: 'rules' | 'hybrid' | 'llm-rules-fallback';
  lines: string[];
  units: RhymeUnit[];
  groups: { id: string; label: string; description: string }[];
  metrics: { energy: number; melancholy: number; narrativeTension: number };
  bars: { energy: number; tension: number }[];
  warnings: string[];
  insights: { title: string; body: string }[];
  steps: { kind: string; status: string }[];
}
