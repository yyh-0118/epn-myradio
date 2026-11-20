import type { LyricLine, Moment } from '../types';

/** 新写入的是 `> 问题`；同时兼容旧版写入的 `问：问题`。 */
const ASK_LINE = /^[ \t]*(?:>|问[：:]).*$/gm;

export const ASK_NOTE_MARK = '> ';

/** 去掉笔记里由「问我一句」写入的「> …」（或旧版「问：…」）行；这些是 AI 提的问题，不是用户写的话。 */
export function stripAskLines(text: string) {
  return text.replace(ASK_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 给 AI 的笔记正文：去掉 AI 提问的行。 */
export function noteBodyForAi(moment: Pick<Moment, 'body'>) {
  return stripAskLines(moment.body);
}

export type SongSection = '前奏' | '主歌' | '副歌' | '尾声' | '';

/** 用歌词时间轴粗略判断这一刻在歌里的位置；没有时间轴或时长时返回空。 */
export function locateInSong(at: number, duration: number, lines: LyricLine[]): { seconds: number; section: SongSection } {
  const seconds = Number.isFinite(at) && at >= 0 ? Math.round(at) : 0;
  if (!Number.isFinite(duration) || duration <= 0) return { seconds, section: '' };
  const timed = lines.filter((line) => line.t !== null && line.text.trim());
  if (timed.length >= 4) {
    const firstAt = timed[0].t as number;
    if (at < firstAt - 0.5) return { seconds, section: '前奏' };
    const lastAt = timed[timed.length - 1].t as number;
    if (at > lastAt + 8 && at > duration * 0.9) return { seconds, section: '尾声' };
    // 同一句歌词在全曲中重复出现，多半是副歌
    const norm = (text: string) => text.replace(/[\s,.!?，。！？、]/g, '').toLowerCase();
    const current = timed.reduce((found, line) => (line.t as number) <= at ? line : found, timed[0]);
    const key = norm(current.text);
    if (key.length >= 4 && timed.filter((line) => norm(line.text) === key).length >= 2) return { seconds, section: '副歌' };
  }
  const ratio = at / duration;
  if (ratio < 0.12 && !timed.length) return { seconds, section: '前奏' };
  if (ratio > 0.92) return { seconds, section: '尾声' };
  return { seconds, section: timed.length >= 4 ? '主歌' : '' };
}

export function isPolishable(text: string, min = 20) {
  return stripAskLines(text).length >= min;
}
