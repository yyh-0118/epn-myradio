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
export interface ReviewNoteInput { id: string; title: string; body: string; quote: string; trackTitle: string; artist: string; createdAt: string }
export interface ReviewResult {
  overview: string;
  themes: { title: string; body: string; noteIds: string[] }[];
  question: string;
  noteCount: number;
  warnings: string[];
}
export interface AskInput {
  track: { title: string; artist: string };
  quote: string;
  context: string[];
  draft: string;
  earlier: { body: string; createdAt: string }[];
}
export interface AskResult { question: string }
export interface TasteInput {
  totalMinutes: number;
  sessions: number;
  topSongs: { name: string; artist: string; plays: number; minutes: number }[];
  topArtists: { name: string; plays: number; minutes: number }[];
  byHour: number[];
  last14Days: { date: string; minutes: number }[];
  recent: { name: string; artist: string; at: string; listenMin: number; completed: boolean }[];
}
export interface TasteResult { summary: string; points: { title: string; body: string }[]; hint: string }
