import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { GatewayClient } from './gateway-client.js';

const CACHE_FILE = path.join(process.cwd(), '.task-summary-cache.json');
const MAX_BATCH = 6;
const SUMMARY_SESSION_KEY = `agent:main:dashboard-task-summarizer:${process.pid}`;
const GATEWAY_TIMEOUT_MS = 120_000;

export interface TaskSummaryInput {
  key: string;
  task: string;
}

interface CacheEntry {
  title: string;
  updatedAt: number;
}

type SummaryCache = Record<string, CacheEntry>;

interface GatewaySessionMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

export class TaskSummarizer {
  private _cache: SummaryCache = this._loadCache();
  private _inFlight: Promise<void> | null = null;
  private _gw = new GatewayClient();
  private _gwReady: Promise<void> | null = null;

  constructor() {
    this._gw.connect();
  }

  getTitle(key: string): string | null {
    return this._cache[key]?.title ?? null;
  }

  async ensureSummaries(tasks: TaskSummaryInput[]): Promise<void> {
    const missing = tasks.filter((task) => !this._cache[task.key]?.title).slice(0, MAX_BATCH);
    if (missing.length === 0) return;
    if (this._inFlight) return this._inFlight;

    this._inFlight = this._summarizeBatch(missing)
      .catch((err) => {
        console.error('[task-summary]', (err as Error).message);
      })
      .finally(() => {
        this._inFlight = null;
      });

    return this._inFlight;
  }

  private async _summarizeBatch(tasks: TaskSummaryInput[]): Promise<void> {
    await this._waitForGateway();

    const prompt = [
      '你在为监控大屏生成任务标题。',
      '请根据每个任务的“用户原始诉求”，各写一句简短自然的中文标题。',
      '要求：',
      '1. 每条标题尽量控制在 8 到 24 个汉字，不必整齐划一，像人写的小标题即可。',
      '2. 不要复述协议提示、媒体注入说明、reply tag。',
      '3. 标题只反映用户要做什么，不要夹带执行结果。',
      '4. 不要输出解释，只输出 JSON。',
      '5. JSON 格式必须是 {"items":[{"key":"...","title":"..."}] }。',
      '',
      JSON.stringify({ tasks }, null, 2),
    ].join('\n');

    const response = await this._gw.call(
      'agent',
      {
        sessionKey: SUMMARY_SESSION_KEY,
        label: 'dashboard-task-summarizer',
        message: prompt,
        thinking: 'minimal',
        deliver: false,
        idempotencyKey: `dashboard-task-summarizer:${randomUUID()}`,
      },
      GATEWAY_TIMEOUT_MS,
    );

    const text = await this._extractSummaryText(response);
    const parsed = this._extractJson(text);

    for (const item of parsed.items ?? []) {
      if (!item || typeof item.key !== 'string' || typeof item.title !== 'string') continue;
      const title = item.title.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!title) continue;
      this._cache[item.key] = { title, updatedAt: Date.now() };
    }

    this._saveCache();
  }

  private async _waitForGateway(): Promise<void> {
    if (this._gw.connected) return;
    if (!this._gwReady) {
      this._gwReady = new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
          if (this._gw.connected) {
            clearInterval(timer);
            this._gwReady = null;
            resolve();
            return;
          }
          if (Date.now() - startedAt > 10_000) {
            clearInterval(timer);
            this._gwReady = null;
            reject(new Error('Gateway not connected'));
          }
        }, 100);
      });
    }
    await this._gwReady;
  }

  private async _extractSummaryText(response: unknown): Promise<string> {
    const direct = this._extractText(response);
    if (direct) return direct;

    const session = await this._gw.call(
      'sessions.get',
      { key: SUMMARY_SESSION_KEY, limit: 20 },
      GATEWAY_TIMEOUT_MS,
    ) as { messages?: GatewaySessionMessage[] };

    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (const msg of [...messages].reverse()) {
      if (msg?.role !== 'assistant') continue;
      const text = this._extractMessageText(msg);
      if (text) return text;
    }

    throw new Error('No summary text returned');
  }

  private _extractText(payload: unknown): string | null {
    const payloadText = (payload as { result?: { payloads?: Array<{ text?: unknown }> } })?.result?.payloads?.[0]?.text;
    if (typeof payloadText === 'string' && payloadText.trim()) return payloadText;

    const resultText = (payload as { result?: { text?: unknown; reply?: unknown } })?.result?.text;
    if (typeof resultText === 'string' && resultText.trim()) return resultText;

    const text = (payload as { text?: unknown })?.text;
    if (typeof text === 'string' && text.trim()) return text;

    const reply = (payload as { reply?: unknown; result?: { reply?: unknown } })?.reply ?? (payload as { result?: { reply?: unknown } })?.result?.reply;
    if (typeof reply === 'string' && reply.trim()) return reply;

    return null;
  }

  private _extractMessageText(message: GatewaySessionMessage): string | null {
    if (typeof message.content === 'string') {
      return message.content.trim() || null;
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text?.trim() ?? '')
        .filter(Boolean)
        .join('\n')
        .trim();
      return text || null;
    }

    return null;
  }

  private _extractJson(text: string): { items?: Array<{ key: string; title: string }> } {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in summary response');
    return JSON.parse(match[0]);
  }

  private _loadCache(): SummaryCache {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as SummaryCache;
    } catch {
      return {};
    }
  }

  private _saveCache(): void {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this._cache, null, 2));
  }
}
