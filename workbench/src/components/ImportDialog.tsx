import { FileAudio, FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { parseLyrics } from '../lib/lyrics';
import { storage } from '../lib/storage';

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (track: Track) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const selectFile = (value: File | undefined) => {
    if (!value) return;
    if (value.size > 100 * 1024 * 1024) { setError('Demo 暂支持 100 MB 以内的音频。'); return; }
    setFile(value); setTitle(value.name.replace(/\.[^.]+$/, '')); setError('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !title.trim()) return;
    setBusy(true); setError('');
    let url = '';
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = new Audio();
        url = URL.createObjectURL(file);
        const timer = window.setTimeout(() => { cleanup(); reject(new Error('读取音频超时，请换一个文件。')); }, 10_000);
        const cleanup = () => { window.clearTimeout(timer); audio.removeAttribute('src'); audio.load(); };
        audio.onloadedmetadata = () => { const value = audio.duration; audio.onloadedmetadata = null; audio.onerror = null; cleanup(); if (Number.isFinite(value) && value > 0) resolve(value); else reject(new Error('无法读取音频时长。')); };
        audio.onerror = () => { audio.onerror = null; cleanup(); reject(new Error('浏览器不支持这个音频，请尝试 MP3 或 WAV。')); };
        audio.src = url;
      });
      const parsed = parseLyrics(lyrics);
      if (parsed.lyrics.length > 200) throw new Error('Demo 暂支持 200 行以内的歌词。');
      const track: Track = { id: crypto.randomUUID(), title: title.trim(), artist: artist.trim() || '本地音乐', duration, audio: file, fileName: file.name, ...parsed };
      await storage.saveTrack(track);
      onImported(track);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败，可能是浏览器存储空间不足。');
    } finally { if (url) URL.revokeObjectURL(url); setBusy(false); }
  };
  return <dialog ref={dialog} className="import-dialog" onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }} onClick={(e) => { if (e.target === dialog.current && !busy) onClose(); }}>
    <form onSubmit={submit}>
      <header className="dialog-heading"><div><span className="eyebrow">BRING YOUR OWN SOUND</span><h2>把你的音乐带进来</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭导入窗口"><X size={20} /></button></header>
      <label className={`file-drop ${file ? 'has-file' : ''}`}><FileAudio size={28} /><strong>{file ? file.name : '选择一首本地音乐'}</strong><span>MP3 / WAV / FLAC / M4A · 最大 100 MB</span><input aria-label="选择音频文件" type="file" accept="audio/*,.flac,.m4a,.opus" onChange={(e) => selectFile(e.target.files?.[0])} disabled={busy} /></label>
      <div className="form-row"><label>歌曲名<input autoComplete="off" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="这段声音的名字" /></label><label>歌手<input autoComplete="off" maxLength={120} value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="谁的声音" /></label></div>
      <div className="lyrics-input-heading"><label htmlFor="import-lyrics">歌词 <span>可选</span></label><label className="text-file-button"><FileText size={13} /> 读取歌词文件<input aria-label="读取歌词文件" type="file" accept=".lrc,.yrc,.txt" onChange={async (e) => { const value = e.target.files?.[0]; if (!value) return; if (value.size > 96_000) { setError('歌词文件太大，请控制在 12,000 字以内。'); return; } const text = await value.text(); if (text.length > 12_000) { setError('歌词请控制在 12,000 字以内。'); return; } setLyrics(text); }} /></label></div>
      <textarea id="import-lyrics" rows={6} maxLength={12000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={'粘贴 LRC / YRC 时间歌词，或逐行纯文本。\n\n[00:12.00] 从这一句开始，留下你的故事'} />
      <p className="field-hint">时间歌词可跟随播放；纯文本只做阅读，不假装自动对齐。音频与笔记仅保存在此浏览器，不上传音频。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="dialog-footer"><span>仅导入你有权使用的内容</span><button className="button primary" disabled={busy || !file || !title.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{busy ? '正在保存到本地…' : '进入聆听室'}</button></footer>
    </form>
  </dialog>;
}
