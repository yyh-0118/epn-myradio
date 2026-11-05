import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function Ambience({ analyser }: { analyser: RefObject<AnalyserNode | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext('2d');
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const data = new Uint8Array(128);
    let width = 0, height = 0, frame = 0;
    const resize = () => {
      width = window.innerWidth; height = window.innerHeight;
      const scale = Math.min(window.devicePixelRatio, 1.5);
      element.width = width * scale; element.height = height * scale;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const draw = (stamp: number) => {
      const t = reduced ? 0 : stamp * 0.00012;
      analyser.current?.getByteFrequencyData(data);
      const energy = data.slice(0, 18).reduce((sum, n) => sum + n, 0) / (18 * 255);
      context.clearRect(0, 0, width, height);
      const glow = context.createRadialGradient(width * 0.38, height * 0.46, 0, width * 0.38, height * 0.46, width * 0.55);
      glow.addColorStop(0, `rgba(81, 144, 136, ${0.055 + energy * 0.06})`);
      glow.addColorStop(1, 'rgba(9, 14, 18, 0)');
      context.fillStyle = glow; context.fillRect(0, 0, width, height);
      for (let i = 0; i < 85; i++) {
        const x = ((i * 137.508 + Math.sin(t + i) * 22) % width + width) % width;
        const y = ((i * 73.31 - t * (i % 5 + 3) * 12) % height + height) % height;
        const opacity = 0.10 + (Math.sin(t * 3 + i * 2) + 1) * 0.13;
        context.fillStyle = i % 5 === 0 ? `rgba(225,180,144,${opacity})` : `rgba(185,213,204,${opacity})`;
        context.beginPath(); context.arc(x, y, i % 4 === 0 ? 1.2 + energy : 0.65, 0, Math.PI * 2); context.fill();
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    resize(); frame = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
  }, [analyser]);
  return <canvas className="ambience" ref={canvas} aria-hidden="true" />;
}
