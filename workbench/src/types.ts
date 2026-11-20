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
  /** 与 lines 一一对应；emotion / note 只在模型参与分析时才有。 */
  bars: { energy: number; tension: number; emotion?: string; note?: string }[];
  warnings: string[];
  /** evidence 是依据的歌词行下标（从 0 起），指向 lines。 */
  insights: { title: string; body: string; evidence?: number[] }[];
  steps: { kind: string; status: string }[];
}
export interface ReviewNoteInput { id: string; title: string; body: string; quote: string; trackTitle: string; artist: string; createdAt: string }
export type MoodTone = -1 | 0 | 1;
export interface ReviewMood { noteId: string; mood: string; tone: MoodTone }
export interface ReviewResult {
  overview: string;
  themes: { title: string; body: string; noteIds: string[] }[];
  moods: ReviewMood[];
  question: string;
  noteCount: number;
  warnings: string[];
}
export type ReviewRangeId = '7' | '30' | '90' | 'all';
export interface ReviewRecord {
  id: string;
  createdAt: string;
  rangeId: ReviewRangeId;
  rangeLabel: string;
  focus: string;
  data: ReviewResult;
  refs: Record<string, { createdAt: string; trackTitle: string }>;
}
export interface AskInput {
  track: { title: string; artist: string };
  position?: { seconds?: number; section?: string };
  quote: string;
  context: string[];
  draft: string;
  earlier: { body: string; createdAt: string }[];
}
export interface AskResult { question: string }
export interface PolishInput {
  track: { title: string; artist: string };
  quote: string;
  draft: string;
}
export interface PolishResult { text: string; warnings: string[] }
export interface TasteInput {
  totalMinutes: number;
  sessions: number;
  topSongs: { name: string; artist: string; plays: number; minutes: number }[];
  topArtists: { name: string; plays: number; minutes: number }[];
  byHour: number[];
  last14Days: { date: string; minutes: number }[];
  recent: { name: string; artist: string; at: string; listenMin: number; completed: boolean }[];
  /** 23 点到凌晨 5 点，在不同夜晚被反复听到的歌。 */
  nightSongs?: { name: string; artist: string; nightDays: number; nights: number; minutes: number; plays: number }[];
  /** 听歌与笔记的对照，只含条数，不含笔记内容；用户未授权时不会出现。 */
  notes?: {
    totalNotes: number;
    mostWritten: { name: string; artist: string; notes: number; plays: number; minutes: number }[];
    listenedNotWritten: { name: string; artist: string; plays: number; minutes: number }[];
  };
}
export interface TasteResult { summary: string; points: { title: string; body: string }[]; hint: string }

export interface ReadingInput { track: { title: string; artist: string }; lines: string[] }
export interface LineReading { index: number; emotion: string; note: string }
export interface ReadingInsight { title: string; body: string; lines: number[] }
export interface ReadingResult { lines: LineReading[]; insights: ReadingInsight[]; warnings: string[] }
