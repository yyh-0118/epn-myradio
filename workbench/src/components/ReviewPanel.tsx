import { BookMarked, History, LoaderCircle, RefreshCw, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readSse } from '../lib/sse';
import { stripAskLines } from '../lib/writing';
import { REVIEW_RANGES, addReviewRecord, clearReviewHistory, deleteReviewRecord, readConsent, readReviewHistory, reviewNudge, selectReviewNotes, writeConsent } from '../lib/review-store';
import type { Moment, ReviewRangeId, ReviewRecord, ReviewResult } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const dateText = (iso: string) => new Date(iso).toLocaleDateString('zh-CN');
const IDLE_MS = 60_000;
type Live = { text: string; thinking: boolean; range: string; focus: string; startedAt: number };

export function ReviewPanel({ moments, onOpen }: { moments: Moment[]; onOpen: (id: string) => void }) {
  const [range, setRange] = useState<ReviewRangeId>('30');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [consent, setConsent] = useState(() => readConsent());
  const [history, setHistory] = useState<ReviewRecord[]>(() => readReviewHistory());
  const [shown, setShown] = useState<ReviewRecord | null>(() => readReviewHistory()[0] ?? null);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const controller = useRef<AbortController | null>(null);
  const days = REVIEW_RANGES.find((item) => item.id === range)!.days;
  const { picked: notes, eligible } = useMemo(() => selectReviewNotes(moments, days), [moments, days]);
  const byId = useMemo(() => new Map(moments.map((moment) => [moment.id, moment])), [moments]);
  const nudge = useMemo(() => reviewNudge(moments, history), [moments, history]);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(`${apiPrefix}/health`, { signal: abort.signal }).then((response) => response.json()).then((body: { llmEnabled?: boolean }) => setLlmReady(Boolean(body.llmEnabled))).catch(() => setLlmReady(null));
    return () => abort.abort();
  }, []);
  useEffect(() => () => controller.current?.abort(), []);

  function toggleConsent(next: boolean) { setConsent(next); writeConsent(next); }

  async function run() {
    if (!consent) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const usedNotes = notes; const usedRange = REVIEW_RANGES.find((item) => item.id === range)!; const usedFocus = focus.trim();
    let idleTimer: ReturnType<typeof setTimeout> | undefined; let idled = false;
    const touch = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => { idled = true; abort.abort(); }, IDLE_MS); };
    setBusy(true); setError(''); setNotice('');
    setLive({ text: '', thinking: false, range: usedRange.label, focus: usedFocus, startedAt: Date.now() });
    let finished: ReviewResult | null = null; let failure = '';
    try {
      touch();
      const response = await fetch(`${apiPrefix}/review/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal: abort.signal,
        body: JSON.stringify({
          focus: usedFocus || undefined,
          notes: usedNotes.map((note) => ({ id: note.id, title: note.title, body: stripAskLines(note.body).slice(0, 4000), quote: note.quote.slice(0, 400), trackTitle: note.trackTitle, artist: note.artist, createdAt: note.createdAt })),
        }),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || '回顾生成失败，请稍后重试。'); }
      await readSse(response, (message) => {
        let payload: { text?: string; message?: string } & Partial<ReviewResult> = {};
        try { payload = message.data ? JSON.parse(message.data) : {}; } catch { return; }
        if (message.event === 'text' && payload.text) setLive((current) => current && ({ ...current, text: current.text + payload.text, thinking: false }));
        else if (message.event === 'thinking') setLive((current) => current && ({ ...current, thinking: current.text.length === 0 }));
        else if (message.event === 'done') finished = payload as ReviewResult;
        else if (message.event === 'error') failure = payload.message || '回顾生成失败，请稍后重试。';
      }, touch);
      if (failure) throw new Error(failure);
      if (!finished) throw new Error('回顾没有完整返回，请重试。你的笔记没有受到影响。');
      const body = finished as ReviewResult;
      const data: ReviewResult = { ...body, moods: Array.isArray(body.moods) ? body.moods : [], warnings: Array.isArray(body.warnings) ? body.warnings : [] };
      const record: ReviewRecord = {
        id: crypto.randomUUID(), createdAt: new Date().toISOString(), rangeId: usedRange.id, rangeLabel: usedRange.label, focus: usedFocus, data,
        refs: Object.fromEntries(usedNotes.map((note) => [note.id, { createdAt: note.createdAt, trackTitle: note.trackTitle }])),
      };
      const saved = addReviewRecord(record);
      setHistory(saved.list); setShown(record); setLive(null);
      if (!saved.saved) setNotice('这份回顾没能保存到本机历史，离开此页后会消失。');
    } catch (reason) {
      if (idled) { setError('模型 60 秒没有返回新内容，已停止。笔记没有受到影响，可以重试。'); setLive(null); }
      else if (!abort.signal.aborted) {
        setError(reason instanceof Error && reason.name !== 'SyntaxError' && reason.name !== 'TypeError' ? reason.message : '回顾服务未启动或连接中断。笔记没有受到影响，请稍后重试。');
        setLive(null);
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (controller.current === abort) { setBusy(false); if (abort.signal.aborted && !idled) setLive((current) => current && current.text ? current : null); }
    }
  }

  function stop() { controller.current?.abort(); setNotice('已停止。这次的内容没有保存。'); }

  function removeRecord(id: string) {
    const list = deleteReviewRecord(id);
    setHistory(list);
    if (shown?.id === id) setShown(list[0] ?? null);
  }

  function clearAll() {
    if (!confirm('清空全部回顾历史？只会删除保存的回顾结果，你的笔记不受影响。')) return;
    clearReviewHistory(); setHistory([]); setShown(null);
  }

  function reference(id: string, record: ReviewRecord, key = id) {
    const note = byId.get(id);
    const ref = record.refs[id];
    const when = note?.createdAt ?? ref?.createdAt;
    const label = `${when ? dateText(when) : '某天'} · ${note?.trackTitle || ref?.trackTitle || '笔记'}`;
    return note
      ? <button key={key} onClick={() => onOpen(id)} title={note.body.slice(0, 80)}>{label}</button>
      : <span key={key} className="review-gone" title="这条笔记已被删除">{label} · 已删除</span>;
  }

  const moodItems = shown ? [...shown.data.moods].sort((a, b) => (byId.get(a.noteId)?.createdAt ?? shown.refs[a.noteId]?.createdAt ?? '').localeCompare(byId.get(b.noteId)?.createdAt ?? shown.refs[b.noteId]?.createdAt ?? '')) : [];

  return <section className="review-panel">
    <span className="section-kicker">LOOKING BACK · WITH YOUR NOTES</span>
    <h1>把这段时间，<br />和你一起读一遍。</h1>
    {nudge.due && !busy && <div className="review-nudge" role="status">
      <p>最近一周你写了 {nudge.recentCount} 条笔记，{nudge.daysSince === null ? '还没有回顾过。' : `距上次回顾已 ${nudge.daysSince} 天。`}要不要回头读一遍？不会自动发送，需要你点击。</p>
      <button onClick={() => setRange('7')}>选中最近 7 天</button>
    </div>}
    <div className="review-controls">
      <div className="review-ranges" role="radiogroup" aria-label="回顾范围">{REVIEW_RANGES.map((item) => <button key={item.id} role="radio" aria-checked={range === item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{item.label}</button>)}</div>
      <input aria-label="这次想关注什么（可选）" value={focus} maxLength={200} onChange={(event) => setFocus(event.target.value)} placeholder="这次想关注什么？比如：最近为什么总听同一首歌（可不填）" />
      <label className="review-consent"><input type="checkbox" checked={consent} onChange={(event) => toggleConsent(event.target.checked)} /><span><b>允许 AI 读取我的笔记</b><small>授权后，点下面的按钮才会把所选笔记发给你配置的模型，随时可关闭。关闭时，「问我一句」也不会附带这首歌的旧笔记。</small></span></label>
      {busy
        ? <button className="review-run review-stop" onClick={stop}><Square size={13} fill="currentColor" />停止</button>
        : <button className="review-run" disabled={!consent || !notes.length || llmReady === false} onClick={() => void run()} title={consent ? undefined : '请先勾选“允许 AI 读取我的笔记”'}>{shown ? <RefreshCw size={15} /> : <BookMarked size={15} />}{shown ? '重新生成' : `读这 ${notes.length} 条笔记`}</button>}
    </div>
    <div className="review-privacy"><ShieldAlert size={14} /><p>点击后，所选笔记的正文、标题、关联歌词、歌名与歌手会发送到你配置的模型服务；不会发送音乐账户信息或音频地址。只有主动点击才会发送。生成的回顾只保存在本机，可在下方历史里逐条删除。</p></div>
    {llmReady === false && <div className="review-setup" role="status"><b>还没有配置模型</b><p>在应用数据目录创建 <code>afterglow-llm.json</code>：<code>{'{"apiUrl":"https://…/chat/completions","apiKey":"…","model":"…"}'}</code>，然后重启应用。macOS 路径：<code>~/Library/Application Support/Mineradio Afterglow/</code>。</p><p>想让笔记完全不出本机，可以用本地模型（如 Ollama）：<code>{'{"apiUrl":"http://127.0.0.1:11434/v1/chat/completions","apiKey":"","model":"你拉取的模型名"}'}</code>，apiKey 可留空，仅支持本机回环地址的 http。</p></div>}
    {!notes.length && <p className="review-empty">这个范围里还没有写过文字的笔记。先在听歌时记下几句，再回来读。</p>}
    {eligible > notes.length && <p className="review-empty">这个范围有 {eligible} 条笔记，一次最多读取最新的 {notes.length} 条。想看更早的，可以缩小范围分段回顾。</p>}
    {error && <p className="review-error" role="alert">{error}</p>}
    {notice && <p className="review-error" role="status">{notice}</p>}
    {live && <article className="review-result review-live" aria-live="polite" aria-busy={busy}>
      <header><span>基于 {live.range}{live.focus ? ` · 关注：${live.focus}` : ''}</span><span>{live.text ? '正在写…' : live.thinking ? '正在想…' : '正在读你的笔记…'}</span></header>
      {live.text ? <p className="review-overview">{live.text}<i className="typing-caret" aria-hidden="true" /></p> : <p className="review-thinking"><LoaderCircle className="spinner" size={14} />{live.thinking ? '模型在思考，马上开始写' : '正在把笔记交给模型'}</p>}
      <small>主题、心情线索和引用会在正文写完后补上，每条引用都会对照你的笔记校验。</small>
    </article>}
    {shown && !live && <article className="review-result">
      <header><span>基于 {shown.rangeLabel} · {shown.data.noteCount} 条笔记{shown.focus ? ` · 关注：${shown.focus}` : ''}</span><span>{new Date(shown.createdAt).toLocaleString('zh-CN')}</span></header>
      {shown.data.overview && <p className="review-overview">{shown.data.overview}</p>}
      {moodItems.length > 0 && <section className="review-moods"><h3>心情线索</h3><ol>{moodItems.map((item) => {
        const note = byId.get(item.noteId); const when = note?.createdAt ?? shown.refs[item.noteId]?.createdAt;
        const content = <><time>{when ? new Date(when).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—'}</time>{item.mood}</>;
        const cls = `review-mood tone-${item.tone < 0 ? 'down' : item.tone > 0 ? 'up' : 'mid'}`;
        return <li key={item.noteId}>{note ? <button className={cls} onClick={() => onOpen(item.noteId)} title={note.body.slice(0, 80)}>{content}</button> : <span className={`${cls} review-gone`} title="这条笔记已被删除">{content}</span>}</li>;
      })}</ol><small>按时间排列，只取自你写下的文字，不是对你状态的判断。</small></section>}
      {shown.data.themes.map((theme) => <section key={theme.title} className="review-theme"><h3>{theme.title}</h3><p>{theme.body}</p><div>{theme.noteIds.map((id) => reference(id, shown))}</div></section>)}
      {shown.data.question && <aside className="review-question"><b>想接着问你</b><p>{shown.data.question}</p></aside>}
      {shown.data.warnings.map((warning) => <small key={warning}>{warning}</small>)}
      <small>这是模型对你文字的解读，不是结论；每个主题下列出了它依据的笔记，可点开核对。</small>
    </article>}
    {history.length > 0 && <details className="review-history">
      <summary><History size={13} />回顾历史 · {history.length} 份</summary>
      <ul>{history.map((record) => <li key={record.id} className={shown?.id === record.id ? 'current' : ''}>
        <button className="review-history-open" onClick={() => setShown(record)}><b>{new Date(record.createdAt).toLocaleString('zh-CN')}</b><span>{record.rangeLabel} · {record.data.noteCount} 条笔记</span><small>{record.data.overview.slice(0, 48)}{record.data.overview.length > 48 ? '…' : ''}</small></button>
        <button className="review-history-delete" aria-label="删除这份回顾" title="删除这份回顾" onClick={() => removeRecord(record.id)}><Trash2 size={13} /></button>
      </li>)}</ul>
      <button className="review-history-clear" onClick={clearAll}>清空全部回顾历史</button>
    </details>}
  </section>;
}
