import { LoaderCircle, MessageCircleQuestion, PenLine, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AskInput } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';

export function AskPrompt({ momentId, buildInput, onUse }: { momentId: string; buildInput: () => AskInput; onUse: (question: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    setBusy(false); setQuestion(''); setError('');
    return () => controller.current?.abort();
  }, [momentId]);

  async function ask() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiPrefix}/ask/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildInput()),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || '这次没问出来，稍后再试。');
      if (typeof body.question !== 'string' || !body.question) throw new Error('这次没问出来，稍后再试。');
      if (!abort.signal.aborted) setQuestion(body.question);
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error && reason.name !== 'TimeoutError' && reason.name !== 'SyntaxError' && reason.name !== 'TypeError' ? reason.message : '超时或服务未启动，笔记没有受到影响。');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }

  return <div className="ask-prompt">
    {question ? <div className="ask-card" role="status">
      <MessageCircleQuestion size={15} />
      <p>{question}</p>
      <div>
        <button onClick={() => { onUse(question); setQuestion(''); }} title="把这个问题放到笔记开头"><PenLine size={12} />记入笔记</button>
        <button disabled={busy} onClick={() => void ask()}>{busy ? <LoaderCircle className="spinner" size={12} /> : null}换一个</button>
        <button aria-label="收起" onClick={() => setQuestion('')}><X size={12} /></button>
      </div>
    </div> : <button className="ask-trigger" disabled={busy} onClick={() => void ask()} title="点击后，这句歌词、歌名、你已写的草稿和这首歌下的旧笔记会发送到你配置的模型">
      {busy ? <LoaderCircle className="spinner" size={13} /> : <MessageCircleQuestion size={13} />}{busy ? '正在想问你什么…' : '不知道写什么？问我一句'}
    </button>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
