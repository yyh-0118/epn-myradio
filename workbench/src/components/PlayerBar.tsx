import { BookmarkPlus, LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { Player } from '../hooks/usePlayer';
import { formatTime } from '../lib/lyrics';

export function PlayerBar({ player, onCapture }: { player: Player; onCapture: () => void }) {
  return <footer className="player-bar" aria-label="音乐播放控制">
    <div className="now-playing">
      <div className={`mini-record ${player.playing ? 'spinning' : ''}`}><i /></div>
      <div><strong>{player.track.title}</strong><span>{player.track.artist}</span></div>
    </div>
    <div className="transport">
      <div className="transport-buttons">
        <button className="icon-button" onClick={() => player.seek(player.time - 10)} aria-label="后退 10 秒" title="后退 10 秒"><SkipBack size={17} /></button>
        <button className="play-button" onClick={player.toggle} disabled={player.loading} aria-label={player.playing ? '暂停' : '播放'}>
          {player.loading ? <LoaderCircle size={21} className="spin" /> : player.playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <button className="icon-button" onClick={() => player.seek(player.time + 10)} aria-label="前进 10 秒" title="前进 10 秒"><SkipForward size={17} /></button>
      </div>
      <div className="scrubber"><span>{formatTime(player.time)}</span><input aria-label="播放进度" type="range" min="0" max={player.duration || 1} step="0.1" value={player.time} onChange={(e) => player.seek(Number(e.target.value))} style={{ '--progress': `${player.time / (player.duration || 1) * 100}%` } as React.CSSProperties} /><span>{formatTime(player.duration)}</span></div>
    </div>
    <div className="player-extras"><button className="icon-button" aria-label={player.volume ? '静音' : '取消静音'} onClick={() => player.setVolume(player.volume ? 0 : 0.55)}>{player.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(e) => player.setVolume(Number(e.target.value))} /><span className="bar-divider" /><button className="icon-button capture-player" onClick={onCapture} aria-label="记录播放中的瞬间" title="记录此刻 · Alt + N"><BookmarkPlus size={21} /></button></div>
  </footer>;
}
