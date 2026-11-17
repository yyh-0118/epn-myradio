import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { AskInput, AskResult } from '../src/types';

export class AskUnavailableError extends Error {}

const SYSTEM_PROMPT = [
  '你是用户的一位老朋友。他在听歌时被某一刻打动，正准备写几句随笔，你要问他一个问题，帮他开口。',
  '要求：',
  '1. 只问一个问题，一句话，不超过 40 个字，用口语。',
  '2. 问他的感受、想起的人或事、此刻的处境，而不是分析歌词的修辞或韵脚。',
  '3. 不暗示答案，不替他下结论，不给建议，不说教，不用“请问”“您”之类的客套。',
  '4. 如果他已经写了草稿，就顺着草稿里最有分量的一处往下问，不要重复他已经写出来的内容。',
  '5. 如果他以前在这首歌下写过笔记，可以自然地呼应，但只能引用给出的内容，不编造经历。',
  '6. 没有歌词时，就问这段声音带给他什么。',
  '只输出一个 JSON 对象，不要任何额外文字：{"question":"你的问题"}',
].join('\n');

export async function runAsk(input: AskInput, client = new DeepSeekClient()): Promise<AskResult> {
  if (!client.isConfigured) throw new AskUnavailableError('LLM_NOT_CONFIGURED');
  const parts: string[] = [`歌曲：《${input.track.title || '未知曲目'}》${input.track.artist ? ` - ${input.track.artist}` : ''}`];
  if (input.quote) parts.push(`他被打动的这一句：${input.quote}`);
  if (input.context?.length) parts.push(`前后的歌词：\n${input.context.join('\n')}`);
  if (input.earlier?.length) parts.push(`他以前在这首歌下写过：\n${input.earlier.map((note, index) => `${index + 1}. [${note.createdAt.slice(0, 10)}] ${note.body}`).join('\n')}`);
  parts.push(input.draft?.trim() ? `他现在写的草稿：\n${input.draft.trim()}` : '他还没有开始写。');
  const raw = await client.completeJson<{ question?: unknown }>({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: parts.join('\n\n') }],
    temperature: 0.8,
    maxTokens: 4000,
  });
  const question = typeof raw.question === 'string' ? raw.question.trim().replace(/^["“「]+|["”」]+$/g, '').slice(0, 120) : '';
  if (!question) throw new Error('ASK_EMPTY');
  return { question };
}
