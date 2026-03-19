import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { GatewayClient } from './gateway-client.js';
import { ActivityTracker } from './activity-tracker.js';
import { collectMetrics, type DashboardMetrics } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_INTERVAL_MS = 10000;
const STARTUP_DELAY_MS = 3000;

// ── Express & WebSocket Setup ──────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, 'public')));

// ── Services ───────────────────────────────────────────────

const gw = new GatewayClient();
const tracker = new ActivityTracker();

// ── REST API ───────────────────────────────────────────────

app.get('/api/metrics', async (_req, res) => {
  try {
    res.json(await collectMetrics(gw, tracker));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── WebSocket Push ─────────────────────────────────────────

let latestMetrics: DashboardMetrics | null = null;

wss.on('connection', (ws) => {
  if (latestMetrics) {
    ws.send(JSON.stringify({ type: 'metrics', data: latestMetrics }));
  }
});

function broadcast(data: { type: string; data: DashboardMetrics }): void {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ── Update Loop ────────────────────────────────────────────

async function updateLoop(): Promise<void> {
  try {
    latestMetrics = await collectMetrics(gw, tracker);
    broadcast({ type: 'metrics', data: latestMetrics });
  } catch (err) {
    console.error('[update]', (err as Error).message);
  }
  setTimeout(updateLoop, UPDATE_INTERVAL_MS);
}

// ── Error Handling ─────────────────────────────────────────

process.on('uncaughtException', (err) => console.error('[fatal]', err.message));
process.on('unhandledRejection', (err) => console.error('[rejection]', (err as Error)?.message ?? err));

// ── Start ──────────────────────────────────────────────────

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[dashboard] 🦐 http://127.0.0.1:${config.port}`);
  gw.connect();
  tracker.start();
  setTimeout(updateLoop, STARTUP_DELAY_MS);
});
