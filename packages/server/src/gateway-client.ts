import WebSocket from 'ws';
import { config } from './config.js';
import { base64UrlEncode, derivePublicKeyRaw, signPayload, normalizeMetadata, loadOrCreateIdentity } from './identity.js';
import type { DeviceIdentity } from './identity.js';

const RECONNECT_DELAY_MS = 5000;
const RPC_TIMEOUT_MS = 10000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface GatewayMessage {
  type: string;
  id?: string;
  event?: string;
  method?: string;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}

export class GatewayClient {
  private _ws: WebSocket | null = null;
  private _connected = false;
  private _pending = new Map<string, PendingRequest>();
  private _reqId = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _identity: DeviceIdentity;

  constructor() {
    this._identity = loadOrCreateIdentity();
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Establish (or re-establish) a WebSocket connection to the gateway. */
  connect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    const url = `ws://127.0.0.1:${config.gwPort}`;
    this._ws = new WebSocket(url);

    this._ws.on('open', () => {
      console.log('[gw] Connected, awaiting challenge...');
    });

    this._ws.on('message', (data) => {
      try {
        this._handleMessage(JSON.parse(data.toString()) as GatewayMessage);
      } catch {
        // Ignore malformed messages.
      }
    });

    this._ws.on('close', () => {
      this._connected = false;
      this._scheduleReconnect();
    });

    this._ws.on('error', (err) => {
      console.error('[gw] Error:', err.message);
    });
  }

  /** Send an RPC call and return a promise for the result. */
  async call(method: string, params: Record<string, unknown> = {}, timeout = RPC_TIMEOUT_MS): Promise<unknown> {
    if (!this._connected || this._ws?.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = this._nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });
      this._ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  // ── Private ──────────────────────────────────────────────

  private _nextId(): string {
    return 'd-' + (++this._reqId);
  }

  private _scheduleReconnect(): void {
    if (!this._reconnectTimer) {
      this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    }
  }

  private _handleMessage(msg: GatewayMessage): void {
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this._authenticate(msg.payload ?? {});
      return;
    }

    if (msg.type === 'res') {
      this._handleResponse(msg);
    }
  }

  private _handleResponse(msg: GatewayMessage): void {
    const pending = this._pending.get(msg.id!);
    if (!pending) return;

    this._pending.delete(msg.id!);
    clearTimeout(pending.timer);

    if (msg.ok) {
      if ((msg.payload as Record<string, unknown>)?.type === 'hello-ok') {
        this._connected = true;
        console.log('[gw] ✅ Ready');
      }
      pending.resolve(msg.payload);
    } else {
      pending.reject(new Error(msg.error?.message ?? 'RPC error'));
    }
  }

  private _authenticate(challenge: Record<string, unknown>): void {
    const nonce = (challenge.nonce as string) || '';
    const signedAtMs = Date.now();
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];

    const payload = [
      'v3', this._identity.deviceId, 'gateway-client', 'backend', 'operator',
      scopes.join(','), String(signedAtMs), config.gwToken || '', nonce,
      normalizeMetadata('linux'), normalizeMetadata('Linux'),
    ].join('|');

    const sig = signPayload(this._identity.privateKeyPem, payload);
    const publicKeyB64 = base64UrlEncode(derivePublicKeyRaw(this._identity.publicKeyPem));

    const id = this._nextId();
    this._pending.set(id, {
      resolve: () => {},
      reject: (err) => console.error('[gw] Auth failed:', err.message),
      timer: setTimeout(() => this._pending.delete(id), RPC_TIMEOUT_MS),
    });

    this._ws!.send(JSON.stringify({
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'gateway-client', version: '0.1.0', platform: 'linux', deviceFamily: 'Linux', mode: 'backend' },
        role: 'operator',
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        locale: 'zh-CN',
        userAgent: 'openclaw-dashboard/0.1.0',
        ...(config.gwToken ? { auth: { token: config.gwToken } } : {}),
        device: {
          id: this._identity.deviceId,
          publicKey: publicKeyB64,
          signature: sig,
          signedAt: signedAtMs,
          nonce,
        },
      },
    }));
  }
}
