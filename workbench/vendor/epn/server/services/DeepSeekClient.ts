import { serverEnv } from "../config/env";

export type LlmChatRole = "system" | "user" | "assistant";

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string;
}

export interface DeepSeekCompleteJsonInput {
  messages: LlmChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** 结构化 JSON 任务不需要推理；推理模型会把输出额度耗尽而正文为空。仅对 DeepSeek 官方接口生效。 */
  disableThinking?: boolean;
  /** 本次请求的总时长上限；默认 45 秒。 */
  timeoutMs?: number;
}

export interface DeepSeekStreamTextInput {
  messages: LlmChatMessage[];
  signal: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  onContent: (content: string) => void;
}

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
}

interface DeepSeekStreamChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
}

export interface DeepSeekStreamChatInput {
  messages: LlmChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  idleTimeoutMs?: number;
  /** 轻量的结构化任务不需要推理，关掉可以更快出字。仅对 DeepSeek 官方接口生效。 */
  disableThinking?: boolean;
  onContent: (content: string) => void;
  onThinking?: () => void;
}

export class DeepSeekClient {
  get isConfigured(): boolean {
    return Boolean(serverEnv.llmApiUrl && serverEnv.llmModel);
  }

  /**
   * 流式对话：只要上游持续有分片就不会超时，idleTimeoutMs 内没有任何分片才判定失败。
   * 推理模型的思考阶段通过 onThinking 通知，正文通过 onContent 逐段回调。
   */
  async streamChat(input: DeepSeekStreamChatInput): Promise<{ finishReason: string | null }> {
    const idleMs = input.idleTimeoutMs ?? 60_000;
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => idle.abort(new Error("LLM 长时间没有返回内容，已中止。")), idleMs);
    };
    const signal = input.signal ? AbortSignal.any([input.signal, idle.signal]) : idle.signal;
    arm();
    let finishReason: string | null = null;
    try {
      const response = await this.postRawCompletion({
        messages: input.messages,
        signal,
        stream: true,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        noTimeout: true,
        disableThinking: input.disableThinking,
      });
      if (!response.body) throw new Error("LLM stream response body is empty.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let thinking = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const chunk = parseStreamChunk(line);
          if (chunk === "done") return { finishReason };
          if (!chunk) continue;
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (choice?.delta?.reasoning_content && !thinking) { thinking = true; input.onThinking?.(); }
          const content = choice?.delta?.content;
          if (content) input.onContent(content);
        }
      }
      return { finishReason };
    } catch (error) {
      if (idle.signal.aborted && !input.signal?.aborted) {
        throw idle.signal.reason instanceof Error ? idle.signal.reason : new Error("LLM 长时间没有返回内容，已中止。");
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async completeJson<TJson>(input: DeepSeekCompleteJsonInput): Promise<TJson> {
    const response = await this.postCompletion<DeepSeekChatCompletionResponse>({
      messages: input.messages,
      signal: input.signal,
      stream: false,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      disableThinking: input.disableThinking,
      timeoutMs: input.timeoutMs,
      responseFormat: {
        type: "json_object",
      },
    });
    const choice = response.choices?.[0];
    const content = choice?.message?.content?.trim();

    if (!content) {
      throw new Error("LLM JSON response is empty.");
    }

    if (choice?.finish_reason === "length") {
      throw new Error("LLM JSON response was truncated by max_tokens.");
    }

    return parseJsonContent<TJson>(content);
  }

  async streamText(input: DeepSeekStreamTextInput): Promise<void> {
    const response = await this.postRawCompletion({
      messages: input.messages,
      signal: input.signal,
      stream: true,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });

    if (!response.body) {
      throw new Error("LLM stream response body is empty.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done || input.signal.aborted) {
        break;
      }

      buffer += decoder.decode(value, {
        stream: true,
      });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const content = parseStreamLine(line);

        if (content === null) {
          continue;
        }

        if (content === "[DONE]") {
          return;
        }

        input.onContent(content);
      }
    }
  }

  private async postCompletion<TResponse>(input: {
    messages: LlmChatMessage[];
    signal?: AbortSignal;
    stream: boolean;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
    disableThinking?: boolean;
    timeoutMs?: number;
  }): Promise<TResponse> {
    const response = await this.postRawCompletion(input);

    return (await response.json()) as TResponse;
  }

  private async postRawCompletion(input: {
    messages: LlmChatMessage[];
    signal?: AbortSignal;
    stream: boolean;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
    noTimeout?: boolean;
    disableThinking?: boolean;
    timeoutMs?: number;
  }): Promise<Response> {
    this.assertConfigured();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (serverEnv.llmApiKey) {
      headers.Authorization = `Bearer ${serverEnv.llmApiKey}`;
    }

    const timeoutMs = input.timeoutMs ?? 45_000;
    const signal = input.noTimeout
      ? input.signal
      : input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

    const response = await fetch(serverEnv.llmApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: serverEnv.llmModel,
        messages: input.messages,
        stream: input.stream,
        temperature: input.temperature ?? serverEnv.llmTemperature,
        max_tokens: input.maxTokens ?? serverEnv.llmMaxTokens,
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
        ...(input.disableThinking && isDeepSeekHost(serverEnv.llmApiUrl) ? { thinking: { type: "disabled" } } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const errorMessage = await readLlmErrorMessage(response);

      throw new Error(`LLM \u8BF7\u6C42\u5931\u8D25\uFF1A${response.status} ${errorMessage}`);
    }

    return response;
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new Error("LLM \u914D\u7F6E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u68C0\u67E5 LLM_PROXY_URL\u3001LLM_API_URL \u548C LLM_MODEL\u3002");
    }
  }
}

function isDeepSeekHost(url: string): boolean {
  try { return new URL(url).hostname.endsWith("deepseek.com"); } catch { return false; }
}

function parseStreamChunk(line: string): DeepSeekStreamChunk | "done" | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data) return null;
  if (data === "[DONE]") return "done";
  try {
    return JSON.parse(data) as DeepSeekStreamChunk;
  } catch {
    return null;
  }
}

function parseStreamLine(line: string): string | null {
  const trimmedLine = line.trim();

  if (!trimmedLine.startsWith("data:")) {
    return null;
  }

  const data = trimmedLine.slice(5).trim();

  if (!data) {
    return null;
  }

  if (data === "[DONE]") {
    return "[DONE]";
  }

  const parsed = JSON.parse(data) as DeepSeekStreamChunk;

  return parsed.choices?.[0]?.delta?.content ?? null;
}

function parseJsonContent<TJson>(content: string): TJson {
  const normalizedContent = stripJsonFence(content);

  try {
    return JSON.parse(normalizedContent) as TJson;
  } catch {
    const startIndex = normalizedContent.indexOf("{");
    const endIndex = normalizedContent.lastIndexOf("}");

    if (startIndex >= 0 && endIndex > startIndex) {
      return JSON.parse(normalizedContent.slice(startIndex, endIndex + 1)) as TJson;
    }

    throw new Error("LLM JSON response is not valid JSON.");
  }
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function readLlmErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  const normalizedBody = body.trim();

  if (!normalizedBody) {
    return mapLlmErrorMessage(response.status, "", response.statusText);
  }

  const extractedMessage = extractLlmErrorMessage(normalizedBody);

  return mapLlmErrorMessage(
    response.status,
    extractedMessage || normalizedBody,
    response.statusText,
  );
}

function extractLlmErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        code?: unknown;
      };
      message?: unknown;
      detail?: unknown;
    };

    const candidates = [parsed.error?.message, parsed.message, parsed.detail];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // Ignore JSON parsing errors and fall back to the raw body below.
  }

  return body.slice(0, 500);
}

function mapLlmErrorMessage(
  status: number,
  rawMessage: string,
  statusText: string,
): string {
  const normalizedMessage = rawMessage.trim();
  const lowerMessage = normalizedMessage.toLowerCase();

  if (
    status === 402 ||
    lowerMessage.includes("insufficient balance") ||
    lowerMessage.includes("balance insufficient")
  ) {
    return "\u6A21\u578B\u8D26\u6237\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u68C0\u67E5 API Key \u6216\u5145\u503C\u540E\u91CD\u8BD5\u3002";
  }

  if (
    status === 401 ||
    lowerMessage.includes("invalid api key") ||
    lowerMessage.includes("unauthorized")
  ) {
    return "API Key \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u68C0\u67E5\u5BC6\u94A5\u914D\u7F6E\u3002";
  }

  if (
    status === 403 ||
    lowerMessage.includes("forbidden") ||
    lowerMessage.includes("not allowed")
  ) {
    return "\u5F53\u524D API Key \u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u8BE5\u6A21\u578B\uFF0C\u8BF7\u68C0\u67E5\u6743\u9650\u914D\u7F6E\u3002";
  }

  if (
    status === 404 ||
    lowerMessage.includes("model not found") ||
    lowerMessage.includes("not found")
  ) {
    return "\u6A21\u578B\u4E0D\u5B58\u5728\u6216\u540D\u79F0\u914D\u7F6E\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5 LLM_MODEL\u3002";
  }

  if (
    status === 429 ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests")
  ) {
    return "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002";
  }

  if (status >= 500) {
    return `\u4E0A\u6E38\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uff08${status}\uff09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002`;
  }

  return normalizedMessage || statusText || "\u672A\u77E5\u9519\u8BEF\u3002";
}