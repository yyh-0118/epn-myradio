import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { TasteInput, TasteResult } from '../src/types';
import { DATA_DELIMITER, parseJsonLoose, runProseStream, type StreamRunHandlers } from './stream';

export class TasteUnavailableError extends Error {}

const SYSTEM_PROMPT = [
  '你是用户的一位老朋友，熟悉音乐。下面是他最近的聆听记录统计，请帮他看看他最近的喜好。',
  '要求：',
  '1. 只依据给出的数据，不编造他没听过的歌、没有的经历，不凭空推断年龄、职业、感情状态。',
  '2. 指出真实可见的规律：反复听的歌或歌手、集中听歌的时段、最近与之前的变化、听歌量的起伏；如果给出了「深夜反复听的歌」或「听与写」的对照，可以结合起来看（比如某首歌既常在深夜听、也写得多），但只陈述数据，不要推断他的心情或经历。',
  '3. 数据很少时，如实说“目前能看出的有限”，不要硬凑。',
  '4. 语气温和、口语化，不说教，不下诊断；使用“看起来”“似乎”这类措辞。',
  '5. 可以在最后给一句“可以试试”的建议（比如某类风格或一个歌手方向），必须是建议而不是结论。',
  '只输出一个 JSON 对象，不要任何额外文字：',
  '{"summary":"2-3 句总体印象","points":[{"title":"8字以内","body":"1-2 句，写明依据的数据"}],"hint":"一句建议，可为空字符串"}',
  'points 给 2 到 4 条。',
].join('\n');

export function buildTastePrompt(input: TasteInput) {
  const lines = [
    `累计聆听 ${input.totalMinutes} 分钟，共 ${input.sessions} 次。`,
    `常听歌曲：${input.topSongs.map((s) => `${s.name}${s.artist ? ` - ${s.artist}` : ''}（${s.plays} 次/${s.minutes} 分）`).join('；') || '无'}`,
    `常听歌手：${input.topArtists.map((a) => `${a.name}（${a.plays} 次/${a.minutes} 分）`).join('；') || '无'}`,
    `0-23 点各时段分钟数：${input.byHour.join(',')}`,
    `最近 14 天每日分钟数：${input.last14Days.map((d) => `${d.date.slice(5)}:${d.minutes}`).join(' ')}`,
    ...(input.nightSongs?.length ? [`深夜（23 点到凌晨 5 点）在不同夜晚反复听的歌：${input.nightSongs.map((s) => `${s.name}${s.artist ? ` - ${s.artist}` : ''}（${s.nightDays} 个夜晚/${s.nights} 次/${s.minutes} 分）`).join('；')}`] : []),
    ...(input.notes ? [
      `他在这些歌下共写过 ${input.notes.totalNotes} 条笔记（这里只有条数，你看不到内容，也不要猜内容）。`,
      `写得最多的歌：${input.notes.mostWritten.map((s) => `${s.name}${s.artist ? ` - ${s.artist}` : ''}（${s.notes} 条笔记/听了 ${s.plays} 次）`).join('；') || '无'}`,
      `常听但一条没写过：${input.notes.listenedNotWritten.map((s) => `${s.name}${s.artist ? ` - ${s.artist}` : ''}（${s.plays} 次）`).join('；') || '无'}`,
    ] : []),
    `最近听过（新到旧）：${input.recent.map((r) => `${r.at} ${r.name}${r.artist ? ` - ${r.artist}` : ''}${r.completed ? '' : '（未听完）'}`).join('；') || '无'}`,
  ];
  return lines.join('\n');
}

type RawTaste = { summary?: unknown; points?: unknown; hint?: unknown };

function normalizeTaste(raw: RawTaste, extraWarnings: string[] = []): TasteResult & { warnings: string[] } {
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 600) : '';
  const points: TasteResult['points'] = [];
  for (const item of Array.isArray(raw.points) ? raw.points : []) {
    if (!item || typeof item !== 'object') continue;
    const point = item as { title?: unknown; body?: unknown };
    const title = typeof point.title === 'string' ? point.title.trim().slice(0, 30) : '';
    const body = typeof point.body === 'string' ? point.body.trim().slice(0, 400) : '';
    if (title && body) points.push({ title, body });
  }
  if (!summary && !points.length) throw new Error('TASTE_EMPTY');
  return { summary, points: points.slice(0, 4), hint: typeof raw.hint === 'string' ? raw.hint.trim().slice(0, 300) : '', warnings: extraWarnings };
}

export async function runTaste(input: TasteInput, client = new DeepSeekClient()): Promise<TasteResult> {
  if (!client.isConfigured) throw new TasteUnavailableError('LLM_NOT_CONFIGURED');
  const raw = await client.completeJson<RawTaste>({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildTastePrompt(input) }],
    temperature: 0.6,
    maxTokens: 6000,
  });
  const { warnings: _warnings, ...result } = normalizeTaste(raw);
  return result;
}

const STREAM_SYSTEM_PROMPT = [
  ...SYSTEM_PROMPT.split('\n').slice(0, 7),
  '输出格式（严格遵守，分两部分）：',
  '第一部分：直接写 2-3 句总体印象，纯文字，不要标题、不要 Markdown、不要列表、不要 JSON。',
  `第二部分：另起一行，只写 ${DATA_DELIMITER}，然后紧接着输出一个 JSON 对象，不要任何额外文字：`,
  '{"points":[{"title":"8字以内","body":"1-2 句，写明依据的数据"}],"hint":"一句建议，可为空字符串"}',
  'points 给 2 到 4 条。',
].join('\n');

export async function streamTaste(input: TasteInput, handlers: StreamRunHandlers, client = new DeepSeekClient(), signal?: AbortSignal): Promise<TasteResult & { warnings: string[] }> {
  if (!client.isConfigured) throw new TasteUnavailableError('LLM_NOT_CONFIGURED');
  const done = await runProseStream(client, { system: STREAM_SYSTEM_PROMPT, user: buildTastePrompt(input), temperature: 0.6, maxTokens: 6000, signal }, handlers);
  const parsed = parseJsonLoose<RawTaste>(done.data);
  const warnings: string[] = [];
  if (!parsed) warnings.push(done.finishReason === 'length' ? '模型输出被截断，要点没有生成完整，可以重试。' : '要点没有解析出来，可以重新分析一次。');
  return normalizeTaste({ ...(parsed ?? {}), summary: done.prose || (parsed?.summary as string | undefined) || '' }, warnings);
}
