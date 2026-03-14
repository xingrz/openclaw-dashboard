import fs from 'fs';

/**
 * Noise patterns to strip from user message text.
 * These are system-injected metadata lines that aren't meaningful for display.
 */
const SYSTEM_NOISE_PATTERNS: RegExp[] = [
  /^System:.*$/gm,
  /^Conversation info.*$/gm,
  /^Sender.*$/gm,
  /```json[\s\S]*?```/g,
  /\[media attached:.*?\]/g,
  /\[image data.*?\]/g,
];

export interface ParsedContent {
  text: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  type: string;
  name: string;
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

/**
 * Clean system noise from user message text and return the first meaningful line.
 */
export function extractUserText(raw: string, maxLen = 100): string {
  let text = raw;
  for (const pattern of SYSTEM_NOISE_PATTERNS) {
    text = text.replace(pattern, '');
  }

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
  return fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('|') && !l.startsWith('-') && l.length > minLen)[0]
    ?.slice(0, maxLen) ?? '';
}

/**
 * Parse text content and tool calls from a message object.
 * Handles both string and structured content arrays.
 */
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
