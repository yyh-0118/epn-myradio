import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { LineReading, ReadingInput, ReadingInsight, ReadingResult } from '../src/types';
import { DATA_DELIMITER, createProseSplitter, parseJsonLoose, type StreamRunHandlers } from './stream';

export class ReadingUnavailableError extends Error {}

export const READING_MAX_LINES = 200;
export const READING_MAX_PICKED = 14;
export const READING_EMOTION_MAX = 8;
export const READING_NOTE_MAX = 60;

const SYSTEM_PROMPT = [
  '你是一位安静的歌词读者，帮听歌的人读懂歌词里值得停一下的句子。',
  '规则：',
  '1. 只依据给出的歌词文字，不编造歌手的经历、创作背景或这首歌背后的故事。',
  '2. 只挑真正有意象、有转折或承载核心意思的句子来解读，最多 12 句，其余不写。不要每句都解读。',
  '3. 解读是一句话，说这句在说什么、暗示了什么，不超过 30 个字，不要升华，不要说教，用“看起来”“像是”这类措辞，不下定论。',
  '4. 情绪词是 2 到 4 个字的中文词，比如“怅然”“克制”“期待”。',
  '输出格式（严格遵守，分两部分）：',
  '第一部分：每个解读占一行，格式为：序号|情绪词|一句解读。序号就是歌词前面的编号，不要写别的文字，不要标题。',
  `第二部分：另起一行，只写 ${DATA_DELIMITER}，然后紧接着输出一个 JSON 对象，不要任何额外文字：`,
  '{"insights":[{"title":"8字以内","body":"1-2句，说明整首歌的一个读法","lines":[支撑它的歌词序号，最多4个]}]}',
  'insights 给 2 到 3 条。',
].join('\n');

export function buildReadingPrompt(input: ReadingInput) {
  const head = `歌曲：《${input.track.title || '未知曲目'}》${input.track.artist ? ` - ${input.track.artist}` : ''}`;
  return `${head}\n\n歌词：\n${input.lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`;
}

const READING_LINE = /^\s*(\d{1,3})\s*[|｜]\s*([^|｜]{1,20}?)\s*[|｜]\s*(.+?)\s*$/;

function clamp(text: string, max: number) {
  const chars = [...text.trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** 解析一行「序号|情绪词|解读」；序号越界或格式不对返回 null。 */
export function parseReadingLine(line: string, lineCount: number): LineReading | null {
  const match = READING_LINE.exec(line.replace(/^[\s\-*•]+/, ''));
  if (!match) return null;
  const index = Number(match[1]) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= lineCount) return null;
  const emotion = clamp(match[2].replace(/[“”"「」『』]/g, ''), READING_EMOTION_MAX);
  const note = clamp(match[3].replace(/^[“"「『]|[”"」』]$/g, ''), READING_NOTE_MAX);
  return emotion && note ? { index, emotion, note } : null;
}

export function normalizeReading(prose: string, dataText: string, lineCount: number, extraWarnings: string[] = []): ReadingResult {
  const seen = new Set<number>();
  const lines: LineReading[] = [];
  for (const raw of prose.split(/\r?\n/)) {
    const item = parseReadingLine(raw, lineCount);
    if (!item || seen.has(item.index) || lines.length >= READING_MAX_PICKED) continue;
    seen.add(item.index);
    lines.push(item);
  }
  lines.sort((a, b) => a.index - b.index);

  const insights: ReadingInsight[] = [];
  const parsed = parseJsonLoose<{ insights?: unknown }>(dataText);
  for (const item of Array.isArray(parsed?.insights) ? parsed.insights : []) {
    if (!item || typeof item !== 'object') continue;
    const { title, body, lines: refs } = item as { title?: unknown; body?: unknown; lines?: unknown };
    const t = typeof title === 'string' ? clamp(title, 20) : '';
    const b = typeof body === 'string' ? clamp(body, 200) : '';
    if (!t || !b) continue;
    const evidence = [...new Set((Array.isArray(refs) ? refs : []).map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < lineCount))].sort((x, y) => x - y).slice(0, 4);
    insights.push({ title: t, body: b, lines: evidence });
  }
  if (!lines.length && !insights.length) throw new Error('READING_EMPTY');
  return { lines, insights: insights.slice(0, 3), warnings: extraWarnings };
}

export async function streamReading(input: ReadingInput, handlers: StreamRunHandlers, client = new DeepSeekClient(), signal?: AbortSignal): Promise<ReadingResult> {
  if (!client.isConfigured) throw new ReadingUnavailableError('LLM_NOT_CONFIGURED');
  const splitter = createProseSplitter(handlers.onText);
  const { finishReason } = await client.streamChat({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildReadingPrompt(input) }],
    signal, temperature: 0.4, maxTokens: 3000, disableThinking: true,
    onThinking: handlers.onThinking,
    onContent: (chunk) => splitter.push(chunk),
  });
  const done = splitter.finish();
  const warnings: string[] = [];
  if (finishReason === 'length') warnings.push('模型输出被截断，后面的解读可能不完整，可以重新解读一次。');
  else if (!done.data.trim()) warnings.push('整首歌的几条读法没有生成出来，可以重新解读一次。');
  return normalizeReading(done.prose, done.data, input.lines.length, warnings);
}
