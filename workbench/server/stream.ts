import { DeepSeekClient } from '../vendor/epn/server/services/DeepSeekClient';

export const DATA_DELIMITER = '===DATA===';

/** 把模型流式输出拆成「逐字显示的正文」和「分隔符之后的结构化数据」。分隔符可能被切成两半到达。 */
export function createProseSplitter(onText: (text: string) => void) {
  let full = '';
  let emitted = 0;
  let cut = -1;
  let jsonMode = false;
  return {
    push(chunk: string) {
      full += chunk;
      if (jsonMode) return;
      if (cut < 0 && full.trimStart().startsWith('{')) { jsonMode = true; return; }
      if (cut < 0) cut = full.indexOf(DATA_DELIMITER);
      if (cut >= 0 && emitted >= cut) return;
      const limit = cut >= 0 ? cut : Math.max(emitted, full.length - (DATA_DELIMITER.length - 1));
      if (limit > emitted) { onText(full.slice(emitted, limit)); emitted = limit; }
    },
    finish(): { prose: string; data: string; jsonOnly: boolean } {
      const idx = full.indexOf(DATA_DELIMITER);
      if (idx >= 0) {
        if (emitted < idx) { onText(full.slice(emitted, idx)); emitted = idx; }
        return { prose: full.slice(0, idx).trim(), data: full.slice(idx + DATA_DELIMITER.length), jsonOnly: false };
      }
      if (jsonMode) return { prose: '', data: full, jsonOnly: true };
      if (emitted < full.length) { onText(full.slice(emitted)); emitted = full.length; }
      return { prose: full.trim(), data: '', jsonOnly: false };
    },
  };
}

export function parseJsonLoose<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null;
  } catch { return null; }
}

export interface StreamRunHandlers { onText: (text: string) => void; onThinking?: () => void }

/** 一次流式调用的公共部分：返回完整正文、尾部数据与结束原因。 */
export async function runProseStream(
  client: DeepSeekClient,
  args: { system: string; user: string; temperature: number; maxTokens: number; signal?: AbortSignal; disableThinking?: boolean },
  handlers: StreamRunHandlers,
) {
  const splitter = createProseSplitter(handlers.onText);
  const { finishReason } = await client.streamChat({
    messages: [{ role: 'system', content: args.system }, { role: 'user', content: args.user }],
    signal: args.signal,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    disableThinking: args.disableThinking,
    onContent: (chunk) => splitter.push(chunk),
    onThinking: handlers.onThinking,
  });
  return { ...splitter.finish(), finishReason };
}
