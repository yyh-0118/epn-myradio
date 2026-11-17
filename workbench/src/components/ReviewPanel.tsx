import { BookMarked, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Moment, ReviewResult } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const RANGES = [{ id: '7', label: '最近 7 天', days: 7 }, { id: '30', label: '最近 30 天', days: 30 }, { id: '90', label: '最近 90 天', days: 90 }, { id: 'all', label: '全部', days: 0 }] as const;
const MAX_NOTES = 60;
const MAX_TOTAL_CHARS = 30000;

function selectNotes(moments: Moment[], days: number) {
  const since = days ? Date.now() - days * 86400_000 : 0;
  const picked: Moment[] = [];
  let total = 0;
  for (const moment of [...moments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!moment.body.trim() || Date.parse(moment.createdAt) < since) continue;
    const size = Math.min(moment.body.length, 4000) + moment.title.length + Math.min(moment.quote.length, 400);
    if (picked.length >= MAX_NOTES || total + size > MAX_TOTAL_CHARS) break;
    picked.push(moment);
    total += size;
  }
  return picked;
}

export function ReviewPanel({ moments, onOpen }: { moments: Moment[]; onOpen: (id: string) => void }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('30');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ data: ReviewResult; range: string; at: number } | null>(null);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);
  const days = RANGES.find((item) => item.id === range)!.days;
  const notes = useMemo(() => selectNotes(moments, days), [moments, days]);
  const byId = useMemo(() => new Map(moments.map((moment) => [moment.id, moment])), [moments]);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(`${apiPrefix}/health`, { signal: abort.signal }).then((response) => response.json()).then((body: { llmEnabled?: boolean }) => setLlmReady(Boolean(body.llmEnabled))).catch(() => setLlmReady(null));
    return () => abort.abort();
  }, []);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiPrefix}/review/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
        body: JSON.stringify({
          focus: focus.trim() || undefined,
          notes: notes.map((note) => ({ id: note.id, title: note.title, body: note.body.slice(0, 4000), quote: note.quote.slice(0, 400), trackTitle: note.trackTitle, artist: note.artist, createdAt: note.createdAt })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || '回顾生成失败，请稍后重试。');
      if (abort.signal.aborted) return;
      setResult({ data: body as ReviewResult, range: RANGES.find((item) => item.id === range)!.label, at: Date.now() });
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error && reason.name !== 'TimeoutError' && reason.name !== 'SyntaxError' && reason.name !== 'TypeError' ? reason.message : '回顾超时或服务未启动。笔记没有受到影响，请稍后重试。');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }

  return <section className="review-panel">
    <span className="section-kicker">LOOKING BACK · WITH YOUR NOTES</span>
    <h1>把这段时间，<br />和你一起读一遍。</h1>
    <div className="review-controls">
      <div className="review-ranges" role="radiogroup" aria-label="回顾范围">{RANGES.map((item) => <button key={item.id} role="radio" aria-checked={range === item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{item.label}</button>)}</div>
      <input aria-label="这次想关注什么（可选）" value={focus} maxLength={200} onChange={(event) => setFocus(event.target.value)} placeholder="这次想关注什么？比如：最近为什么总听同一首歌（可不填）" />
      <button className="review-run" disabled={busy || !notes.length || llmReady === false} onClick={() => void run()}>{busy ? <LoaderCircle className="spinner" size={15} /> : result ? <RefreshCw size={15} /> : <BookMarked size={15} />}{busy ? '正在读你的笔记…' : result ? '重新生成' : `读这 ${notes.length} 条笔记`}</button>
    </div>
    <div className="review-privacy"><ShieldAlert size={14} /><p>点击后，所选笔记的正文、标题、关联歌词、歌名与歌手会发送到你配置的模型服务；不会发送音乐账户信息或音频地址。只有主动点击才会发送。</p></div>
    {llmReady === false && <div className="review-setup" role="status"><b>还没有配置模型</b><p>在应用数据目录创建 <code>afterglow-llm.json</code>：<code>{'{"apiUrl":"https://…/chat/completions","apiKey":"…","model":"…"}'}</code>，然后重启应用。macOS 路径：<code>~/Library/Application Support/Mineradio Afterglow/</code>。</p></div>}
    {!notes.length && <p className="review-empty">这个范围里还没有写过文字的笔记。先在听歌时记下几句，再回来读。</p>}
    {error && <p className="review-error" role="alert">{error}</p>}
    {result && <article className="review-result">
      <header><span>基于 {result.range} · {result.data.noteCount} 条笔记</span><span>{new Date(result.at).toLocaleTimeString('zh-CN')}</span></header>
      {result.data.overview && <p className="review-overview">{result.data.overview}</p>}
      {result.data.themes.map((theme) => <section key={theme.title} className="review-theme"><h3>{theme.title}</h3><p>{theme.body}</p><div>{theme.noteIds.map((id) => { const note = byId.get(id); return note ? <button key={id} onClick={() => onOpen(id)} title={note.body.slice(0, 80)}>{new Date(note.createdAt).toLocaleDateString('zh-CN')} · {note.trackTitle || '笔记'}</button> : null; })}</div></section>)}
      {result.data.question && <aside className="review-question"><b>想接着问你</b><p>{result.data.question}</p></aside>}
      {result.data.warnings.map((warning) => <small key={warning}>{warning}</small>)}
      <small>这是模型对你文字的解读，不是结论；每个主题下列出了它依据的笔记，可点开核对。</small>
    </article>}
  </section>;
}
