import { ArrowUpRight, BookOpen, Headphones, Music2, Plus, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { LyricLine, Moment } from '../types';
import type { Player } from '../hooks/usePlayer';
import { activeLineIndex, formatTime } from '../lib/lyrics';

export function ListeningRoom({ player, selected, onSelect, onCapture, moments, onOpen, onImport }: {
  player: Player; selected: string | null; onSelect: (id: string) => void;
  onCapture: (line?: LyricLine) => void; moments: Moment[]; onOpen: (moment: Moment) => void; onImport: () => void;
}) {
  const index = activeLineIndex(player.track.lyrics, player.time);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) return;
    const active = list.current?.querySelector<HTMLElement>('[data-current="true"]');
    if (active && list.current) list.current.scrollTo({ top: active.offsetTop - list.current.offsetTop - list.current.clientHeight / 2 + active.clientHeight / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [index, selected]);
  return <div className="listening-room view-enter">
    <div className="section-heading"><div><span className="eyebrow"><span className="status-dot" /> YOUR PRIVATE LISTENING ROOM</span><h1>音乐响起，<em>故事留下。</em></h1></div><span className="room-label"><Headphones size={14} /> 留一点时间，给这一刻</span></div>
    <section className="listening-stage">
      <div className="artwork-column">
        <div className={`record-art ${player.playing ? 'is-playing' : ''}`} aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-dot" />
          <span className="art-coordinate coordinate-top">33° / INNER SPACE</span>
          <div className="vinyl"><div className="vinyl-core"><span>AFTER<br />GLOW<span className="core-period">.</span></span><small>SOUNDS INTO STORIES</small><i /></div></div>
          <div className="art-caption">THE FEELING STAYS.</div>
          <span className="art-coordinate coordinate-bottom">SIDE A — {player.track.lyricSource === 'demo' ? 'DEMO SESSION' : 'YOUR COLLECTION'}</span>
        </div>
        <div className="track-heading"><div><span className="eyebrow">正在聆听</span><h2>{player.track.title}</h2><p>{player.track.artist}</p></div><button className="round-button" onClick={onImport} aria-label="导入自己的音乐" title="导入自己的音乐"><Plus size={20} /></button></div>
        <div className="source-label"><span className="tiny-line" />{player.track.lyricSource === 'demo' ? '合成氛围音 · 原创演示文字 · 无人声' : player.track.lyricSource === 'text' ? '本地音频 · 纯文本歌词，不自动对齐' : player.track.lyricSource === 'none' ? '本地音频 · 尚未添加歌词' : `本地音频 · ${player.track.lyricSource.toUpperCase()} 时间歌词`}</div>
      </div>
      <div className="lyrics-column">
        <div className="lyrics-heading"><span><Music2 size={15} /> LYRIC MOMENTS</span><span>点一句歌词，留下一个瞬间</span></div>
        {player.track.lyrics.length ? <div className="lyrics-list" ref={list}>
          {player.track.lyrics.map((line, i) => <div className={`lyric-row ${i === index ? 'current' : ''} ${selected === line.id ? 'selected' : ''}`} key={line.id} data-current={i === index}>
            <button className="lyric-button" onClick={() => onSelect(line.id)} aria-label={`选择歌词：${line.text}`}><span className="line-time">{line.t === null ? String(i + 1).padStart(2, '0') : formatTime(line.t)}</span><span className="lyric-text">{line.words?.length ? line.words.map((word, wi) => <span key={wi} className={i === index && player.time >= word.t ? 'word-sung' : ''}>{word.text}</span>) : line.text}</span></button>
            {selected === line.id && <button className="capture-inline" onClick={() => onCapture(line)}><BookOpen size={14} /> 记录此刻 <ArrowUpRight size={13} /></button>}
          </div>)}
        </div> : <div className="empty-lyrics"><Music2 size={30} /><h3>给这段声音，添上文字</h3><p>导入时可以粘贴歌词，也可以先记录纯粹的感受。</p><button className="button subtle" onClick={() => onCapture()}>留下此刻</button></div>}
        <div className="lyric-footnote"><Sparkles size={13} /><span>不必写得完整，先别让那个念头跑掉。</span><kbd>Alt</kbd><span>+</span><kbd>N</kbd></div>
      </div>
    </section>
    <section className="recent-section"><div className="recent-title"><span className="eyebrow">RECENT ECHOES</span><h3>那些想留下的瞬间 <span>{moments.length.toString().padStart(2, '0')}</span></h3></div>
      <div className="recent-cards">{moments.length ? moments.slice(0, 2).map((moment) => <button key={moment.id} className="recent-card" onClick={() => onOpen(moment)}><span className="note-index"><BookOpen size={17} /></span><span><strong>{moment.title || moment.body.slice(0, 25) || '还没展开的一个念头'}</strong><small>{moment.trackTitle} <b>·</b> {formatTime(moment.at)}</small></span><ArrowUpRight size={17} /></button>) : <div className="first-moment"><span className="dotted-icon"><BookOpen size={18} /></span><p>这里还很安静。<span>你留下的第一个瞬间，会在这里等你。</span></p></div>}</div>
    </section>
  </div>;
}
