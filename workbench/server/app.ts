import Fastify from 'fastify';
import { AnalysisService } from '../vendor/epn/server/services/AnalysisService';
import { MusicMetadataService, type ResolveTrackMetadataInput } from '../vendor/epn/server/services/MusicMetadataService';
import { serverEnv } from '../vendor/epn/server/config/env';
import type { AnalysisResult } from '../src/types';

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
        bars: contract.data.bars.map((bar) => ({ energy: bar.energy ?? 0, tension: bar.tension ?? 0 })),
        insights: source === 'rules' ? [] : contract.data.insights.map((insight) => ({ title: insight.title, body: insight.body })),
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
  app.setErrorHandler((error, _request, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ message: status === 400 ? '分析输入格式不正确，请检查歌词长度。' : status === 413 ? '请求内容过大。' : '分析服务暂时不可用，你的笔记不受影响。' });
  });
  return app;
}
