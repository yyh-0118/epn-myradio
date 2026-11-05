// SPDX-License-Identifier: GPL-3.0-only
// LRC/YRC parsing adapted from Mineradio-paused/public/js/modules/06-lyrics/00-lyrics-fetch-parse.js.
// Afterglow changes: types, stable line IDs, explicit untimed text, LRC offset support.
import type { LyricLine, LyricWord, Track } from '../types';

type TimedLine = { t: number; text: string; duration?: number; words?: LyricWord[] };

function finalize(lines: TimedLine[]): LyricLine[] {
  return lines.sort((a, b) => a.t - b.t).map((line, index, all) => ({
    ...line,
    id: `line-${index + 1}`,
    duration: Math.max(0.45, Math.min(12, line.duration || ((all[index + 1]?.t ?? line.t + 4.8) - line.t))),
  }));
}

export function parseLrc(text: string): LyricLine[] {
  const lines: TimedLine[] = [];
  const reg = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  text.split(/\r?\n/).forEach((line) => {
    const tags = [...line.matchAll(reg)].map((match) => ({
      t: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`) + offset),
      index: match.index!, end: match.index! + match[0].length,
    }));
    if (!tags.length) return;
    const interleaved = tags.slice(0, -1).some((tag, i) => line.slice(tag.end, tags[i + 1].index).trim());
    if (interleaved) {
      tags.forEach((tag, i) => {
        const value = line.slice(tag.end, tags[i + 1]?.index ?? line.length).trim();
        if (value) lines.push({ t: tag.t, text: value });
      });
    } else {
      const value = line.replace(reg, '').trim();
      if (value) tags.forEach((tag) => lines.push({ t: tag.t, text: value }));
    }
  });
  return finalize(lines);
}

export function parseYrc(text: string): LyricLine[] {
  const lines: TimedLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;
    const startMs = Number(match[1]);
    let fullText = '';
    const words: LyricWord[] = [];
    for (const word of match[3].matchAll(/\((\d+),(\d+),\d+\)([^()]*)/g)) {
      const value = word[3].replace(/\s+/g, ' ');
      if (!value) continue;
      const start = Number(word[1]);
      const c0 = fullText.length;
      fullText += value;
      words.push({ text: value, t: (start >= startMs - 500 ? start : startMs + start) / 1000, d: Math.max(0.06, Number(word[2]) / 1000), c0, c1: fullText.length });
    }
    if (!fullText) fullText = match[3].replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
    const leading = fullText.length - fullText.trimStart().length;
    fullText = fullText.trim();
    if (!fullText) continue;
    words.forEach((word) => {
      word.c0 = Math.max(0, Math.min(fullText.length, word.c0 - leading));
      word.c1 = Math.max(word.c0, Math.min(fullText.length, word.c1 - leading));
    });
    lines.push({ t: startMs / 1000, duration: Number(match[2]) / 1000, text: fullText, words: words.filter((word) => word.c1 > word.c0) });
  }
  return finalize(lines);
}

export function parseLyrics(text: string): { lyrics: LyricLine[]; lyricSource: Track['lyricSource'] } {
  const yrc = parseYrc(text);
  if (yrc.length) return { lyrics: yrc, lyricSource: 'yrc' };
  const lrc = parseLrc(text);
  if (lrc.length) return { lyrics: lrc, lyricSource: 'lrc' };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { lyrics: lines.map((line, index) => ({ id: `line-${index + 1}`, text: line, t: null })), lyricSource: lines.length ? 'text' : 'none' };
}

export function formatTime(time: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function activeLineIndex(lines: LyricLine[], time: number) {
  let found = -1;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].t !== null && lines[index].t! <= time) found = index;
  }
  return found;
}
