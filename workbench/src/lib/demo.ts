import type { Track } from '../types';

export const demoTrack: Track = {
  id: 'afterglow-demo-v1',
  title: '如果回声有形状',
  artist: 'Afterglow · 原创演示',
  duration: 72,
  lyricSource: 'demo',
  lyrics: [
    '晚风经过那条熟悉的街巷',
    '把没说出口的话轻轻收藏',
    '我们在不同的站台望向远方',
    '却把同一场落日放在心上',
    '如果回声也能拥有形状',
    '会不会是你转身时的模样',
    '在另一个故事开始的地方',
    '让那句没说完的话慢慢生长',
  ].map((text, index) => ({ id: `line-${index + 1}`, text, t: index * 8, duration: 8 })),
};

let demoAudio: Promise<Blob> | undefined;
export function createDemoAudio(): Promise<Blob> {
  if (demoAudio) return demoAudio;
  demoAudio = (async () => {
    const rate = 22050;
    const length = rate * demoTrack.duration;
    const context = new OfflineAudioContext(2, length, rate);
    const master = context.createGain();
    master.gain.value = 0.38;
    master.connect(context.destination);
    const notes = [130.81, 164.81, 196, 246.94, 110, 130.81, 164.81, 196];
    for (let step = 0; step < 72; step++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      oscillator.type = 'sine';
      oscillator.frequency.value = notes[step % notes.length] * (step % 3 === 0 ? 2 : 1);
      gain.gain.setValueAtTime(0, step);
      gain.gain.linearRampToValueAtTime(0.16, step + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, step + 2.8);
      pan.pan.value = Math.sin(step * 0.7) * 0.6;
      oscillator.connect(gain).connect(pan).connect(master);
      oscillator.start(step);
      oscillator.stop(Math.min(step + 3, 72));
    }
    for (let beat = 0; beat < 72; beat++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(90, beat);
      oscillator.frequency.exponentialRampToValueAtTime(42, beat + 0.16);
      gain.gain.setValueAtTime(0.16, beat);
      gain.gain.exponentialRampToValueAtTime(0.001, beat + 0.28);
      oscillator.connect(gain).connect(master);
      oscillator.start(beat);
      oscillator.stop(beat + 0.3);
    }
    const buffer = await context.startRendering();
    const wav = new ArrayBuffer(44 + length * 4);
    const view = new DataView(wav);
    const write = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, length * 4, true);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const fade = Math.min(1, (length - i) / rate / 2);
      view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i] * fade)) * 32767, true);
      view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i] * fade)) * 32767, true);
    }
    return new Blob([wav], { type: 'audio/wav' });
  })().catch((error) => { demoAudio = undefined; throw error; });
  return demoAudio;
}
