import Fastify from 'fastify';
import { AnalysisService } from '../vendor/epn/server/services/AnalysisService';
import { MusicMetadataService, type ResolveTrackMetadataInput } from '../vendor/epn/server/services/MusicMetadataService';
import { serverEnv } from '../vendor/epn/server/config/env';
import type { AnalysisResult, AskInput, PolishInput, ReadingInput, TasteInput } from '../src/types';
import type { FastifyReply } from 'fastify';
import { toBarViews, toInsightViews } from './analysis-view';
import { AskUnavailableError, runAsk, streamAsk } from './ask';
import { POLISH_MAX_CHARS, PolishUnavailableError, streamPolish } from './polish';
import { TasteUnavailableError, runTaste, streamTaste } from './taste';
import { READING_MAX_LINES, ReadingUnavailableError, streamReading } from './reading';
import { REVIEW_MAX_NOTES, REVIEW_MAX_TOTAL_CHARS, ReviewUnavailableError, runReview, streamReview } from './review';

class LocalMetadataService extends MusicMetadataService {
  override resolveTrackMetadata(input: ResolveTrackMetadataInput) {
    return super.resolveTrackMetadata({ ...input, allowRemoteLookup: false });
  }
}

export function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  const service = new AnalysisService(new LocalMetadataService());
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;
  app.addHook('onRequest', async (request, reply) => {
    const expectedToken = process.env.AFTERGLOW_SIDECAR_TOKEN;
    if (expectedToken && request.headers['x-afterglow-token'] !== expectedToken) {
      return reply.code(401).send({ message: '分析服务认证失败。' });
    }
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const origin = request.headers.origin;
    if (origin && !['http://127.0.0.1:5178', 'http://localhost:5178', 'http://127.0.0.1:3108', 'http://localhost:3108'].includes(origin)) {
      return reply.code(403).send({ message: '仅允许从本地工作台发起请求。' });
    }
  });
  app.get('/api/health', async () => ({
    ok: true,
    service: 'afterglow-analysis',
    version: '0.1.0',
    pid: process.pid,
    uptime: process.uptime(),
    llmEnabled: Boolean(serverEnv.useRealLlm && serverEnv.llmApiUrl && serverEnv.llmModel),
  }));
  app.post<{ Body: { rawLyrics: string; track?: { title?: string; artist?: string } } }>('/api/analysis/run', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['rawLyrics'],
        properties: {
          rawLyrics: { type: 'string', minLength: 1, maxLength: 12000 },
          track: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', maxLength: 120 }, artist: { type: 'string', maxLength: 120 } } },
        },
      },
    },
  }, async (request, reply) => {
    const rawLyrics = request.body.rawLyrics.trim();
    if (!rawLyrics || rawLyrics.split(/\r?\n/).filter((line) => line.trim()).length > 200) {
      return reply.code(400).send({ message: '请输入 1–200 行、12,000 字以内的歌词。' });
    }
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || active >= 2) return reply.code(429).send({ message: '分析请求较多，请稍后重试。' });
    requests++; active++;
    try {
      const result = await service.analyzeLyrics({ rawLyrics, locale: 'zh-CN', track: request.body.track });
      const contract = result.node.contract;
      const rhyme = contract.data.extensions.rhymeAnalysis;
      const source = contract.extensions.llmProvider === 'heuristic' ? 'rules' : contract.data.extensions.rhymeAdjudication?.source === 'candidate-scanner' ? 'llm-rules-fallback' : 'hybrid';
      const response: AnalysisResult = {
        source,
        lines: contract.source.lyrics.lines.map((line) => line.text),
        units: (rhyme?.units || []).map((unit) => ({
          lineIndex: unit.lineIndex ?? -1, text: unit.text || '', start: unit.startChar ?? -1, end: unit.endChar ?? -1,
          group: unit.rhymeGroupId || 'unassigned', label: unit.rhymeLabel || unit.phoneticKey || '候选',
          note: unit.note || '', confidence: unit.confidence ?? null,
        })),
        groups: (rhyme?.groups || []).map((group) => ({ id: group.id || '', label: group.label || '候选韵组', description: group.description || '' })),
        metrics: { energy: result.vibeVector.energy, melancholy: result.vibeVector.melancholy, narrativeTension: result.vibeVector.narrativeTension },
        bars: toBarViews(contract.data.bars, source !== 'rules'),
        insights: source === 'rules' ? [] : toInsightViews(contract.data.insights, contract.source.lyrics.lines.length),
        warnings: [
          ...(source === 'rules' ? ['当前使用 EPN 规则结果，未获得有效 LLM 输出。'] : []),
          ...(source === 'llm-rules-fallback' ? ['模型参与了分析，但韵脚采用规则回退结果。'] : []),
          '音韵候选需结合实际发音复核；情绪指标是文本推断，不是音频测量或心理判断。',
        ],
        steps: contract.pipeline.executions.map((step) => ({ kind: step.kind, status: step.status })),
      };
      return response;
    } finally { active--; }
  });
  type ReviewBody = { notes: { id: string; title: string; body: string; quote: string; trackTitle: string; artist: string; createdAt: string }[]; focus?: string };
  const reviewSchema = {
    body: {
      type: 'object', additionalProperties: false, required: ['notes'],
      properties: {
        focus: { type: 'string', maxLength: 200 },
        notes: {
          type: 'array', minItems: 1, maxItems: REVIEW_MAX_NOTES,
          items: {
            type: 'object', additionalProperties: false, required: ['id', 'body', 'createdAt'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 80 }, title: { type: 'string', maxLength: 200, default: '' },
              body: { type: 'string', minLength: 1, maxLength: 4000 }, quote: { type: 'string', maxLength: 400, default: '' },
              trackTitle: { type: 'string', maxLength: 160, default: '' }, artist: { type: 'string', maxLength: 160, default: '' },
              createdAt: { type: 'string', minLength: 1, maxLength: 40 },
            },
          },
        },
      },
    },
  };
  const llmErrorText = (error: unknown, fallback: string) => {
    const text = error instanceof Error ? error.message : '';
    return /^LLM |API Key|余额|模型|请求过于频繁|上游服务/.test(text) ? text : fallback;
  };
  /** 统一的 SSE 流式端点：限流、断开即中止、心跳、错误事件。 */
  async function streamEndpoint(
    reply: FastifyReply,
    run: (handlers: { onText: (text: string) => void; onThinking: () => void }, signal: AbortSignal) => Promise<unknown>,
    errors: { unavailable: (error: unknown) => boolean; notConfigured: string; failed: string; map?: (error: unknown) => string | null },
  ) {
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || active >= 2) return reply.code(429).send({ message: '请求较多，请稍后重试。' });
    requests++; active++;
    const abort = new AbortController();
    const raw = reply.raw;
    raw.on('close', () => { if (!raw.writableEnded) abort.abort(); });
    reply.hijack();
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => { if (!raw.writableEnded && !raw.destroyed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const heartbeat = setInterval(() => { if (!raw.writableEnded && !raw.destroyed) raw.write(': ping\n\n'); }, 10_000);
    try {
      send('start', { ok: true });
      const result = await run({ onText: (text) => send('text', { text }), onThinking: () => send('thinking', {}) }, abort.signal);
      send('done', result);
    } catch (error) {
      if (!abort.signal.aborted) {
        if (errors.unavailable(error)) send('error', { code: 'LLM_NOT_CONFIGURED', message: errors.notConfigured });
        else send('error', { code: 'LLM_FAILED', message: errors.map?.(error) ?? llmErrorText(error, errors.failed) });
      }
    } finally {
      clearInterval(heartbeat);
      active--;
      if (!raw.writableEnded) raw.end();
    }
  }
  app.post<{ Body: ReviewBody }>('/api/review/stream', { bodyLimit: 256 * 1024, schema: reviewSchema }, async (request, reply) => {
    const total = request.body.notes.reduce((sum, note) => sum + note.body.length + (note.title?.length || 0) + (note.quote?.length || 0), 0);
    if (total > REVIEW_MAX_TOTAL_CHARS) return reply.code(413).send({ message: '选中的笔记太长，请缩小时间范围。' });
    return streamEndpoint(reply, (handlers, signal) => streamReview({ notes: request.body.notes, focus: request.body.focus?.trim() || undefined }, handlers, undefined, signal), {
      unavailable: (error) => error instanceof ReviewUnavailableError,
      notConfigured: '还没有配置模型。请先配置 LLM，详见回顾页的提示。',
      failed: '回顾生成失败，请稍后重试。你的笔记没有受到影响。',
    });
  });
  app.post<{ Body: ReviewBody }>('/api/review/run', {
    bodyLimit: 256 * 1024,
    schema: reviewSchema,
  }, async (request, reply) => {
    const total = request.body.notes.reduce((sum, note) => sum + note.body.length + (note.title?.length || 0) + (note.quote?.length || 0), 0);
    if (total > REVIEW_MAX_TOTAL_CHARS) return reply.code(413).send({ message: '选中的笔记太长，请缩小时间范围。' });
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || active >= 2) return reply.code(429).send({ message: '请求较多，请稍后重试。' });
    requests++; active++;
    try {
      return await runReview({ notes: request.body.notes, focus: request.body.focus?.trim() || undefined });
    } catch (error) {
      if (error instanceof ReviewUnavailableError) return reply.code(503).send({ code: 'LLM_NOT_CONFIGURED', message: '还没有配置模型。请先配置 LLM，详见回顾页的提示。' });
      const text = error instanceof Error ? error.message : '';
      return reply.code(502).send({ code: 'LLM_FAILED', message: /^LLM |API Key|余额|模型|请求过于频繁|上游服务/.test(text) ? text : '回顾生成失败，请稍后重试。你的笔记没有受到影响。' });
    } finally { active--; }
  });
  const askSchema = {
      body: {
        type: 'object', additionalProperties: false, required: ['track'],
        properties: {
          track: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: 160 }, artist: { type: 'string', maxLength: 160, default: '' } } },
          position: { type: 'object', additionalProperties: false, properties: { seconds: { type: 'number', minimum: 0, maximum: 36000 }, section: { type: 'string', maxLength: 40 } } },
          quote: { type: 'string', maxLength: 400, default: '' },
          context: { type: 'array', maxItems: 6, default: [], items: { type: 'string', maxLength: 200 } },
          draft: { type: 'string', maxLength: 3000, default: '' },
          earlier: { type: 'array', maxItems: 3, default: [], items: { type: 'object', additionalProperties: false, required: ['body', 'createdAt'], properties: { body: { type: 'string', maxLength: 400 }, createdAt: { type: 'string', maxLength: 40 } } } },
        },
      },
  };
  app.post<{ Body: AskInput }>('/api/ask/stream', { bodyLimit: 64 * 1024, schema: askSchema }, async (request, reply) => streamEndpoint(
    reply, (handlers, signal) => streamAsk(request.body, handlers, undefined, signal), {
      unavailable: (error) => error instanceof AskUnavailableError,
      notConfigured: '还没有配置模型，暂时不能提问。',
      failed: '这次没问出来，稍后再试。你的笔记没有受到影响。',
    }));
  app.post<{ Body: PolishInput }>('/api/polish/stream', {
    bodyLimit: 64 * 1024,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['track', 'draft'],
        properties: {
          track: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: 160 }, artist: { type: 'string', maxLength: 160, default: '' } } },
          quote: { type: 'string', maxLength: 400, default: '' },
          draft: { type: 'string', minLength: 1, maxLength: POLISH_MAX_CHARS },
        },
      },
    },
  }, async (request, reply) => streamEndpoint(
    reply, (handlers, signal) => streamPolish(request.body, handlers, undefined, signal), {
      unavailable: (error) => error instanceof PolishUnavailableError,
      notConfigured: '还没有配置模型，暂时不能整理。',
      failed: '这次没整理出来，稍后再试。你的原文没有受到影响。',
      map: (error) => error instanceof Error && error.message === 'POLISH_TOO_SHORT' ? '写得还不够多，再写几句再来整理吧。' : null,
    }));
  app.post<{ Body: AskInput }>('/api/ask/run', {
    bodyLimit: 64 * 1024,
    schema: askSchema,
  }, async (request, reply) => {
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || active >= 2) return reply.code(429).send({ message: '请求较多，请稍后重试。' });
    requests++; active++;
    try {
      return await runAsk(request.body);
    } catch (error) {
      if (error instanceof AskUnavailableError) return reply.code(503).send({ code: 'LLM_NOT_CONFIGURED', message: '还没有配置模型，暂时不能提问。' });
      const text = error instanceof Error ? error.message : '';
      return reply.code(502).send({ code: 'LLM_FAILED', message: /^LLM |API Key|余额|模型|请求过于频繁|上游服务/.test(text) ? text : '这次没问出来，稍后再试。你的笔记没有受到影响。' });
    } finally { active--; }
  });
  const tasteSchema = {
      body: {
        type: 'object', additionalProperties: false, required: ['totalMinutes', 'sessions', 'topSongs', 'topArtists', 'byHour', 'last14Days', 'recent'],
        properties: {
          totalMinutes: { type: 'number', minimum: 0 }, sessions: { type: 'number', minimum: 0 },
          topSongs: { type: 'array', maxItems: 15, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, artist: { type: 'string', maxLength: 100, default: '' }, plays: { type: 'number', default: 0 }, minutes: { type: 'number', default: 0 } } } },
          topArtists: { type: 'array', maxItems: 12, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, plays: { type: 'number', default: 0 }, minutes: { type: 'number', default: 0 } } } },
          byHour: { type: 'array', minItems: 24, maxItems: 24, items: { type: 'number', minimum: 0 } },
          last14Days: { type: 'array', maxItems: 14, items: { type: 'object', required: ['date'], properties: { date: { type: 'string', maxLength: 12 }, minutes: { type: 'number', default: 0 } } } },
          recent: { type: 'array', maxItems: 40, items: { type: 'object', required: ['name', 'at'], properties: { name: { type: 'string', maxLength: 100 }, artist: { type: 'string', maxLength: 100, default: '' }, at: { type: 'string', maxLength: 20 }, listenMin: { type: 'number', default: 0 }, completed: { type: 'boolean', default: false } } } },
          nightSongs: { type: 'array', maxItems: 6, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, artist: { type: 'string', maxLength: 100, default: '' }, nightDays: { type: 'number', default: 0 }, nights: { type: 'number', default: 0 }, minutes: { type: 'number', default: 0 }, plays: { type: 'number', default: 0 } } } },
          notes: { type: 'object', additionalProperties: false, properties: {
            totalNotes: { type: 'number', minimum: 0, default: 0 },
            mostWritten: { type: 'array', maxItems: 6, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, artist: { type: 'string', maxLength: 100, default: '' }, notes: { type: 'number', default: 0 }, plays: { type: 'number', default: 0 }, minutes: { type: 'number', default: 0 } } } },
            listenedNotWritten: { type: 'array', maxItems: 6, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, artist: { type: 'string', maxLength: 100, default: '' }, plays: { type: 'number', default: 0 }, minutes: { type: 'number', default: 0 } } } },
          } },
        },
      },
  };
  app.post<{ Body: TasteInput }>('/api/taste/stream', { bodyLimit: 64 * 1024, schema: tasteSchema }, async (request, reply) => streamEndpoint(
    reply, (handlers, signal) => streamTaste(request.body, handlers, undefined, signal), {
      unavailable: (error) => error instanceof TasteUnavailableError,
      notConfigured: '还没有配置模型，暂时不能分析。',
      failed: '这次没分析出来，稍后再试。',
    }));
  app.post<{ Body: TasteInput }>('/api/taste/run', {
    bodyLimit: 64 * 1024,
    schema: tasteSchema,
  }, async (request, reply) => {
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || active >= 2) return reply.code(429).send({ message: '请求较多，请稍后重试。' });
    requests++; active++;
    try {
      return await runTaste(request.body);
    } catch (error) {
      if (error instanceof TasteUnavailableError) return reply.code(503).send({ code: 'LLM_NOT_CONFIGURED', message: '还没有配置模型，暂时不能分析。' });
      const text = error instanceof Error ? error.message : '';
      return reply.code(502).send({ code: 'LLM_FAILED', message: /^LLM |API Key|余额|模型|请求过于频繁|上游服务/.test(text) ? text : '这次没分析出来，稍后再试。' });
    } finally { active--; }
  });
  app.post<{ Body: ReadingInput }>('/api/reading/stream', {
    bodyLimit: 128 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['lines'], properties: {
      track: { type: 'object', additionalProperties: false, default: {}, properties: { title: { type: 'string', maxLength: 120, default: '' }, artist: { type: 'string', maxLength: 120, default: '' } } },
      lines: { type: 'array', minItems: 1, maxItems: READING_MAX_LINES, items: { type: 'string', minLength: 1, maxLength: 200 } },
    } } },
  }, async (request, reply) => {
    const total = request.body.lines.reduce((sum, line) => sum + line.length, 0);
    if (total > 12_000) return reply.code(413).send({ message: '歌词太长，暂时没法逐句解读。' });
    const track = { title: request.body.track?.title ?? '', artist: request.body.track?.artist ?? '' };
    return streamEndpoint(reply, (handlers, signal) => streamReading({ track, lines: request.body.lines }, handlers, undefined, signal), {
      unavailable: (error) => error instanceof ReadingUnavailableError,
      notConfigured: '还没有配置模型，暂时不能解读歌词。',
      failed: '这次没解读出来，稍后再试。',
    });
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ message: status === 400 ? '分析输入格式不正确，请检查歌词长度。' : status === 413 ? '请求内容过大。' : '分析服务暂时不可用，你的笔记不受影响。' });
  });
  return app;
}
