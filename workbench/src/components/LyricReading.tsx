import { LoaderCircle, Square, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { streamRequest } from '../lib/stream-client';
import type { ReadingResult, Track } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const cache = new Map<string, ReadingResult>();

type Props = { track?: Track };

/** 逐句解读：点一下才会把这首歌的歌词发给模型；结果一句句流式出现，点一句展开解读。 */
export function LyricReading({ track }: Props) {
  const lines = track?.lyrics.map((line) => line.text.trim()).filter(Boolean) ?? [];
  const cacheKey = JSON.stringify([track?.id, lines]);
  const [focus, onFocus] = useState<number[]>([]);
  const [result, setResult] = useState<ReadingResult | null>(cache.get(cacheKey) || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [partial, setPartial] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    controller.current?.abort();
    setResult(cache.get(cacheKey) || null); setBusy(false); setError(''); setOpen(null); setPartial(0); onFocus([]);
    return () => controller.current?.abort();
  }, [cacheKey]);

  useEffect(() => {
    if (focus.length) list.current?.children[focus[0]]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  async function run() {
    if (busy || !lines.length) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setResult(null); setOpen(null); setPartial(0); onFocus([]);
    let text = '';
    const outcome = await streamRequest<ReadingResult>(`${apiPrefix}/reading/stream`, { track: { title: track?.title ?? '', artist: track?.artist ?? '' }, lines }, {
      onText: (piece) => { text += piece; setPartial(text.split(/\r?\n/).filter((line) => /^\s*\d+\s*[|｜]/.test(line)).length); },
    }, { signal: abort.signal, idleMs: 45_000, fallbackMessage: '这次没解读出来，稍后再试。' });
    if (controller.current !== abort || abort.signal.aborted) return;
    setBusy(false);
    if (outcome.status === 'done') {
      const value: ReadingResult = { lines: outcome.result.lines ?? [], insights: outcome.result.insights ?? [], warnings: outcome.result.warnings ?? [] };
      cache.set(cacheKey, value);
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
      setResult(value);
    } else if (outcome.status === 'idle') setError('模型 45 秒没有返回，已停止。');
    else if (outcome.status === 'error') setError(outcome.message);
  }

  function stop() { controller.current?.abort(); setBusy(false); setPartial(0); }

  const byIndex = new Map((result?.lines ?? []).map((item) => [item.index, item]));
  return <section className="line-reading reading-card" aria-label="逐句解读">
    <header>
      <h4>逐句解读{result && <small>{result.lines.length} 句有解读，点一句展开</small>}</h4>
      {busy
        ? <button className="reading-run" onClick={stop}><Square size={12} fill="currentColor" />停止</button>
        : <button className="reading-run" disabled={!lines.length} onClick={() => void run()}>{result ? '重新解读' : <><Sparkles size={13} />解读这首歌的歌词</>}</button>}
    </header>
    {busy && <p className="reading-wait" role="status"><LoaderCircle className="spinner" size={12} />{partial ? `已读到 ${partial} 句…` : '正在读歌词…'}</p>}
    {!result && !busy && !error && <p className="reading-hint">{lines.length ? '点击后，这首歌的歌词与歌名会发送到你配置的模型；不会发送你的笔记。只解读有意象或转折的句子，不会每句都写。' : '这首歌暂时没有歌词。'}</p>}
    {error && <p className="reading-error" role="alert">{error}</p>}
    {result && <>
      {result.warnings.map((warning) => <p key={warning} className="reading-warn" role="status">{warning}</p>)}
      <div className="reading-scroll"><ol ref={list}>{lines.map((text, index) => {
        const item = byIndex.get(index);
        const expanded = open === index;
        return <li key={index} className={`${focus.includes(index) ? 'lit' : ''} ${expanded ? 'open' : ''}`}>
          <button disabled={!item} aria-expanded={item ? expanded : undefined} onClick={() => setOpen(expanded ? null : index)} title={item ? '展开这一句的解读' : '这一句没有解读'}>
            <span className="no">{String(index + 1).padStart(2, '0')}</span><span className="txt">{text}</span>{item && <em>{item.emotion}</em>}
          </button>
          {expanded && item && <p className="note" role="note">{item.note}</p>}
        </li>;
      })}</ol></div>
      {result.insights.map((insight) => <div className="insight-text" key={insight.title}>
        <h4>{insight.title}</h4><p>{insight.body}</p>
        {insight.lines.length > 0 && <button className="insight-evidence" onClick={() => onFocus(insight.lines)}>看依据：第 {insight.lines.map((line) => line + 1).join('、')} 句</button>}
      </div>)}
      {focus.length > 0 && <button className="line-clear" onClick={() => onFocus([])}>取消高亮</button>}
      <small className="reading-foot">解读是模型对歌词文字的推测，不代表歌手的本意，也不是你此刻的感受。</small>
    </>}
  </section>;
}
