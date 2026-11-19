import type { Moment, ReviewRangeId, ReviewRecord, ReviewResult } from '../types';

export const REVIEW_MAX_NOTES = 60;
export const REVIEW_MAX_TOTAL_CHARS = 30000;
export const REVIEW_HISTORY_LIMIT = 30;
export const REVIEW_NUDGE_DAYS = 7;
export const REVIEW_NUDGE_MIN_NOTES = 3;

export const REVIEW_RANGES: { id: ReviewRangeId; label: string; days: number }[] = [
  { id: '7', label: '最近 7 天', days: 7 },
  { id: '30', label: '最近 30 天', days: 30 },
  { id: '90', label: '最近 90 天', days: 90 },
  { id: 'all', label: '全部', days: 0 },
];

const DAY = 86400_000;
const CONSENT_KEY = 'afterglow-ai-notes-consent-v1';
const HISTORY_KEY = 'afterglow-review-history-v1';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): KeyValueStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function selectReviewNotes(moments: Moment[], days: number, now = Date.now()) {
  const since = days ? now - days * DAY : 0;
  const eligible = [...moments]
    .filter((moment) => moment.body.trim() && !(Date.parse(moment.createdAt) < since))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const picked: Moment[] = [];
  let total = 0;
  for (const moment of eligible) {
    const size = Math.min(moment.body.length, 4000) + moment.title.length + Math.min(moment.quote.length, 400);
    if (picked.length >= REVIEW_MAX_NOTES || total + size > REVIEW_MAX_TOTAL_CHARS) break;
    picked.push(moment);
    total += size;
  }
  return { picked, eligible: eligible.length };
}

export function readConsent(store: KeyValueStore | null = defaultStore()): boolean {
  try { return store?.getItem(CONSENT_KEY) === 'granted'; } catch { return false; }
}

export function writeConsent(granted: boolean, store: KeyValueStore | null = defaultStore()) {
  try {
    if (!store) return;
    if (granted) store.setItem(CONSENT_KEY, 'granted'); else store.removeItem(CONSENT_KEY);
  } catch { /* 存储不可用时保持未授权 */ }
}

function isRecord(value: unknown): value is ReviewRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ReviewRecord>;
  const data = record.data as Partial<ReviewResult> | undefined;
  return typeof record.id === 'string' && typeof record.createdAt === 'string' && typeof record.rangeLabel === 'string'
    && !!data && typeof data === 'object' && Array.isArray(data.themes) && typeof data.overview === 'string';
}

export function readReviewHistory(store: KeyValueStore | null = defaultStore()): ReviewRecord[] {
  try {
    const parsed = JSON.parse(store?.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).map((record) => ({
      ...record,
      focus: typeof record.focus === 'string' ? record.focus : '',
      refs: record.refs && typeof record.refs === 'object' ? record.refs : {},
      data: { ...record.data, moods: Array.isArray(record.data.moods) ? record.data.moods : [], warnings: Array.isArray(record.data.warnings) ? record.data.warnings : [] },
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}

function writeHistory(records: ReviewRecord[], store: KeyValueStore | null) {
  if (!store) return false;
  let list = records;
  while (true) {
    try { store.setItem(HISTORY_KEY, JSON.stringify(list)); return true; }
    catch { if (list.length <= 1) return false; list = list.slice(0, Math.ceil(list.length / 2)); }
  }
}

export function addReviewRecord(record: ReviewRecord, store: KeyValueStore | null = defaultStore()) {
  const list = [record, ...readReviewHistory(store).filter((item) => item.id !== record.id)].slice(0, REVIEW_HISTORY_LIMIT);
  const saved = writeHistory(list, store);
  return { saved, list: saved ? readReviewHistory(store) : list };
}

export function deleteReviewRecord(id: string, store: KeyValueStore | null = defaultStore()) {
  const list = readReviewHistory(store).filter((item) => item.id !== id);
  writeHistory(list, store);
  return readReviewHistory(store);
}

export function clearReviewHistory(store: KeyValueStore | null = defaultStore()) {
  try { store?.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

export function reviewNudge(moments: Moment[], history: ReviewRecord[], now = Date.now()) {
  const recentCount = moments.filter((moment) => moment.body.trim() && now - Date.parse(moment.createdAt) <= REVIEW_NUDGE_DAYS * DAY).length;
  const last = history[0] ? Date.parse(history[0].createdAt) : NaN;
  const daysSince = Number.isFinite(last) ? Math.floor((now - last) / DAY) : null;
  return { recentCount, daysSince, due: recentCount >= REVIEW_NUDGE_MIN_NOTES && (daysSince === null || daysSince >= REVIEW_NUDGE_DAYS) };
}

export function describeAgo(iso: string, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const days = Math.floor((now - time) / DAY);
  if (days < 1) return '今天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  const date = new Date(time);
  const years = new Date(now).getFullYear() - date.getFullYear();
  return years === 1 ? `去年 ${date.getMonth() + 1} 月` : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function earlierNotesForTrack(moments: Moment[], trackId: string, excludeId = '', limit = 2) {
  const matches = moments
    .filter((moment) => moment.trackId === trackId && moment.id !== excludeId && moment.body.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { notes: matches.slice(0, limit), total: matches.length };
}
