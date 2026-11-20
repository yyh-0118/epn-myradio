export interface SseMessage { event: string; data: string }

/** 增量解析 SSE：feed 任意切分的文本块，返回已完整到达的消息；以冒号开头的注释行（心跳）会被忽略。 */
export function createSseParser() {
  let buffer = '';
  return {
    feed(chunk: string): SseMessage[] {
      buffer += chunk.replace(/\r\n/g, '\n');
      const messages: SseMessage[] = [];
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length || event !== 'message') messages.push({ event, data: data.join('\n') });
      }
      return messages;
    },
  };
}

export async function readSse(response: Response, onMessage: (message: SseMessage) => void, onActivity?: () => void) {
  if (!response.body) throw new Error('服务没有返回内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity?.();
    for (const message of parser.feed(decoder.decode(value, { stream: true }))) onMessage(message);
  }
  for (const message of parser.feed(decoder.decode() + '\n\n')) onMessage(message);
}
