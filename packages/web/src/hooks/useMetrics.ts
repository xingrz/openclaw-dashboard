import { useState, useEffect, useRef, useCallback } from 'react';
import type { DashboardMetrics } from '../lib/types';

export type WsStatus = 'connecting' | 'live' | 'offline';

export interface UseMetricsResult {
  data: DashboardMetrics | null;
  wsStatus: WsStatus;
}

export function useMetrics(): UseMetricsResult {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.replace(/\/+$/, '');
    const ws = new WebSocket(`${proto}://${location.host}${base}/ws`);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => {
      setWsStatus('live');
      clearTimeout(reconnectRef.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'metrics') setData(msg.data);
      } catch {
        // Ignore malformed messages.
      }
    };

    ws.onclose = () => {
      setWsStatus('offline');
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();

    // Fallback: if WS hasn't connected after 5s, try REST API.
    const fallback = setTimeout(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        const base = location.pathname.replace(/\/+$/, '');
        fetch(base + '/api/metrics')
          .then((r) => r.json())
          .then(setData)
          .catch(() => {});
      }
    }, 5000);

    return () => {
      clearTimeout(fallback);
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { data, wsStatus };
}
