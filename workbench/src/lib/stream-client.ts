import { readSse } from './sse';

export const STREAM_IDLE_MS = 60_000;

export interface StreamCallbacks<T> {
  onText?: (text: string) => void;
  onThinking?: () => void;
  onDone?: (result: T) => void;
}

export type StreamOutcome<T> =
  | { status: 'done'; result: T }
  | { status: 'aborted' }
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * 发起一次流式请求并解析 SSE。
 * 只要持续有数据就不会超时，idleMs 内没有任何数据才判定失败。
 */
export async function streamRequest<T>(
  url: string,
  payload: unknown,
  callbacks: StreamCallbacks<T>,
  options: { signal: AbortSignal; idleMs?: number; fallbackMessage: string },
): Promise<StreamOutcome<T>> {
  const idleMs = options.idleMs ?? STREAM_IDLE_MS;
  const inner = new AbortController();
  const forward = () => inner.abort();
  if (options.signal.aborted) return { status: 'aborted' };
  options.signal.addEventListener('abort', forward, { once: true });
  let idled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { idled = true; inner.abort(); }, idleMs); };
  let result: T | null = null;
  let failure = '';
  try {
    touch();
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload), signal: inner.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { status: 'error', message: body.message || options.fallbackMessage };
    }
    await readSse(response, (message) => {
      let data: Record<string, unknown> = {};
      try { data = message.data ? JSON.parse(message.data) : {}; } catch { return; }
      if (message.event === 'text' && typeof data.text === 'string') callbacks.onText?.(data.text);
      else if (message.event === 'thinking') callbacks.onThinking?.();
      else if (message.event === 'done') { result = data as T; callbacks.onDone?.(result); }
      else if (message.event === 'error') failure = typeof data.message === 'string' ? data.message : options.fallbackMessage;
    }, touch);
    if (failure) return { status: 'error', message: failure };
    if (!result) return { status: 'error', message: options.fallbackMessage };
    return { status: 'done', result };
  } catch (reason) {
    if (idled) return { status: 'idle' };
    if (options.signal.aborted) return { status: 'aborted' };
    return { status: 'error', message: reason instanceof Error && reason.name !== 'TypeError' && reason.name !== 'SyntaxError' ? reason.message : '服务未启动或连接中断，笔记没有受到影响。' };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal.removeEventListener('abort', forward);
  }
}
