import { LoaderCircle, Square, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { streamRequest } from '../lib/stream-client';
import { isPolishable, stripAskLines } from '../lib/writing';
import type { PolishInput, PolishResult } from '../types';

const apiPrefix = new URLSearchParams(window.location.search).get('host') === 'mineradio' ? '/afterglow-api' : '/api';
const MAX_DRAFT = 3000;

type Props = {
  momentId: string;
  body: string;
  consent: boolean;
  buildInput: () => Omit<PolishInput, 'draft'>;
  onApply: (text: string) => void;
};

/** 「帮我理一理」：只给建议，和原文并排对比，你点「采用」才会替换，采用后还能撤销。 */
export function PolishPrompt({ momentId, body, consent, buildInput, onApply }: Props) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<PolishResult | null>(null);
  const [original, setOriginal] = useState('');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    setBusy(false); setText(''); setResult(null); setOriginal(''); setError(''); setUndo(null);
    return () => controller.current?.abort();
  }, [momentId]);

  const ready = isPolishable(body);
  const draft = stripAskLines(body);
  const tooLong = draft.length > MAX_DRAFT;
  const unchangedSinceUndo = undo !== null && body !== undo;

  async function run() {
    if (busy || !consent || !ready || tooLong) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setText(''); setResult(null); setOriginal(body); setUndo(null);
    let shown = '';
    const outcome = await streamRequest<PolishResult>(`${apiPrefix}/polish/stream`, { ...buildInput(), draft }, {
      onText: (piece) => { shown += piece; setText(shown); },
    }, { signal: abort.signal, fallbackMessage: '这次没整理出来，稍后再试。你的原文没有受到影响。' });
    if (controller.current !== abort) return;
    setBusy(false);
    if (outcome.status === 'done') { setResult({ ...outcome.result, warnings: Array.isArray(outcome.result.warnings) ? outcome.result.warnings : [] }); setText(outcome.result.text); }
    else if (outcome.status === 'aborted') { setText(''); }
    else { setText(''); setError(outcome.status === 'idle' ? '模型 60 秒没有返回，已停止。你的原文没有受到影响。' : outcome.message); }
  }

  function stop() { controller.current?.abort(); setBusy(false); setText(''); }
  function discard() { setResult(null); setText(''); setOriginal(''); }
  function apply() {
    if (!result) return;
    setUndo(original);
    onApply(result.text);
    discard();
  }
  function revert() { if (undo === null) return; onApply(undo); setUndo(null); }

  const disabledReason = !consent ? '请先在「回顾」页勾选「允许 AI 读取我的笔记」' : tooLong ? `原文超过 ${MAX_DRAFT} 字，太长了` : !ready ? '再多写几句（至少 20 字）才能整理' : '';
  const open = busy || Boolean(text) || Boolean(result);

  return <div className="polish-prompt">
    {!open && <div className="polish-bar">
      <button className="ask-trigger" disabled={Boolean(disabledReason)} onClick={() => void run()} title={disabledReason || '把你零散的几句，整理成一段通顺的文字。只是建议，你确认后才会替换。'}>
        <Wand2 size={13} />帮我理一理
      </button>
      {disabledReason && <small className="polish-hint">{disabledReason}</small>}
      {undo !== null && !unchangedSinceUndo && <button className="polish-undo" onClick={revert}><Undo2 size={12} />撤销，恢复整理前的原文</button>}
    </div>}
    {open && <div className="polish-card" aria-busy={busy}>
      <header><b>{busy ? '正在整理…' : '整理后的样子'}</b><span>只是建议，不会自动替换你的原文</span></header>
      <div className="polish-compare">
        <section><h4>你的原文</h4><p>{stripAskLines(original) || original}</p></section>
        <section className="polish-new"><h4>整理后</h4><p>{text || <span className="ask-wait"><LoaderCircle className="spinner" size={12} />正在读你写的…</span>}{busy && text && <i className="typing-caret" aria-hidden="true" />}</p></section>
      </div>
      {result?.warnings.map((warning) => <small key={warning} className="polish-warn" role="status">{warning}</small>)}
      <footer>
        {busy
          ? <button className="polish-stop" onClick={stop}><Square size={12} fill="currentColor" />停止</button>
          : <>
            <button className="polish-apply" disabled={!result} onClick={apply}>采用整理后的文字</button>
            <button disabled={!result} onClick={() => void run()}>再整理一次</button>
            <button onClick={discard}>放弃，保留原文</button>
          </>}
      </footer>
    </div>}
    {error && <small className="polish-error" role="alert">{error}</small>}
  </div>;
}
