import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { AskInput, AskResult } from '../src/types';
import type { StreamRunHandlers } from './stream';

export class AskUnavailableError extends Error {}

export const ASK_MAX_CHARS = 40;

const RULES = [
  '你是用户的一位老朋友。他在听歌时被某一刻打动，正准备写几句随笔，你要问他一个问题，帮他开口。',
  '要求：',
  `1. 只问一个问题，一句话，不超过 ${ASK_MAX_CHARS} 个字，用口语。`,
  '2. 问他的感受、想起的人或事、此刻的处境，而不是分析歌词的修辞或韵脚。',
  '3. 不暗示答案，不替他下结论，不给建议，不说教，不用“请问”“您”之类的客套。',
  '4. 如果他已经写了草稿，就顺着草稿里最有分量的一处往下问，不要重复他已经写出来的内容。',
  '5. 如果他以前在这首歌下写过笔记，可以自然地呼应，但只能引用给出的内容，不编造经历。',
  '6. 没有歌词时，就问这段声音带给他什么。',
  '7. 如果给出了他记录时的播放位置和这句在歌里的位置，可以让问题贴近那一刻，但不要报时间数字。',
];

const SYSTEM_PROMPT = [...RULES, '只输出一个 JSON 对象，不要任何额外文字：{"question":"你的问题"}'].join('\n');
const STREAM_SYSTEM_PROMPT = [...RULES, '直接输出这一个问题，不要引号、不要前缀、不要解释、不要换行。'].join('\n');

export function buildAskPrompt(input: AskInput) {
  const parts: string[] = [`歌曲：《${input.track.title || '未知曲目'}》${input.track.artist ? ` - ${input.track.artist}` : ''}`];
  if (input.position?.section) parts.push(`他记录的这一刻，在歌里大概处于：${input.position.section}${typeof input.position.seconds === 'number' ? `（播放到第 ${Math.floor(input.position.seconds / 60)} 分 ${Math.floor(input.position.seconds % 60)} 秒）` : ''}`);
  if (input.quote) parts.push(`他被打动的这一句：${input.quote}`);
  if (input.context?.length) parts.push(`前后的歌词：\n${input.context.join('\n')}`);
  if (input.earlier?.length) parts.push(`他以前在这首歌下写过：\n${input.earlier.map((note, index) => `${index + 1}. [${note.createdAt.slice(0, 10)}] ${note.body}`).join('\n')}`);
  parts.push(input.draft?.trim() ? `他现在写的草稿：\n${input.draft.trim()}` : '他还没有开始写。');
  return parts.join('\n\n');
}

export function cleanQuestion(text: string) {
  const one = text.trim().replace(/^["“「『]+|["”」』]+$/g, '').replace(/^(问|问题)[：:]\s*/, '').split(/\n+/)[0].trim();
  return one.length > ASK_MAX_CHARS ? `${one.slice(0, ASK_MAX_CHARS - 1).replace(/[，,、；;\s]+$/, '')}…` : one;
}

export async function runAsk(input: AskInput, client = new DeepSeekClient()): Promise<AskResult> {
  if (!client.isConfigured) throw new AskUnavailableError('LLM_NOT_CONFIGURED');
  const raw = await client.completeJson<{ question?: unknown }>({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildAskPrompt(input) }],
    temperature: 0.8,
    maxTokens: 4000,
  });
  const question = typeof raw.question === 'string' ? cleanQuestion(raw.question) : '';
  if (!question) throw new Error('ASK_EMPTY');
  return { question };
}

export async function streamAsk(input: AskInput, handlers: StreamRunHandlers, client = new DeepSeekClient(), signal?: AbortSignal): Promise<AskResult> {
  if (!client.isConfigured) throw new AskUnavailableError('LLM_NOT_CONFIGURED');
  let raw = '';
  let shown = 0;
  await client.streamChat({
    messages: [{ role: 'system', content: STREAM_SYSTEM_PROMPT }, { role: 'user', content: buildAskPrompt(input) }],
    signal, temperature: 0.8, maxTokens: 1000,
    onThinking: handlers.onThinking,
    onContent: (chunk) => {
      raw += chunk;
      const visible = raw.replace(/^[\s"“「『]+/, '').replace(/^(问|问题)[：:]\s*/, '').split(/\n/)[0].slice(0, ASK_MAX_CHARS);
      if (visible.length > shown) { handlers.onText(visible.slice(shown)); shown = visible.length; }
    },
  });
  const question = cleanQuestion(raw);
  if (!question) throw new Error('ASK_EMPTY');
  return { question };
}
