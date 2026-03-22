import fs from 'fs';

/**
 * Noise patterns to strip from user message text.
 * These are system-injected metadata lines that aren't meaningful for display.
 */
const SYSTEM_NOISE_PATTERNS: RegExp[] = [
  /^System:.*$/gm,
  /^Conversation info.*$/gm,
  /^Sender.*$/gm,
  /^To send an image back,.*$/gm,
  /^If you must inline,.*$/gm,
  /^Avoid absolute paths.*$/gm,
  /^Current time:.*$/gm,
  /```json[\s\S]*?```/g,
  /\[media attached:.*?\]/g,
  /\[image data.*?\]/g,
  /\[\[[^\]]+\]\]/g,
  /\bNO_REPLY\b/g,
  /\bHEARTBEAT_OK\b/g,
];

export interface ParsedContent {
  text: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  type: string;
  name: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Message {
  role: string;
  content: string | ContentPart[];
}

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  [key: string]: unknown;
}

export function stripSystemNoise(raw: string): string {
  let text = raw;
  for (const pattern of SYSTEM_NOISE_PATTERNS) {
    text = text.replace(pattern, '');
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function extractUserText(raw: string, maxLen = 100): string {
  const text = stripSystemNoise(raw);

  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length > 3 && !l.startsWith('{') && !l.startsWith('"') && !l.startsWith('Read HEARTBEAT'))[0]
    ?.slice(0, maxLen) ?? '';
}

/**
 * Extract the first meaningful summary line from assistant text.
 * Skips headings, code fences, tables, and list items.
 */
export function extractAssistantSummary(fullText: string, maxLen = 80, minLen = 8): string {
  return stripSystemNoise(fullText)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('|') && !l.startsWith('-') && l.length > minLen)[0]
    ?.slice(0, maxLen) ?? '';
}

/**
 * Parse text content and tool calls from a message object.
 * Handles both string and structured content arrays.
 */
function shortPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.replace(/^.*\.openclaw\/workspace\//, '').replace(/^.*\//, (m) => (m.length > 40 ? '…/' : m));
}

function shortText(value: unknown, maxLen = 72): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLen) : null;
}

function shortValue(value: unknown, maxLen = 72): string | null {
  const path = shortPath(value);
  if (path) return path;

  if (typeof value === 'string') return shortText(value, maxLen);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => shortValue(item, 24)).filter(Boolean).slice(0, 3) as string[];
    return items.length ? items.join(', ') : `${value.length} items`;
  }
  if (value && typeof value === 'object') return '{…}';
  return null;
}

function summarizeToolArgs(args: Record<string, unknown>): string | null {
  const priorityKeys = [
    'file_path',
    'path',
    'command',
    'query',
    'url',
    'sessionKey',
    'sessionId',
    'action',
    'message',
    'offset',
    'limit',
    'model',
  ];

  const seen = new Set<string>();
  const parts: string[] = [];

  const pushPart = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const value = shortValue(args[key], key === 'command' ? 96 : 72);
    if (!value) return;

    if (key === 'file_path' || key === 'path' || key === 'command' || key === 'query' || key === 'url') {
      parts.push(value);
    } else {
      parts.push(`${key}=${value}`);
    }
  };

  for (const key of priorityKeys) {
    if (key in args) pushPart(key);
  }

  for (const key of Object.keys(args)) {
    if (parts.length >= 3) break;
    pushPart(key);
  }

  return parts.length ? parts.join(' · ') : null;
}

export function summarizeToolCall(tool: ToolCall): string {
  const args = (tool.arguments ?? {}) as Record<string, unknown>;
  const summary = summarizeToolArgs(args);
  return summary ? `${tool.name} · ${summary}` : tool.name;
}

export function parseMessageContent(msg: Message): ParsedContent {
  if (msg.role === 'user') {
    let text: string;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    } else {
      text = '';
    }
    return { text, toolCalls: [] };
  }

  if (msg.role === 'assistant') {
    if (typeof msg.content === 'string') {
      return { text: msg.content, toolCalls: [] };
    }

    const content = Array.isArray(msg.content) ? msg.content : [];
    const toolCalls = content.filter((c) => c.type === 'toolCall') as ToolCall[];
    const text = content.filter((c) => c.type === 'text').map((p) => p.text ?? '').join('');
    return { text, toolCalls };
  }

  return { text: '', toolCalls: [] };
}

/**
 * Read lines from a file region efficiently.
 */
export function readFileRegionLines(filePath: string, offset: number, maxBytes: number): string[] {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(stat.size - offset, maxBytes);
  if (readSize <= 0) return [];

  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, offset);
    return buf.toString('utf8').split('\n').filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse JSONL lines, yielding parsed entries. Silently skips malformed lines.
 */
export function parseJsonLines(lines: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
      // Skip malformed lines.
    }
  }
  return results;
}
