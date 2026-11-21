import { Activity, ChevronDown, Cpu, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult, RhymeUnit, Track } from '../types';

const colors = ['#bbdfce', '#d9b48c', '#b9b3de', '#8fc8d8', '#dc9eaa'];
const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const cache = new Map<string, AnalysisResult>();

function MarkedLine({ text, units, groups }: { text: string; units: RhymeUnit[]; groups: string[] }) {
  const runs: React.ReactNode[] = [];
  let cursor = 0;
  for (const unit of [...units].sort((a, b) => a.start - b.start)) {
    if (unit.start < cursor || unit.end <= unit.start || unit.end > text.length || text.slice(unit.start, unit.end) !== unit.text) continue;
    runs.push(text.slice(cursor, unit.start));
    const color = colors[Math.max(0, groups.indexOf(unit.group)) % colors.length];
    runs.push(<mark key={`${unit.start}-${unit.end}`} style={{ color, borderColor: color }} title={`${unit.label}${unit.note ? ` · ${unit.note}` : ''} · 待发音复核`}>{unit.text}</mark>);
    cursor = unit.end;
  }
  runs.push(text.slice(cursor));
  return <>{runs}</>;
}

export function AnalysisPanel({ track }: { track?: Track }) {
  const rawLyrics = track?.lyrics.map((line) => line.text.trim()).filter(Boolean).join('\n') || '';
  const key = JSON.stringify([track?.id, rawLyrics]);
  const [result, setResult] = useState<AnalysisResult | null>(cache.get(key) || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'rhyme' | 'emotion'>('rhyme');
  const [health, setHealth] = useState<{ llmEnabled: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`${apiPrefix}/health`, { signal: abort.signal }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then(setHealth).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    controller.current?.abort(); setResult(cache.get(key) || null); setBusy(false); setError('');
    return () => controller.current?.abort();
  }, [key]);
  const run = async () => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiPrefix}/analysis/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawLyrics, track: { title: track?.title, artist: track?.artist } }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(125_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '分析失败，请稍后重试。');
      if (!Array.isArray(body.lines) || !Array.isArray(body.units)) throw new Error('分析响应格式不正确。');
      if (abort.signal.aborted) return;
      cache.set(key, body);
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
      setResult(body);
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error && reason.name !== 'TimeoutError' && reason.name !== 'SyntaxError' ? reason.message : '分析超时或服务未启动。笔记仍可正常保存，请稍后重试。');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const lineCount = rawLyrics ? rawLyrics.split('\n').length : 0;
  const stop = () => { controller.current?.abort(); setBusy(false); };
  const groups = result ? [...new Set(result.units.map((unit) => unit.group))] : [];
  return <section className="analysis-panel">
    <header><div><Cpu size={17} /><strong>EPN 分析参考</strong></div><span className="engine-badge">ENGINE</span></header>
    <div className="analysis-intro"><h3>多一个理解作品的角度。</h3><p>不替你感动，也不替你下结论。</p></div>
    {!result && !busy && <div className="analysis-empty"><div className="analysis-orbit"><Activity size={25} /></div><p>韵脚结构 · 文本情绪 · 叙事张力</p><span>主动分析时只发送这首歌的歌词与名称，<br />不会发送你的私人笔记或音频。</span></div>}
    {busy && <div className="analysis-loading" role="status"><LoaderCircle size={28} className="spin" /><strong>正在运行 EPN 分析…</strong><p>{lineCount > 12 ? `这首歌有 ${lineCount} 行，需要半分钟左右。` : '通常十几秒。'}你可以继续写，结果不会覆盖笔记。</p><button className="button reading-stop" onClick={stop}>停止</button></div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {result && <div className="analysis-result">
      <div className={`source-badge ${result.source === 'rules' ? 'rules' : ''}`}><ShieldCheck size={13} />{result.source === 'rules' ? '规则分析 · 未使用 LLM' : result.source === 'hybrid' ? 'LLM + 规则融合分析' : 'LLM 辅助 · 韵脚规则回退'}</div>
      <div className="analysis-tabs"><button className={tab === 'rhyme' ? 'active' : ''} onClick={() => setTab('rhyme')}>韵脚结构</button><button className={tab === 'emotion' ? 'active' : ''} onClick={() => setTab('emotion')}>情感参考</button></div>
      {tab === 'rhyme' ? <>
        <div className="rhyme-stats"><span><strong>{result.units.length}</strong> 韵脚候选</span><span><strong>{groups.length}</strong> 韵组</span></div>
        <div className="annotated-lyrics">{result.lines.map((text, index) => <p key={index}><span>{String(index + 1).padStart(2, '0')}</span><span><MarkedLine text={text} units={result.units.filter((unit) => unit.lineIndex === index)} groups={groups} /></span></p>)}</div>
        {!result.units.length && <p className="analysis-warning">没有找到可靠的韵脚候选，不代表这段歌词没有押韵。</p>}
        <div className="rhyme-legend">{groups.slice(0, 6).map((group, i) => <span key={group} style={{ color: colors[i % colors.length] }}>● {result.units.find((unit) => unit.group === group)?.label || `韵组 ${i + 1}`}</span>)}</div>
      </> : <div className="emotion-content"><p className="analysis-warning">文本推断，不是实际音频能量，也不是你此刻的情绪。</p>{([['energy', '文本能量'], ['melancholy', '低回倾向'], ['narrativeTension', '叙事张力']] as const).map(([metric, label]) => <div className="metric" key={metric}><div><span>{label}</span><span>{Math.round(result.metrics[metric] * 100)} / 100</span></div><i><b style={{ width: `${Math.max(0, Math.min(1, result.metrics[metric])) * 100}%` }} /></i></div>)}{result.insights.map((insight, index) => <div className="insight-text" key={index}><h4>{insight.title}</h4><p>{insight.body}</p></div>)}{result.source === 'rules' && <p className="analysis-warning">当前仅为词频、标点与结构启发式指标；未生成模型情感解读。</p>}</div>}
      <details className="analysis-details"><summary>来源与分析边界 <ChevronDown size={13} /></summary>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}<p>已执行 {result.steps.length} 个流水线步骤。步骤完成不等于模型调用成功。</p></details>
    </div>}
    <div className="analysis-action"><button className="button analysis-button" disabled={busy || !rawLyrics} onClick={() => void run()}>{busy ? <LoaderCircle size={15} className="spin" /> : result ? <RefreshCw size={15} /> : <Sparkles size={15} />}{busy ? '正在分析' : result ? '重新分析这首歌' : '分析这首歌'}</button><p>{!rawLyrics ? '此曲暂无歌词，仍可自由记录。' : health === null ? '连接分析服务后可用，笔记不受影响。' : health.llmEnabled ? '已配置 LLM；点击后歌词将发送至模型服务。' : '当前使用本地 EPN 规则引擎，不调用模型。'}</p></div>
  </section>;
}
