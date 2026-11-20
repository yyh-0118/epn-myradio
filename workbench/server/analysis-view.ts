import type { AnalysisResult } from '../src/types';

export const LINE_NOTE_MAX = 80;
export const LINE_EMOTION_MAX = 12;

type RawBar = { energy?: number; tension?: number; emotion?: string; annotations?: string[] };
type RawInsight = { title: string; body: string; evidenceIds?: string[] };

function clean(text: unknown, max: number) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** `line-3` → 2。非法、越界、重复的依据都丢掉。 */
export function evidenceToLineIndexes(ids: unknown, lineCount: number): number[] {
  const out = new Set<number>();
  for (const id of Array.isArray(ids) ? ids : []) {
    const match = typeof id === 'string' ? /^line-(\d{1,5})$/.exec(id) : null;
    const index = match ? Number(match[1]) - 1 : -1;
    if (index >= 0 && index < lineCount) out.add(index);
  }
  return [...out].sort((a, b) => a - b).slice(0, 12);
}

/**
 * 规则引擎没有模型输出，bar 上不会有情绪词和注释；
 * 这里只在模型参与（非 rules）时才带出，避免把规则的占位内容当成解读。
 */
export function toBarViews(bars: RawBar[], withModelText: boolean): AnalysisResult['bars'] {
  return bars.map((bar) => {
    const view: AnalysisResult['bars'][number] = { energy: bar.energy ?? 0, tension: bar.tension ?? 0 };
    if (withModelText) {
      const emotion = clean(bar.emotion, LINE_EMOTION_MAX);
      const note = clean(bar.annotations?.[0], LINE_NOTE_MAX);
      if (emotion) view.emotion = emotion;
      if (note) view.note = note;
    }
    return view;
  });
}

export function toInsightViews(insights: RawInsight[], lineCount: number): AnalysisResult['insights'] {
  return insights.map((insight) => {
    const evidence = evidenceToLineIndexes(insight.evidenceIds, lineCount);
    return evidence.length ? { title: insight.title, body: insight.body, evidence } : { title: insight.title, body: insight.body };
  });
}
