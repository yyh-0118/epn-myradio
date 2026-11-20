import { LoaderCircle, MessageCircleQuestion, PenLine, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { streamRequest } from '../lib/stream-client';
import type { AskInput, AskResult } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const COOLDOWN_MS = 1500;

export function AskPrompt({ momentId, consent, buildInput, onUse }: { momentId: string; consent: boolean; buildInput: () => AskInput; onUse: (question: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [cooling, setCooling] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const coolTimer = useRef(0);

  useEffect(() => {
    controller.current?.abort();
    window.clearTimeout(coolTimer.current);
    setBusy(false); setQuestion(''); setDone(false); setError(''); setCooling(false);
    return () => { controller.current?.abort(); window.clearTimeout(coolTimer.current); };
  }, [momentId]);

  async function ask() {
    if (busy || cooling) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setQuestion(''); setDone(false);
    let shown = '';
    const outcome = await streamRequest<AskResult>(`${apiPrefix}/ask/stream`, buildInput(), {
      onText: (text) => { shown += text; setQuestion(shown); },
    }, { signal: abort.signal, idleMs: 30_000, fallbackMessage: '这次没问出来，稍后再试。' });
    if (controller.current !== abort || abort.signal.aborted) return;
    setBusy(false);
    if (outcome.status === 'done' && outcome.result.question) {
      setQuestion(outcome.result.question); setDone(true);
      setCooling(true); coolTimer.current = window.setTimeout(() => setCooling(false), COOLDOWN_MS);
    } else {
      setQuestion('');
      setError(outcome.status === 'idle' ? '模型 30 秒没有返回，已停止，笔记没有受到影响。' : outcome.status === 'error' ? outcome.message : '这次没问出来，稍后再试。');
    }
  }

  function stop() { controller.current?.abort(); setBusy(false); setQuestion(''); }

  const showCard = Boolean(question) || busy;
  return <div className="ask-prompt">
    {showCard ? <div className="ask-card" role="status" aria-live="polite" aria-busy={busy}>
      <MessageCircleQuestion size={15} />
      <p>{question || <span className="ask-wait"><LoaderCircle className="spinner" size={12} />正在想问你什么…</span>}{busy && question && <i className="typing-caret" aria-hidden="true" />}</p>
      <div>
        {busy
          ? <button onClick={stop}>停止</button>
          : <>
            <button disabled={!done} onClick={() => { onUse(question); setQuestion(''); setDone(false); }} title="把这个问题放到笔记开头"><PenLine size={12} />记入笔记</button>
            <button disabled={cooling} onClick={() => void ask()}>换一个</button>
            <button aria-label="收起" onClick={() => { setQuestion(''); setDone(false); }}><X size={12} /></button>
          </>}
      </div>
    </div> : <button className="ask-trigger" onClick={() => void ask()} title={consent ? '点击后，这句歌词、歌名、你已写的草稿和这首歌下的旧笔记会发送到你配置的模型' : '点击后，只有这句歌词和歌名会发送到你配置的模型；你的草稿和旧笔记未授权，不会发送'}>
      <MessageCircleQuestion size={13} />不知道写什么？问我一句
    </button>}
    {!showCard && !consent && <small className="polish-hint">未授权读取笔记：只会发送歌词与歌名，不含你的草稿</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
