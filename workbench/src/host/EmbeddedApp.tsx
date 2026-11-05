import { Archive, BookOpen, Check, ChevronLeft, Clock3, Database, Download, Feather, Library, LoaderCircle, Music2, Pause, Play, Radio, RotateCcw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile } from '../lib/storage';
import { HostRepository } from './repository';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { formatTime } from '../lib/lyrics';
import type { Moment, Track } from '../types';
import { MineradioBridge } from './bridge-client';
import type { BackupInfo, HostCapture, HostSnapshot, ImportPreview, RecoveryInfo } from './contract';
import './embedded.css';

type Tab = 'write' | 'library' | 'analysis';

export default function EmbeddedApp() {
  const bridge = useMemo(() => new MineradioBridge(), []);
  const snapshotRef = useRef<HostSnapshot | null>(null);
  const repositoryRef = useRef<HostRepository | null>(null);
  const loadedRef = useRef(false);
  const consumed = useRef(new Set<string>());
  const momentsRef = useRef<Moment[]>([]);
  const pendingMomentRef = useRef<{ moment: Moment; revision: number } | null>(null);
  const saveTimerRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const editRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const deletedIdsRef = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('write');
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [replayState, setReplayState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [connected, setConnected] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [archiveNotice, setArchiveNotice] = useState('');
  const [importPlan, setImportPlan] = useState<{ token: string; preview: ImportPreview } | null>(null);
  const [importStrategy, setImportStrategy] = useState<'safe' | 'incoming' | 'replace'>('safe');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupBaseUpdatedAt, setBackupBaseUpdatedAt] = useState('');
  const active = moments.find((moment) => moment.id === activeId) || null;

  async function flushPendingMoment(_reason = 'manual') {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;
    const task = saveChainRef.current.catch(() => {}).then(async () => {
      while (pendingMomentRef.current) {
        const pending = pendingMomentRef.current;
        pendingMomentRef.current = null;
        if (deletedIdsRef.current.has(pending.moment.id)) continue;
        try {
          const repository = repositoryRef.current;
          if (!repository) throw new Error('存储尚未连接。');
          await repository.saveMoment(pending.moment);
          persistedRevisionRef.current = Math.max(persistedRevisionRef.current, pending.revision);
        } catch (error) {
          if (!pendingMomentRef.current && !deletedIdsRef.current.has(pending.moment.id)) pendingMomentRef.current = pending;
          throw error;
        }
      }
    });
    saveChainRef.current = task;
    try {
      await task;
      if (!pendingMomentRef.current && persistedRevisionRef.current >= editRevisionRef.current) setSaveState('saved');
      return { ok: true };
    } catch {
      setSaveState('error');
      return { ok: false, error: 'SAVE_FAILED' };
    }
  }

  function scheduleMomentSave(moment: Moment) {
    const revision = ++editRevisionRef.current;
    pendingMomentRef.current = { moment, revision };
    setSaveState('saving');
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void flushPendingMoment('debounce'); }, 700);
  }

  async function navigate(nextTab: Tab, nextActiveId = activeId) {
    const result = await flushPendingMoment('navigation');
    if (!result.ok) return;
    setActiveId(nextActiveId);
    setTab(nextTab);
  }

  useEffect(() => { momentsRef.current = moments; }, [moments]);

  useEffect(() => {
    bridge.setFlushHandler(flushPendingMoment);
    bridge.connect((next, capture) => {
      if (next) {
        snapshotRef.current = next;
        setSnapshot(next);
        setConnected(true);
        if (!loadedRef.current) {
          loadedRef.current = true;
          repositoryRef.current = new HostRepository(bridge, next.capabilities.persistentStorage);
          void repositoryRef.current.bootstrap().then((loaded) => {
            setMoments((current) => {
              const byId = new Map([...loaded.moments, ...current].map((item) => [item.id, item]));
              const merged = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
              momentsRef.current = merged;
              return merged;
            });
            setTracks(loaded.tracks);
            if (loaded.recoveredFromBackup) setRecovery(loaded.recovery);
          }).catch(() => setSaveState('error'));
        }
      }
      if (capture) void consumeCapture(capture);
    });
    return () => bridge.close();
  }, [bridge]);

  async function consumeCapture(capture: HostCapture) {
    if (consumed.current.has(capture.commandId)) return;
    consumed.current.add(capture.commandId);
    const host = snapshotRef.current;
    const lyrics = host?.track?.id === capture.track.id ? host.lyrics : capture.line ? [capture.line] : [];
    const track: Track = {
      id: capture.track.id, provider: capture.track.provider, sourceId: capture.track.sourceId,
      title: capture.track.title, artist: capture.track.artist, duration: capture.track.duration,
      playbackRef: capture.track.playbackRef,
      lyrics, lyricSource: lyrics.some((line) => line.t !== null) ? 'lrc' : lyrics.length ? 'text' : 'none',
    };
    const now = new Date().toISOString();
    const moment: Moment = {
      id: crypto.randomUUID(), trackId: track.id, trackTitle: track.title, artist: track.artist,
      lineId: capture.line?.id || '', quote: capture.line?.text || '', at: capture.line?.t ?? capture.time,
      capturedAt: capture.capturedAt, title: '', body: '', createdAt: now, updatedAt: now,
    };
    setSaveState('saving');
    try {
      if (!repositoryRef.current) throw new Error('存储尚未连接。');
      await repositoryRef.current.saveTrack(track);
      await repositoryRef.current.saveMoment(moment);
      setTracks((items) => [track, ...items.filter((item) => item.id !== track.id)]);
      const nextMoments = [moment, ...momentsRef.current.filter((item) => item.id !== moment.id)];
      momentsRef.current = nextMoments;
      setMoments(nextMoments);
      setActiveId(moment.id);
      setTab('write');
      setSaveState('saved');
    } catch {
      consumed.current.delete(capture.commandId);
      setSaveState('error');
    }
  }

  function updateMoment(patch: Partial<Pick<Moment, 'title' | 'body'>>) {
    const current = momentsRef.current.find((moment) => moment.id === activeId);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const nextMoments = momentsRef.current.map((item) => item.id === next.id ? next : item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    momentsRef.current = nextMoments;
    setMoments(nextMoments);
    scheduleMomentSave(next);
  }

  function requestCapture(lineId?: string) { bridge.send('child.capture.request', { lineId: lineId || null }); }
  async function replay(moment: Moment) {
    const track = tracks.find((item) => item.id === moment.trackId);
    if (!track) { setReplayState('error'); return; }
    setReplayState('loading');
    try {
      const result = await bridge.restoreTrack({
        id: track.id, provider: track.provider || '', sourceId: track.sourceId || '',
        title: track.title, artist: track.artist, duration: track.duration, playbackRef: track.playbackRef,
      }, Math.max(0, moment.at - 3), true);
      setReplayState(result.ok ? 'idle' : 'error');
    } catch { setReplayState('error'); }
  }
  async function removeMoment(moment: Moment) {
    if (!confirm('删除这个瞬间？此操作不可撤销。')) return;
    deletedIdsRef.current.add(moment.id);
    if (pendingMomentRef.current?.moment.id === moment.id) pendingMomentRef.current = null;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;
    await saveChainRef.current.catch(() => {});
    try {
      if (!repositoryRef.current) throw new Error('存储尚未连接。');
      await repositoryRef.current.deleteMoment(moment.id);
      const nextMoments = momentsRef.current.filter((item) => item.id !== moment.id);
      momentsRef.current = nextMoments;
      setMoments(nextMoments);
      if (activeId === moment.id) setActiveId(null);
    } catch {
      deletedIdsRef.current.delete(moment.id);
      setSaveState('error');
    }
  }
  function archiveErrorText(error: unknown) {
    const code = error instanceof Error ? error.message : String(error || '');
    if (code.includes('AFTERGLOW_IMPORT_STALE')) return '预览后本机存档已发生变化，请重新选择文件预览。';
    if (code.includes('UNSUPPORTED_SCHEMA_VERSION')) return '该存档来自更新版本，当前应用无法安全导入。';
    if (code.includes('AFTERGLOW_IMPORT_TOO_LARGE')) return '存档文件超过 64 MB，已停止导入。';
    if (code.includes('DUPLICATE')) return '存档中存在重复记录 ID，未进行任何修改。';
    if (code.includes('INVALID_AFTERGLOW_IMPORT')) return '这不是有效的余响完整存档。';
    return '操作没有完成，本机现有存档未被修改。';
  }

  async function refreshArchive() {
    const repository = repositoryRef.current;
    if (!repository) throw new Error('存储尚未连接。');
    const loaded = await repository.bootstrap();
    momentsRef.current = loaded.moments;
    setMoments(loaded.moments);
    setTracks(loaded.tracks);
    const listed = await repository.listBackups();
    setBackups(listed.backups);
    setBackupBaseUpdatedAt(listed.currentUpdatedAt);
  }

  async function openArchive() {
    setArchiveOpen(true); setArchiveError(''); setArchiveNotice(''); setArchiveBusy(true);
    try {
      const repository = repositoryRef.current;
      if (!repository) throw new Error('存储尚未连接。');
      const listed = await repository.listBackups();
      setBackups(listed.backups); setBackupBaseUpdatedAt(listed.currentUpdatedAt);
    } catch (error) { setArchiveError(archiveErrorText(error)); }
    finally { setArchiveBusy(false); }
  }

  async function exportArchive() {
    setArchiveError(''); setArchiveNotice('');
    if (!(await flushPendingMoment('export')).ok) { setArchiveError('最后一版文字尚未保存，已取消导出。'); return; }
    setArchiveBusy(true);
    try {
      const result = await repositoryRef.current?.exportNotebook();
      if (result && !result.canceled) setArchiveNotice('完整 JSON 存档已导出。');
    } catch (error) { setArchiveError(archiveErrorText(error)); }
    finally { setArchiveBusy(false); }
  }

  async function prepareArchiveImport() {
    setArchiveError(''); setArchiveNotice(''); setImportPlan(null);
    if (!(await flushPendingMoment('import')).ok) { setArchiveError('最后一版文字尚未保存，已取消导入。'); return; }
    setArchiveBusy(true);
    try {
      const prepared = await repositoryRef.current?.prepareImport();
      if (prepared) { setImportPlan({ token: prepared.token, preview: prepared.preview }); setImportStrategy('safe'); }
    } catch (error) { setArchiveError(archiveErrorText(error)); }
    finally { setArchiveBusy(false); }
  }

  async function commitArchiveImport() {
    if (!importPlan) return;
    if (importStrategy === 'replace' && !confirm('完全替换会以导入存档覆盖当前资料。恢复前副本会自动保留，确定继续吗？')) return;
    setArchiveBusy(true); setArchiveError(''); setArchiveNotice('');
    try {
      await repositoryRef.current?.commitImport(importPlan.token, importStrategy);
      setImportPlan(null);
      await refreshArchive();
      setArchiveNotice('导入完成；应用前的本机状态已自动保存为备份。');
    } catch (error) { setArchiveError(archiveErrorText(error)); }
    finally { setArchiveBusy(false); }
  }

  async function restoreArchiveBackup(backup: BackupInfo) {
    if (!confirm(`恢复 ${new Date(backup.createdAt).toLocaleString('zh-CN')} 的备份？当前状态会先自动备份。`)) return;
    if (!(await flushPendingMoment('restore-backup')).ok) { setArchiveError('最后一版文字尚未保存，已取消恢复。'); return; }
    setArchiveBusy(true); setArchiveError(''); setArchiveNotice('');
    try {
      await repositoryRef.current?.restoreBackup(backup.id, backupBaseUpdatedAt);
      await refreshArchive();
      setActiveId(null); setTab('library');
      setArchiveNotice('已恢复所选备份；恢复前状态也已保留。');
    } catch (error) { setArchiveError(archiveErrorText(error)); }
    finally { setArchiveBusy(false); }
  }

  async function dismissRecovery() {
    try { await repositoryRef.current?.acknowledgeRecovery(); setRecovery(null); }
    catch (error) { setArchiveError(archiveErrorText(error)); }
  }

  const filtered = moments.filter((moment) => [moment.title, moment.body, moment.quote, moment.trackTitle, moment.artist].some((text) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const currentLine = snapshot?.lyrics.reduce((found, line) => line.t !== null && line.t <= (snapshot.playback.time || 0) ? line : found, undefined as HostSnapshot['lyrics'][number] | undefined);
  const analysisTrack: Track | undefined = snapshot?.track ? {
    id: snapshot.track.id, provider: snapshot.track.provider, sourceId: snapshot.track.sourceId,
    title: snapshot.track.title, artist: snapshot.track.artist, duration: snapshot.track.duration,
    lyrics: snapshot.lyrics,
    lyricSource: snapshot.lyrics.some((line) => line.words?.length) ? 'yrc' : snapshot.lyrics.some((line) => line.t !== null) ? 'lrc' : snapshot.lyrics.length ? 'text' : 'none',
  } : undefined;

  return <div className="embedded-shell">
    <header className="embedded-topbar">
      <div className="embedded-brand"><span className="brand-glyph"><Radio size={17} /></span><div><strong>余响</strong><span>AFTERGLOW · MINERADIO</span></div></div>
      <div className="host-now"><span className={`host-live ${snapshot?.playback.playing ? 'playing' : ''}`} />{snapshot?.track ? <><strong>{snapshot.track.title}</strong><span>{snapshot.track.artist}</span></> : <span>等待 Mineradio 播放歌曲</span>}</div>
      <div className="embedded-actions"><span className={`connection-state ${connected ? 'connected' : ''}`}>{connected ? '已连接播放器' : '正在连接…'}</span><button aria-label="关闭工作台" onClick={() => bridge.send('child.close.request')}><X size={18} /></button></div>
    </header>
    <aside className="embedded-nav">
      <button className={tab === 'write' ? 'active' : ''} onClick={() => void navigate('write')}><Feather size={18} /><span>写下</span></button>
      <button className={tab === 'library' ? 'active' : ''} onClick={() => void navigate('library')}><Library size={18} /><span>瞬间</span><b>{moments.length}</b></button>
      <button className={tab === 'analysis' ? 'active' : ''} onClick={() => void navigate('analysis')}><Sparkles size={18} /><span>分析</span></button>
    </aside>
    <main className="embedded-main">
      {recovery && <div className="recovery-banner" role="status"><RotateCcw size={18} /><div><strong>主存档曾无法读取，已自动恢复备份</strong><span>恢复自 {new Date(recovery.backupUpdatedAt).toLocaleString('zh-CN')}。建议现在导出一份完整 JSON。</span></div><button onClick={() => void openArchive()}>查看存档</button><button aria-label="知道了" onClick={() => void dismissRecovery()}><X size={15} /></button></div>}
      {tab === 'write' && (active ? <section className="embedded-note">
        <div className="note-route"><button onClick={() => void navigate('library', null)}><ChevronLeft size={14} />素材库</button><span className={`save-indicator ${saveState}`}>{saveState === 'saving' ? <LoaderCircle className="spinner" size={13} /> : saveState === 'saved' ? <Check size={13} /> : null}{saveState === 'saving' ? '正在保存' : saveState === 'saved' ? '已保存到本机工作台' : '保存失败，请导出备份'}</span></div>
        <div className="note-layout">
          <article className="writing-page">
            <div className="source-card"><div><Music2 size={13} /><span>{active.trackTitle}</span><small>{formatTime(active.at)}</small></div><blockquote>“{active.quote || '这一刻没有歌词，但声音还在。'}”</blockquote><button disabled={replayState === 'loading'} onClick={() => void replay(active)}>{replayState === 'loading' ? <LoaderCircle className="spinner" size={12} /> : <Play size={12} fill="currentColor" />}{replayState === 'loading' ? '正在恢复歌曲…' : replayState === 'error' ? '暂时无法恢复，点击重试' : '从前 3 秒回听'}</button></div>
            <input aria-label="笔记标题" value={active.title} maxLength={120} onChange={(event) => updateMoment({ title: event.target.value })} placeholder="给这个瞬间起个名字，也可以先空着" />
            <textarea aria-label="瞬间笔记" autoFocus value={active.body} maxLength={100000} onChange={(event) => updateMoment({ body: event.target.value })} placeholder={'刚才，你想到了什么？\n\n不必完整，也不必漂亮。先别让那个念头跑掉。'} />
            <footer><span>{active.body.length} 字 · {new Date(active.createdAt).toLocaleDateString('zh-CN')}</span><button onClick={() => downloadFile(`${(active.title || '余响笔记').replace(/[<>:"/\\|?*]/g, '_')}.md`, `# ${active.title || '一个听歌瞬间'}\n\n> ${active.quote}\n\n${active.body}`, 'text/markdown;charset=utf-8')}>导出 Markdown</button></footer>
          </article>
          <aside className="context-rail"><span className="rail-label">正在播放的上下文</span>{snapshot?.lyrics.slice(Math.max(0, snapshot.lyrics.findIndex((line) => line.id === active.lineId) - 2), Math.max(0, snapshot.lyrics.findIndex((line) => line.id === active.lineId) - 2) + 5).map((line) => <button key={line.id} className={line.id === active.lineId ? 'selected' : ''} onClick={() => requestCapture(line.id)}><span>{line.t === null ? '—' : formatTime(line.t)}</span>{line.text}</button>)}<div className="privacy-note"><Database size={14} /><p>{snapshot?.capabilities.persistentStorage ? '记录已写入 Electron 稳定数据目录，并保留版本化备份。' : '当前是浏览器预览，记录暂存于此浏览器。'}</p></div></aside>
        </div>
      </section> : <section className="capture-home">
        <span className="section-kicker">A MOMENT FROM MINERADIO</span><h1>先把这一刻，<br />从音乐里轻轻取出来。</h1>
        <div className="live-quote"><div><span className={`pulse ${snapshot?.playback.playing ? 'playing' : ''}`} /><span>{snapshot?.track ? `${snapshot.track.title} · ${formatTime(snapshot.playback.time)}` : '还没有正在播放的歌曲'}</span></div><blockquote>{currentLine?.text || '播放一首歌。被打动时，不必等到想好怎么写。'}</blockquote><button disabled={!snapshot?.track} onClick={() => requestCapture(currentLine?.id)}><BookOpen size={17} />记录当前这一句</button></div>
        <div className="capture-principles"><span><Clock3 size={15} /><b>音乐不中断</b><small>主播放器继续掌管声音</small></span><span><Feather size={15} /><b>先写，后分析</b><small>不让工具盖过你的感受</small></span><span><Database size={15} /><b>上下文已关联</b><small>曲目、歌词与时间一起留下</small></span></div>
      </section>)}
      {tab === 'library' && <section className="embedded-library"><div className="library-heading"><div><span className="section-kicker">YOUR ECHO ARCHIVE</span><h1>那些想留下的瞬间</h1></div><div className="library-tools"><label><Search size={15} /><input aria-label="搜索瞬间" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名、歌词或自己的话" /></label>{snapshot?.capabilities.notebookArchive && <button className="archive-button" onClick={() => void openArchive()}><Archive size={15} />存档</button>}</div></div>{filtered.length ? <div className="library-grid">{filtered.map((moment) => <article key={moment.id}><button className="open-card" onClick={() => void navigate('write', moment.id)}><div><span>{formatTime(moment.at)}</span><span>{new Date(moment.createdAt).toLocaleDateString('zh-CN')}</span></div><blockquote>“{moment.quote || '一个没有歌词的瞬间'}”</blockquote><h3>{moment.title || '还没起名字的瞬间'}</h3><p>{moment.body || '这里还留着一页空白，等你回来接着写。'}</p><small>{moment.trackTitle} · {moment.artist}</small></button><button className="delete-card" aria-label={`删除 ${moment.title || '未命名瞬间'}`} onClick={() => void removeMoment(moment)}><Trash2 size={13} /></button></article>)}</div> : <div className="library-zero"><BookOpen size={31} /><h2>这里还很安静。</h2><p>回到正在播放的歌词，留下第一个瞬间。</p><button onClick={() => void navigate('write')}>回到此刻</button></div>}</section>}
      {tab === 'analysis' && <section className="analysis-scaffold"><span className="section-kicker">ECHOPULSENODE · LIVE ANALYSIS</span><h1>理解作品，但不替你感动。</h1><div className="embedded-analysis-layout"><AnalysisPanel track={analysisTrack} /><div><div className="analysis-frame"><Sparkles size={27} /><div><h2>{snapshot?.capabilities.epnAnalysis ? 'EPN 本地分析服务已连接' : 'EPN 服务暂时不可用'}</h2><p>主动点击后，只发送当前歌词、歌名与歌手。播放器账户、Cookie、音频地址与私人笔记不会发送到分析层。</p></div><span>{snapshot?.capabilities.epnAnalysis ? '服务可用' : '可稍后重试'}</span></div><div className="boundary-grid"><div><b>会发送</b><p>用户主动选择的歌词、歌名与歌手</p></div><div><b>不会发送</b><p>音乐账户令牌、音频地址、未授权的私人笔记</p></div><div><b>结果边界</b><p>情感是文本解释角度，不是客观心理结论</p></div></div></div></div></section>}
    </main>
    {archiveOpen && <div className="archive-modal-backdrop" role="presentation"><section className="archive-modal" role="dialog" aria-modal="true" aria-label="完整存档与备份"><header><div><Archive size={18} /><span><strong>完整存档与备份</strong><small>只包含笔记、歌词和安全曲目标识</small></span></div><button aria-label="关闭存档管理" disabled={archiveBusy} onClick={() => { setArchiveOpen(false); setImportPlan(null); }}><X size={17} /></button></header>
      <div className="archive-actions"><button disabled={archiveBusy} onClick={() => void exportArchive()}><Download size={16} /><span><b>导出完整 JSON</b><small>生成可迁移、可人工保管的完整副本</small></span></button><button disabled={archiveBusy} onClick={() => void prepareArchiveImport()}><Upload size={16} /><span><b>导入 JSON</b><small>先校验并预览，不会立即覆盖</small></span></button></div>
      {archiveBusy && <div className="archive-progress"><LoaderCircle className="spinner" size={15} />正在安全处理存档…</div>}
      {archiveError && <p className="archive-message error" role="alert">{archiveError}</p>}
      {archiveNotice && <p className="archive-message success" role="status">{archiveNotice}</p>}
      {importPlan && <div className="import-preview"><h3>导入前预览</h3><div className="preview-grid"><span><b>{importPlan.preview.moments.added}</b>新增瞬间</span><span><b>{importPlan.preview.moments.incomingNewer}</b>导入内容较新</span><span><b>{importPlan.preview.moments.localNewer}</b>本机内容较新</span><span><b>{importPlan.preview.moments.diverged}</b>内容分歧</span><span><b>{importPlan.preview.tracks.added}</b>新增曲目</span><span><b>{importPlan.preview.tracks.conflict}</b>曲目冲突</span></div>{importPlan.preview.orphanedMoments > 0 && <p>{importPlan.preview.orphanedMoments} 条记录缺少曲目快照；文字会保留，但可能暂时无法回听。</p>}<fieldset><legend>冲突处理</legend><label><input type="radio" checked={importStrategy === 'safe'} onChange={() => setImportStrategy('safe')} />安全合并（推荐）：保留较新笔记，曲目冲突保留本机</label><label><input type="radio" checked={importStrategy === 'incoming'} onChange={() => setImportStrategy('incoming')} />导入内容覆盖同 ID 冲突</label><label><input type="radio" checked={importStrategy === 'replace'} onChange={() => setImportStrategy('replace')} />完全替换当前存档</label></fieldset><div className="preview-actions"><button disabled={archiveBusy} onClick={() => setImportPlan(null)}>取消</button><button disabled={archiveBusy} onClick={() => void commitArchiveImport()}>确认导入</button></div></div>}
      <div className="backup-list"><div><h3>自动版本备份</h3><small>最近保留 {backups.length} 个版本；恢复前会再次备份当前状态</small></div>{backups.length ? backups.map((backup) => <article key={backup.id}><span><b>{new Date(backup.createdAt).toLocaleString('zh-CN')}</b><small>{backup.moments} 条瞬间 · {backup.tracks} 首曲目 · {Math.max(1, Math.round(backup.bytes / 1024))} KB</small></span><button disabled={archiveBusy} onClick={() => void restoreArchiveBackup(backup)}><RotateCcw size={13} />恢复</button></article>) : <p>创建第二次保存后，这里会出现可恢复版本。</p>}</div>
    </section></div>}
    <footer className="embedded-player"><div><span className="mini-disc" /><div><strong>{snapshot?.track?.title || '等待音乐'}</strong><span>{snapshot?.track?.artist || 'Mineradio'}</span></div></div><div className="remote-controls"><button disabled={!snapshot?.track} onClick={() => bridge.send(snapshot?.playback.playing ? 'child.pause' : 'child.play')}>{snapshot?.playback.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><span>{formatTime(snapshot?.playback.time || 0)}</span><i><b style={{ width: `${Math.min(100, (snapshot?.playback.time || 0) / Math.max(1, snapshot?.playback.duration || 1) * 100)}%` }} /></i><span>{formatTime(snapshot?.playback.duration || 0)}</span></div><button className="quick-capture" disabled={!snapshot?.track} onClick={() => requestCapture(currentLine?.id)}><BookOpen size={15} />记录此刻</button></footer>
  </div>;
}
