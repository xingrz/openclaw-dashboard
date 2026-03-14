import { useRef, useEffect, useCallback } from 'react';
import type { DailyUsage } from '../lib/types';

interface UsageChartProps {
  daily: DailyUsage[];
}

export function UsageChart({ daily }: UsageChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !daily.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = devicePixelRatio || 1;
    const rect = canvas.parentElement!.getBoundingClientRect();
    const chartH = Math.min(rect.height || 80, 100);

    canvas.width = rect.width * dpr;
    canvas.height = chartH * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = chartH + 'px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = chartH;
    const pad = { t: 10, r: 10, b: 25, l: 50 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    ctx.clearRect(0, 0, w, h);

    const costs = daily.map((d) => d.totalCost || 0);
    const max = Math.max(...costs, 0.1);
    const n = costs.length;

    // Grid lines
    ctx.strokeStyle = '#1a2540';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ph / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();

      ctx.fillStyle = '#3a4a6b';
      ctx.font = '9px JetBrains Mono';
      ctx.textAlign = 'right';
      ctx.fillText('$' + (max * (1 - i / 4)).toFixed(2), pad.l - 5, y + 3);
    }

    if (n < 2) return;

    // Area fill
    const grd = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grd.addColorStop(0, 'rgba(0,240,255,0.2)');
    grd.addColorStop(1, 'rgba(0,240,255,0)');

    ctx.beginPath();
    costs.forEach((c, i) => {
      const x = pad.l + (i / (n - 1)) * pw;
      const y = pad.t + ph - (c / max) * ph;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineTo(pad.l + pw, pad.t + ph);
    ctx.lineTo(pad.l, pad.t + ph);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();

    // Line
    ctx.beginPath();
    costs.forEach((c, i) => {
      const x = pad.l + (i / (n - 1)) * pw;
      const y = pad.t + ph - (c / max) * ph;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Data points (last 7)
    for (let i = Math.max(0, n - 7); i < n; i++) {
      const x = pad.l + (i / (n - 1)) * pw;
      const y = pad.t + ph - (costs[i] / max) * ph;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = i === n - 1 ? '#00ff88' : '#00f0ff';
      ctx.fill();
    }

    // Date labels
    ctx.fillStyle = '#3a4a6b';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'center';
    const dates = daily.map((d) => d.date);
    ctx.fillText(dates[0]?.slice(5) || '', pad.l, h - 5);
    if (n > 2) {
      const m = Math.floor(n / 2);
      ctx.fillText(dates[m]?.slice(5) || '', pad.l + (m / (n - 1)) * pw, h - 5);
    }
    ctx.fillText(dates[n - 1]?.slice(5) || '', pad.l + pw, h - 5);
  }, [daily]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  return <canvas ref={canvasRef} height={80} />;
}
