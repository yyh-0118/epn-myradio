import { ArrowLeft, ArrowRight, BookOpen, Check, Download, FileText, Headphones, LockKeyhole, Play, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Moment } from '../types';
import { formatTime } from '../lib/lyrics';
import { downloadFile } from '../lib/storage';
import type { ReactNode } from 'react';

export function MomentEntry({ moment, onWrite, onBack, onReplay }: { moment: Moment; onWrite: () => void; onBack: () => void; onReplay: () => void }) {
  return <section className="entry-view view-enter">
    <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> 回到聆听室</button>
    <div className="entry-hero"><span className="eyebrow">ECHO PULSE NODE / CREATIVE SPACE</span><h1>刚才的那一刻，<br /><em>值得多停留一会儿。</em></h1><p>音乐还在继续。把没来得及说的话，留在这一页。</p></div>
    <div className="entry-quote"><span className="quote-symbol">“</span><blockquote>{moment.quote || '有些感受，先于文字出现。'}</blockquote><div><span>{moment.trackTitle} · {formatTime(moment.at)}</span><button className="text-button" onClick={onReplay}><Play size={13} /> 回听这一段</button></div></div>
    <button className="entry-write-card" onClick={onWrite}><div className="entry-book-icon"><BookOpen size={29} /></div><div><span className="eyebrow">A PAGE OF YOUR OWN</span><h2>打开我的工作台</h2><p>先写下你的话。韵脚与情感分析，等你需要时再展开。</p></div><ArrowRight size={24} /></button>
    <div className="entry-bottom"><span><Check size={14} /> 歌曲与片段已关联</span><span><Headphones size={14} /> 播放不间断</span><span><LockKeyhole size={14} /> 私人记录，本地保存</span></div>
  </section>;
}

export function Notebook({ moment, onChange, onReplay, saveState, analysis, onBack }: {
  moment: Moment; onChange: (patch: Partial<Pick<Moment, 'body' | 'title'>>) => void;
  onReplay: () => void; saveState: 'saving' | 'saved' | 'error'; analysis: ReactNode; onBack: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textarea.current?.focus({ preventScroll: true }); }, [moment.id]);
  const exportNote = () => {
    const content = `# ${moment.title || '一个听歌瞬间'}\n\n${moment.trackTitle} — ${moment.artist} · ${formatTime(moment.at)}\n\n> ${moment.quote.replace(/\n/g, '\n> ')}\n\n${moment.body}\n\n---\n记录于 ${new Date(moment.createdAt).toLocaleString('zh-CN')}\n`;
    downloadFile(`${(moment.title || '余响笔记').replace(/[<>:"/\\|?*]/g, '_')}.md`, content, 'text/markdown;charset=utf-8');
  };
  return <section className="workbench view-enter">
    <div className="workbench-header"><div><button className="text-button" onClick={onBack}><ArrowLeft size={14} /> 瞬间素材库</button><h1>给感受，一个落脚的地方。</h1></div><span className="private-badge"><LockKeyhole size={13} /> 仅自己可见</span></div>
    <div className="workbench-layout">
      <article className="notebook-page">
        <header className="notebook-top"><span><FileText size={16} /> 我的笔记</span><span className={`save-state ${saveState}`} role="status">{saveState === 'saved' ? <Check size={13} /> : null}{saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已保存到此浏览器' : '保存失败，请先导出备份'}</span></header>
        <div className="note-source"><div><span className="note-source-line" /><span>{moment.trackTitle}</span><span className="time-tag">{formatTime(moment.at)}</span></div><blockquote>{moment.quote || '这一刻，没有歌词也没关系。'}</blockquote><button className="text-button" onClick={onReplay}><Play size={13} /> 从这句之前 3 秒回听</button></div>
        <input className="note-title" aria-label="笔记标题" maxLength={120} placeholder="给这个瞬间起个名字，也可以先空着" value={moment.title} onChange={(e) => onChange({ title: e.target.value })} />
        <textarea ref={textarea} className="note-body" aria-label="我的瞬间笔记" maxLength={100000} placeholder={'刚才，你想到了什么？\n\n不必完整，不必漂亮。\n一句话，一个画面，或一个还没有结局的故事。'} value={moment.body} onChange={(e) => onChange({ body: e.target.value })} />
        <footer className="note-footer"><span>{moment.body.length.toLocaleString()} 字 <b>·</b> {new Date(moment.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span><button className="text-button" onClick={exportNote}><Download size={14} /> 导出笔记</button></footer>
      </article>
      <aside className="analysis-column">{analysis}<div className="gentle-reminder"><Sparkles size={15} /><p>分析回答「作品里发生了什么」。<br /><strong>你来写「它在我这里发生了什么」。</strong></p></div></aside>
    </div>
  </section>;
}
