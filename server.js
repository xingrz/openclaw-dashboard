const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3210;
const GW_PORT = process.env.GW_PORT || process.env.OPENCLAW_GATEWAY_PORT || 18789;
const IDENTITY_FILE = path.join(__dirname, '.device-identity.json');

// Resolve gateway token from config file directly
function resolveGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  if (process.env.GW_TOKEN) return process.env.GW_TOKEN;
  try {
    const configPath = path.join(process.env.HOME, '.openclaw/openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const token = config?.gateway?.auth?.token;
    if (typeof token === 'string' && token && !token.startsWith('__OPENCLAW')) return token;
  } catch {}
  return '';
}
const GW_TOKEN = resolveGatewayToken();

app.use(express.static(path.join(__dirname, 'public')));

// --- Crypto helpers (matching OpenClaw's implementation) ---
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function normalizeMetadata(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : '';
}

function buildDeviceAuthPayloadV3(params) {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const platform = normalizeMetadata(params.platform);
  const deviceFamily = normalizeMetadata(params.deviceFamily);
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join('|');
}

// --- Device identity (persistent) ---
function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    const data = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
    data.deviceId = fingerprintPublicKey(data.publicKeyPem);
    return data;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const identity = {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  return identity;
}

const deviceIdentity = loadOrCreateIdentity();
console.log('[identity] Device ID:', deviceIdentity.deviceId.slice(0, 16) + '...');

// --- Gateway WebSocket Client ---
class GatewayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.pending = new Map();
    this.reqId = 0;
    this._reconnectTimer = null;
  }

  connect() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }

    const url = `ws://127.0.0.1:${GW_PORT}`;
    console.log('[gw] Connecting to', url);
    this.ws = new WebSocket(url);

    this.ws.on('message', (data) => {
      try { this._handleMessage(JSON.parse(data.toString())); } catch {}
    });

    this.ws.on('open', () => {
      console.log('[gw] WebSocket open, waiting for challenge...');
    });

    this.ws.on('close', () => {
      console.log('[gw] Disconnected');
      this.connected = false;
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[gw] Error:', err.message);
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  _handleMessage(msg) {
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this._sendConnect(msg.payload);
      return;
    }

    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) {
          if (msg.payload?.type === 'hello-ok') {
            this.connected = true;
            console.log('[gw] ✅ Connected (protocol', msg.payload.protocol + ')');
          }
          p.resolve(msg.payload);
        } else {
          console.error('[gw] RPC error:', msg.error?.message, msg.error?.details?.code || '');
          p.reject(new Error(msg.error?.message || 'RPC error'));
        }
      }
    }
  }

  _sendConnect(challenge) {
    const nonce = challenge?.nonce || '';
    const signedAtMs = Date.now();
    const clientId = 'gateway-client';
    const clientMode = 'backend';
    const role = 'operator';
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    const platform = 'linux';
    const deviceFamily = 'Linux';

    const payload = buildDeviceAuthPayloadV3({
      deviceId: deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: GW_TOKEN || null,
      nonce,
      platform,
      deviceFamily,
    });

    const signature = signDevicePayload(deviceIdentity.privateKeyPem, payload);
    const publicKey = base64UrlEncode(derivePublicKeyRaw(deviceIdentity.publicKeyPem));

    const id = this._nextId();
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '0.1.0',
        platform,
        deviceFamily,
        mode: clientMode,
      },
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      locale: 'zh-CN',
      userAgent: 'openclaw-dashboard/0.1.0',
      device: {
        id: deviceIdentity.deviceId,
        publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    };

    if (GW_TOKEN) {
      params.auth = { token: GW_TOKEN };
    }

    this.pending.set(id, {
      resolve: () => {},
      reject: (err) => { console.error('[gw] Connect failed:', err.message); },
      timer: setTimeout(() => { this.pending.delete(id); console.error('[gw] Connect timeout'); }, 10000),
    });

    this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params }));
  }

  _nextId() { return 'dash-' + (++this.reqId); }

  async call(method, params = {}, timeout = 10000) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    const id = this._nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
}

const gw = new GatewayClient();

// --- Metrics collection ---
async function collectMetrics() {
  const result = { timestamp: Date.now(), gwConnected: gw.connected };

  if (gw.connected) {
    const [health, status, presence] = await Promise.all([
      gw.call('health').catch(e => { console.error('[rpc] health:', e.message); return null; }),
      gw.call('status').catch(e => { console.error('[rpc] status:', e.message); return null; }),
      gw.call('system-presence').catch(e => null),
    ]);
    result.health = health;
    result.status = status;
    result.presence = presence;
  }

  // usage-cost via CLI (no RPC method)
  try {
    const raw = execSync('openclaw gateway usage-cost --json 2>/dev/null', {
      encoding: 'utf-8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' },
    }).trim();
    const idx = raw.indexOf('{');
    if (idx >= 0) result.usageCost = JSON.parse(raw.slice(idx));
  } catch {}

  return result;
}

// REST fallback
app.get('/api/metrics', async (req, res) => {
  try { res.json(await collectMetrics()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// WebSocket push to dashboard viewers
let latestMetrics = null;
let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  console.log(`[ws] +1 (${clientCount})`);
  if (latestMetrics) ws.send(JSON.stringify({ type: 'metrics', data: latestMetrics }));
  ws.on('close', () => { clientCount--; console.log(`[ws] -1 (${clientCount})`); });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

async function updateLoop() {
  try {
    latestMetrics = await collectMetrics();
    broadcast({ type: 'metrics', data: latestMetrics });
    const sc = latestMetrics.status?.sessions?.count || '?';
    console.log(`[update] OK — ${sc} sessions, ${clientCount} viewers, gw:${gw.connected}`);
  } catch (e) {
    console.error('[update] Error:', e.message);
  }
  setTimeout(updateLoop, 15000);
}

process.on('uncaughtException', (err) => console.error('[fatal]', err.message));
process.on('unhandledRejection', (err) => console.error('[rejection]', err?.message || err));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dashboard] 🦐 http://127.0.0.1:${PORT}`);
  gw.connect();
  // Start update loop after giving gateway time to connect
  setTimeout(updateLoop, 3000);
});
