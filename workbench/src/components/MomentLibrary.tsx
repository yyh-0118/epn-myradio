import { ArrowUpRight, BookOpen, Download, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Moment } from '../types';
import { formatTime } from '../lib/lyrics';
import { downloadFile } from '../lib/storage';

export function MomentLibrary({ moments, onOpen, onDelete, onListen }: { moments: Moment[]; onOpen: (moment: Moment) => void; onDelete: (moment: Moment) => void; onListen: () => void }) {
  const [query, setQuery] = useState('');
  const [onlyWritten, setOnlyWritten] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = moments.filter((moment) => (!onlyWritten || moment.body.trim()) && [moment.title, moment.body, moment.quote, moment.trackTitle, moment.artist].some((text) => text.toLocaleLowerCase().includes(needle)));
  return <section className="library view-enter">
    <div className="section-heading"><div><span className="eyebrow">YOUR PERSONAL ECHO ARCHIVE</span><h1>有些瞬间，<em>值得反复听见。</em></h1><p className="section-description">不是别人的歌评，是音乐经过你时，留下的痕迹。</p></div><button className="button subtle" disabled={!moments.length} onClick={() => downloadFile('afterglow-moments.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), moments }, null, 2), 'application/json')}><Download size={15} /> 备份全部记录</button></div>
    <div className="library-toolbar"><div className="filter-tabs"><button className={!onlyWritten ? 'active' : ''} onClick={() => setOnlyWritten(false)}>全部瞬间 <span>{moments.length}</span></button><button className={onlyWritten ? 'active' : ''} onClick={() => setOnlyWritten(true)}>已写下的话</button></div><label className="search-field"><Search size={16} /><input aria-label="搜索瞬间" placeholder="搜索歌曲、歌词或你的话…" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
    {filtered.length ? <div className="moment-grid">{filtered.map((moment, i) => <article className="moment-card" key={moment.id} style={{ '--card-delay': `${Math.min(i, 6) * 40}ms` } as React.CSSProperties}>
      <button className="moment-open" onClick={() => onOpen(moment)}><div className="moment-card-top"><span><BookOpen size={14} /> {formatTime(moment.at)}</span><span>{new Date(moment.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span></div><blockquote>“{moment.quote || '无歌词的一个瞬间'}”</blockquote><h3>{moment.title || '还没起名字的瞬间'}</h3><p>{moment.body || '这里还留着一页空白，等你回来接着写。'}</p><footer><span>{moment.trackTitle}</span><ArrowUpRight size={17} /></footer></button><button className="delete-moment icon-button" aria-label={`删除记录：${moment.title || moment.quote || '未命名瞬间'}`} onClick={() => onDelete(moment)}><Trash2 size={14} /></button>
    </article>)}</div> : <div className="library-empty"><div className="empty-book"><BookOpen size={36} /></div><h2>{moments.length ? '没有找到这个瞬间' : '把第一句想说的话，留在这里。'}</h2><p>{moments.length ? '试试歌词中的一个词，或放宽搜索条件。' : '回到聆听室，点击一句歌词，就可以开始。'}</p><button className="button primary" onClick={moments.length ? () => { setQuery(''); setOnlyWritten(false); } : onListen}>{moments.length ? '查看全部瞬间' : '去听一首歌'}<ArrowUpRight size={16} /></button></div>}
    <div className="library-footnote">记录与音频保存在当前浏览器。清除网站数据会删除它们，请定期导出笔记备份。</div>
  </section>;
}
