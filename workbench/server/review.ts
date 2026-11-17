import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';
import type { ReviewNoteInput, ReviewResult } from '../src/types';

export const REVIEW_MAX_NOTES = 60;
export const REVIEW_MAX_TOTAL_CHARS = 30000;

const SYSTEM_PROMPT = [
  '你是用户长期陪伴的一位朋友，正在读他在听歌时随手写下的笔记，帮他回顾和整理。',
  '语气：温和、直接、像认真读过他笔记的朋友；不说教，不堆砌套话，不使用心理诊断式措辞。',
  '严格规则：',
  '1. 只依据下方提供的笔记作答，不编造没有写过的经历、人物或事件。',
  '2. 每条主题必须通过 noteIds 引用对应笔记编号（如 N1、N3），编号只能来自输入。',
  '3. 如果笔记太少或太零散，如实说明“目前能看出的有限”，不要硬凑主题。',
  '4. 可以指出反复出现的情绪、歌曲、歌词句子、时间规律，但要表述为“看起来”“似乎”，不下定论。',
  '5. 如果笔记中出现明显的自伤或绝望迹象，用关心的口吻建议他联系身边可信任的人或当地的危机援助渠道，不要回避。',
  '只输出一个 JSON 对象，不要任何额外文字，结构如下：',
  '{"overview":"2-4 句整体回顾","themes":[{"title":"主题名，12 字以内","body":"2-3 句，说明你看到了什么","noteIds":["N1"]}],"question":"一个值得他接着想的问题，1 句"}',
  'themes 给 2 到 4 个。',
].join('\n');

export interface ReviewRunInput { notes: ReviewNoteInput[]; focus?: string }

export class ReviewUnavailableError extends Error {}

export async function runReview(input: ReviewRunInput, client = new DeepSeekClient()): Promise<ReviewResult> {
  if (!client.isConfigured) throw new ReviewUnavailableError('LLM_NOT_CONFIGURED');
  const notes = input.notes.slice(0, REVIEW_MAX_NOTES);
  const labelToId = new Map<string, string>();
  const lines: string[] = [];
  notes.forEach((note, index) => {
    const label = `N${index + 1}`;
    labelToId.set(label, note.id);
    const head = [label, note.createdAt.slice(0, 16).replace('T', ' '), `《${note.trackTitle || '未知曲目'}》${note.artist ? ` - ${note.artist}` : ''}`].join(' | ');
    lines.push(`${head}${note.quote ? `\n歌词：${note.quote}` : ''}${note.title ? `\n标题：${note.title}` : ''}\n笔记：${note.body}`);
  });
  const userContent = `${input.focus ? `他这次想关注的是：${input.focus}\n\n` : ''}以下是 ${notes.length} 条笔记（由新到旧）：\n\n${lines.join('\n\n---\n\n')}`;
  const raw = await client.completeJson<{ overview?: unknown; themes?: unknown; question?: unknown }>({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
    temperature: 0.5,
    maxTokens: 8000,
  });
  const themes: ReviewResult['themes'] = [];
  const dropped: string[] = [];
  for (const item of Array.isArray(raw.themes) ? raw.themes : []) {
    if (!item || typeof item !== 'object') continue;
    const theme = item as { title?: unknown; body?: unknown; noteIds?: unknown };
    const title = typeof theme.title === 'string' ? theme.title.trim().slice(0, 60) : '';
    const body = typeof theme.body === 'string' ? theme.body.trim().slice(0, 800) : '';
    const refs = [...new Set((Array.isArray(theme.noteIds) ? theme.noteIds : []).map((value) => labelToId.get(String(value).trim().toUpperCase())).filter((value): value is string => Boolean(value)))];
    if (!title || !body) continue;
    if (!refs.length) { dropped.push(title); continue; }
    themes.push({ title, body, noteIds: refs.slice(0, 12) });
  }
  const overview = typeof raw.overview === 'string' ? raw.overview.trim().slice(0, 1200) : '';
  if (!overview && !themes.length) throw new Error('REVIEW_EMPTY');
  return {
    overview,
    themes: themes.slice(0, 4),
    question: typeof raw.question === 'string' ? raw.question.trim().slice(0, 300) : '',
    noteCount: notes.length,
    warnings: dropped.length ? [`已丢弃 ${dropped.length} 个无法对应到你笔记的主题。`] : [],
  };
}
