import { AudioLines, BookOpen, ChevronDown, CircleHelp, Headphones, Layers3, Plus, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { LyricLine, Moment, Track } from './types';
import { activeLineIndex } from './lib/lyrics';
import { storage } from './lib/storage';
import { demoTrack } from './lib/demo';
import { Ambience } from './components/Ambience';
import { PlayerBar } from './components/PlayerBar';
import { ListeningRoom } from './components/ListeningRoom';
import { ImportDialog } from './components/ImportDialog';
import { MomentEntry, Notebook } from './components/Notebook';
import { MomentLibrary } from './components/MomentLibrary';
import { AnalysisPanel } from './components/AnalysisPanel';

type View = 'listen' | 'entry' | 'workbench' | 'library';

export default function App() {
  const player = usePlayer();
  const [view, setView] = useState<View>('listen');
  const [tracks, setTracks] = useState<Track[]>([demoTrack]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const momentsRef = useRef<Moment[]>([]);
  const pendingWrites = useRef(0);
  const revisions = useRef(new Map<string, number>());
  const [saveStates, setSaveStates] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [opening, setOpening] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const activeMoment = moments.find((moment) => moment.id === activeId);
  const notebookTrack = activeMoment ? tracks.find((track) => track.id === activeMoment.trackId) : undefined;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([storage.tracks(), storage.moments()]).then(([savedTracks, savedMoments]) => {
      if (cancelled) return;
      setTracks([demoTrack, ...savedTracks.filter((track) => track.id !== demoTrack.id)]);
      savedMoments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      momentsRef.current = savedMoments;
      setMoments(savedMoments);
    }).catch(() => { if (!cancelled) setNotice('无法读取浏览器存储。你仍可听歌；记录后请检查保存状态并及时导出。'); }).finally(() => { if (!cancelled) setReady(true); });
    const warn = (event: BeforeUnloadEvent) => { if (pendingWrites.current > 0) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { cancelled = true; window.removeEventListener('beforeunload', warn); };
  }, []);

  useEffect(() => { setSelected(null); }, [player.track.id]);
  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => setOpening(false), 720);
    return () => clearTimeout(timer);
  }, [opening]);
  useEffect(() => {
    document.querySelector('.main-content')?.scrollTo({ top: 0 });
  }, [view]);

  const persist = (moment: Moment) => {
    const revision = (revisions.current.get(moment.id) || 0) + 1;
    revisions.current.set(moment.id, revision);
    const next = [moment, ...momentsRef.current.filter((item) => item.id !== moment.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    momentsRef.current = next; setMoments(next);
    setSaveStates((states) => ({ ...states, [moment.id]: 'saving' }));
    pendingWrites.current++;
    void storage.saveMoment(moment).then(() => {
      if (revisions.current.get(moment.id) === revision) setSaveStates((states) => ({ ...states, [moment.id]: 'saved' }));
    }).catch(() => {
      if (revisions.current.get(moment.id) === revision) setSaveStates((states) => ({ ...states, [moment.id]: 'error' }));
      setNotice('本地保存失败，当前文字仍在页面中。请导出备份，避免关闭页面后丢失。');
    }).finally(() => { pendingWrites.current--; });
  };
  const capture = (line?: LyricLine) => {
    if (!ready) return;
    const actualTime = player.audioRef.current?.currentTime || player.time;
    const target = line || player.track.lyrics.find((item) => item.id === selected) || player.track.lyrics[activeLineIndex(player.track.lyrics, actualTime)];
    const now = new Date().toISOString();
    const moment: Moment = {
      id: crypto.randomUUID(), trackId: player.track.id, trackTitle: player.track.title, artist: player.track.artist,
      lineId: target?.id || '', quote: target?.text || '', at: Math.min(player.duration, Math.max(0, target?.t ?? actualTime)), capturedAt: actualTime,
      title: '', body: '', createdAt: now, updatedAt: now,
    };
    persist(moment); setActiveId(moment.id); setOpening(true); setView('entry');
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'KeyN' && !showImport && !showHelp && !event.repeat) { event.preventDefault(); capture(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const openMoment = (moment: Moment) => { setActiveId(moment.id); setView('workbench'); };
  const replay = (moment: Moment) => {
    const track = tracks.find((item) => item.id === moment.trackId);
    if (!track) { setNotice('这条笔记关联的音频暂不可用，文字记录仍然保留。'); return; }
    player.selectTrack(track, Math.max(0, moment.at - 3), true);
  };
  const updateNote = (patch: Partial<Pick<Moment, 'body' | 'title'>>) => {
    const current = momentsRef.current.find((moment) => moment.id === activeId);
    if (current) persist({ ...current, ...patch, updatedAt: new Date().toISOString() });
  };
  const deleteMoment = async (moment: Moment) => {
    if (!window.confirm('删除这个瞬间？此操作不可撤销，建议先导出需要的笔记。')) return;
    try {
      await storage.deleteMoment(moment.id);
      const next = momentsRef.current.filter((item) => item.id !== moment.id);
      momentsRef.current = next; setMoments(next);
      if (activeId === moment.id) setActiveId(null);
    } catch { setNotice('删除失败，记录仍然保留。'); }
  };
  const imported = (track: Track) => {
    setTracks((current) => [...current, track]); player.selectTrack(track); setShowImport(false); setView('listen');
  };

  return <div className="app-shell">
    <audio ref={player.audioRef} {...player.events} preload="metadata" />
    <Ambience analyser={player.analyserRef} />
    <aside className="sidebar"><button className="brand-mark" aria-label="余响首页" onClick={() => setView('listen')}><AudioLines size={27} strokeWidth={1.6} /></button><div className="sidebar-nav"><button className={`nav-button ${view === 'listen' ? 'active' : ''}`} onClick={() => setView('listen')} aria-label="聆听室" title="聆听室"><Headphones size={21} /><span>聆听</span></button><button className={`nav-button ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')} aria-label="瞬间素材库" title="瞬间素材库"><Layers3 size={21} /><span>瞬间</span></button><button className={`nav-button ${view === 'workbench' || view === 'entry' ? 'active' : ''}`} onClick={() => activeMoment ? setView('workbench') : setView('library')} aria-label="创作工作台" title="创作工作台"><BookOpen size={21} /><span>工作台</span></button></div><div className="sidebar-bottom"><button className="icon-button" onClick={() => setShowHelp(true)} aria-label="使用说明"><CircleHelp size={20} /></button><span className="avatar">Y</span></div></aside>
    <div className="app-body">
      <header className="topbar"><button className="wordmark" onClick={() => setView('listen')}>余响<span>AFTERGLOW</span></button><span className="topbar-divider" /><span className="topbar-location">{view === 'listen' ? '聆听室' : view === 'library' ? '瞬间素材库' : view === 'entry' ? '创作空间' : '我的工作台'}</span><div className="topbar-actions"><label className="track-select"><select aria-label="选择歌曲" value={player.track.id} onChange={(e) => { const track = tracks.find((item) => item.id === e.target.value); if (track) player.selectTrack(track); }}><option value={demoTrack.id}>原创演示曲</option>{tracks.filter((track) => track.id !== demoTrack.id).map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}</select><ChevronDown size={13} /></label><button className="button subtle import-button" onClick={() => setShowImport(true)} disabled={!ready}><Upload size={14} /><span>导入音乐</span></button><span className="demo-badge">DEMO <b>01</b></span></div></header>
      <main className="main-content">
        {(notice || player.error) && <div className="notice-banner" role="alert"><span>{notice || player.error}</span>{notice && <button className="icon-button" onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button>}</div>}
        {view === 'listen' && <ListeningRoom player={player} selected={selected} onSelect={(id) => setSelected((current) => current === id ? null : id)} onCapture={capture} moments={moments} onOpen={openMoment} onImport={() => setShowImport(true)} />}
        {view === 'entry' && activeMoment && <MomentEntry moment={activeMoment} onWrite={() => setView('workbench')} onBack={() => setView('listen')} onReplay={() => replay(activeMoment)} />}
        {view === 'workbench' && activeMoment && <Notebook moment={activeMoment} onChange={updateNote} saveState={saveStates[activeMoment.id] || 'saved'} onReplay={() => replay(activeMoment)} onBack={() => setView('library')} analysis={<AnalysisPanel track={notebookTrack} />} />}
        {view === 'library' && <MomentLibrary moments={moments} onOpen={openMoment} onDelete={(moment) => void deleteMoment(moment)} onListen={() => setView('listen')} />}
        <div className="page-footer"><span>MINERADIO × ECHOPULSENODE</span><span>让声音经过，让感受留下。</span></div>
      </main>
      <PlayerBar player={player} onCapture={() => capture()} />
    </div>
    {opening && <div className="book-transition" aria-hidden="true"><div className="book-light" /><div className="turning-page page-left" /><div className="turning-page page-right"><BookOpen size={36} /></div></div>}
    {showImport && <ImportDialog onClose={() => setShowImport(false)} onImported={imported} />}
    {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
  </div>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="help-dialog" onCancel={onClose}><header className="dialog-heading"><div><span className="eyebrow">A LITTLE GUIDE</span><h2>从听见，到留下。</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭使用说明"><X size={20} /></button></header><ol><li><strong>听一首歌</strong><p>先体验合成氛围音，也可以导入自己的音频及 LRC / YRC 歌词。</p></li><li><strong>点一句歌词，记录此刻</strong><p>也可按 Alt + N。先记住片段，再进入工作台，不中断音乐。</p></li><li><strong>写下你自己的话</strong><p>笔记自动保存于此浏览器。切换页面后仍可回看、回听、搜索和导出。</p></li><li><strong>需要时，再打开分析</strong><p>复用 EPN 规则与可选 LLM 分析。默认未启用 LLM，不包含自主素材整理 Agent；当前是融合体验 Demo。</p></li></ol><div className="help-warning">音频不上传，私人笔记不发送给模型。浏览器存储并非永久备份；清理网站数据或更换浏览器会影响记录，请定期导出。模型配置仅在新工程服务端的 .env 中设置。</div><button className="button primary" onClick={onClose}>开始留下瞬间 <Plus size={15} /></button></dialog>;
}
