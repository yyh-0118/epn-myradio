import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { PolishInput, PolishResult } from '../src/types';
import { stripAskLines } from '../src/lib/writing';
import type { StreamRunHandlers } from './stream';

export class PolishUnavailableError extends Error {}

export const POLISH_MIN_CHARS = 20;
export const POLISH_MAX_CHARS = 3000;

const SYSTEM_PROMPT = [
  '你是一位克制的文字整理者，帮用户把听歌时随手写下的零散笔记，整理成一段通顺的文字。',
  '严格规则：',
  '1. 只整理，不创作：保留他原有的意思、事实、人物、情绪和先后顺序，不添加他没写过的经历、细节、比喻或感悟。',
  '2. 保留他的口吻和用词习惯，用第一人称，不要写得比他原来更文艺、更煽情，不要升华，不要总结，不要说教。',
  '3. 只做这些事：理顺语序、补全省略的主语、连接零散的句子、改掉明显的错别字和重复。',
  '4. 他原文里以「>」或「问：」开头的行是 AI 之前提的问题，不是他写的话，整理时直接丢掉，不要改写进正文。',
  '5. 篇幅与原文相当，可以略短，不要明显变长。',
  '6. 直接输出整理后的那一段文字，不要引号、不要标题、不要前后说明、不要 Markdown。',
].join('\n');

function buildPolishPrompt(input: PolishInput) {
  const parts = [`歌曲：《${input.track.title || '未知曲目'}》${input.track.artist ? ` - ${input.track.artist}` : ''}`];
  if (input.quote) parts.push(`他被打动的歌词：${input.quote}`);
  parts.push(`他的原文：\n${input.draft.trim()}`);
  return parts.join('\n\n');
}

/** 去掉模型偶尔加上的引号、标题和代码围栏。 */
export function cleanPolished(text: string) {
  return text.trim()
    .replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '')
    .replace(/^(整理后|整理如下|以下是整理后的[^：:\n]*)[：:]\s*/, '')
    .replace(/^["“「『]+|["”」』]+$/g, '')
    .trim();
}

/** 整理后明显变长，说明模型在添油加醋，给出提示（仍交给用户决定）。 */
export function polishWarnings(original: string, polished: string) {
  const warnings: string[] = [];
  const base = stripAskLines(original).replace(/\s+/g, '').length;
  const next = polished.replace(/\s+/g, '').length;
  if (base > 0 && next > base * 1.4 + 10) warnings.push('整理后的文字比原文长了不少，可能加入了你没写过的内容，采用前请对照原文。');
  return warnings;
}

export function assertPolishable(draft: string) {
  const body = stripAskLines(draft);
  if (body.length < POLISH_MIN_CHARS) throw new Error('POLISH_TOO_SHORT');
}

export async function streamPolish(input: PolishInput, handlers: StreamRunHandlers, client = new DeepSeekClient(), signal?: AbortSignal): Promise<PolishResult> {
  if (!client.isConfigured) throw new PolishUnavailableError('LLM_NOT_CONFIGURED');
  assertPolishable(input.draft);
  let raw = '';
  let shown = 0;
  const { finishReason } = await client.streamChat({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildPolishPrompt(input) }],
    signal, temperature: 0.3, maxTokens: 4000,
    onThinking: handlers.onThinking,
    onContent: (chunk) => {
      raw += chunk;
      const visible = raw.replace(/^[\s"“「『]+/, '');
      if (visible.length > shown) { handlers.onText(visible.slice(shown)); shown = visible.length; }
    },
  });
  const text = cleanPolished(raw);
  if (!text) throw new Error('POLISH_EMPTY');
  const warnings = polishWarnings(input.draft, text);
  if (finishReason === 'length') warnings.push('输出被截断，整理的文字可能不完整，请对照原文再决定是否采用。');
  return { text, warnings };
}
