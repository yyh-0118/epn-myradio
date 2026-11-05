import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { createDemoAudio, demoTrack } from '../lib/demo';

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const requestRef = useRef({ at: 0, autoplay: false });
  const [track, setTrack] = useState<Track>(demoTrack);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(demoTrack.duration);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [volume, setVolume] = useState(0.55);
  const [error, setError] = useState('');

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    try {
      if (!contextRef.current) {
        contextRef.current = new AudioContext();
        const source = contextRef.current.createMediaElementSource(audio);
        const analyser = contextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser).connect(contextRef.current.destination);
        analyserRef.current = analyser;
      }
      await contextRef.current.resume();
      await audio.play();
      setError('');
    } catch {
      setError('未能播放。请再次点击播放，或换一个浏览器支持的音频文件。');
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current!;
    let cancelled = false;
    let url = '';
    audio.pause();
    setLoading(true);
    setError('');
    setTime(0);
    setDuration(track.duration);
    const onMetadata = () => {
      if (cancelled) return;
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      audio.currentTime = Math.max(0, Math.min(requestRef.current.at, audio.duration || 0));
      setTime(audio.currentTime);
      setLoading(false);
      if (requestRef.current.autoplay) void play();
      requestRef.current = { at: 0, autoplay: false };
    };
    audio.addEventListener('loadedmetadata', onMetadata);
    void (async () => {
      try {
        const blob = track.id === demoTrack.id ? await createDemoAudio() : track.audio;
        if (cancelled) return;
        if (!blob) throw new Error('missing audio');
        url = URL.createObjectURL(blob);
        audio.src = url;
        audio.load();
      } catch {
        if (!cancelled) { setLoading(false); setError('音频无法载入，请重新导入。笔记仍然保留。'); }
      }
    })();
    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeAttribute('src');
      audio.load();
      if (url) URL.revokeObjectURL(url);
    };
  }, [track.id, track.audio, play]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => () => { void contextRef.current?.close(); }, []);

  const seek = (at: number) => {
    const audio = audioRef.current;
    if (!audio || audio.readyState === 0) return;
    audio.currentTime = Math.max(0, Math.min(at, duration));
    setTime(audio.currentTime);
  };
  const selectTrack = (next: Track, at = 0, autoplay = false) => {
    if (next.id === track.id) {
      if (!audioRef.current || audioRef.current.readyState === 0) {
        requestRef.current = { at, autoplay };
      } else {
        seek(at);
        if (autoplay) void play();
      }
      return;
    }
    requestRef.current = { at, autoplay };
    setTrack(next);
  };

  return {
    audioRef, analyserRef, track, time, duration, playing, loading, volume, error,
    setVolume, setTrack, selectTrack, seek, play,
    toggle: () => audioRef.current?.paused ? void play() : audioRef.current?.pause(),
    events: {
      onTimeUpdate: () => setTime(audioRef.current?.currentTime || 0),
      onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
      onEnded: () => setPlaying(false),
      onError: () => { if (audioRef.current?.getAttribute('src')) { setLoading(false); setPlaying(false); setError('浏览器无法解码此音频，请尝试 MP3、WAV 或其他支持的格式。'); } },
    },
  };
}
export type Player = ReturnType<typeof usePlayer>;
