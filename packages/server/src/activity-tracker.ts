import fs from 'fs';
import path from 'path';
import { watch } from 'chokidar';
import { config } from './config.js';
import {
  extractAssistantSummary,
  extractUserText,
  isDashboardSummaryPrompt,
  isDashboardSummaryResult,
  parseJsonLines,
  parseMessageContent,
  readFileRegionLines,
  summarizeToolCall,
} from './session-parser.js';
import { TaskSummarizer } from './task-summarizer.js';

const MAX_RECENT_ACTIVITY = 100;
const HISTORY_LOOKBACK_MS = 24 * 3600 * 1000;
const TASK_LOOKBACK_MS = 48 * 3600 * 1000;
const HISTORY_READ_BYTES = 128 * 1024;
const TAIL_READ_BYTES = 64 * 1024;

export interface ActivityItem {
  type: 'tool_call' | 'message' | 'user_message';
  ts: string;
  session: string;
  icon: string;
  text?: string;
  tool?: string;
}

export interface ActivityStats {
  messages: number;
  toolCalls: number;
  errors: number;
  lastActivityAt: string | null;
}

export interface TaskItem {
  key: string;
  title: string;
  task: string;
  startedAt: string;
  lastActivityAt: string;
  toolCount: number;
  result: string | null;
  sessionFile: string;
}

export interface ActivitySnapshot {
  recent: ActivityItem[];
  stats: ActivityStats;
  hourlyActivity: number[];
  tasks: TaskItem[];
}

interface FileState {
  offset: number;
}

interface SessionFileInfo {
  filePath: string;
  mtime: number;
}

function getSessionDisplayId(filePath: string): string {
  return path.basename(filePath).replace(/\.jsonl(?:\.(?:reset|deleted)\..+)?$/, '').slice(0, 8);
}

export class ActivityTracker {
  private _fileOffsets = new Map<string, FileState>();
  private _recentActivity: ActivityItem[] = [];
  private _stats: ActivityStats = { messages: 0, toolCalls: 0, errors: 0, lastActivityAt: null };
  private _hourlyActivity = new Array<number>(24).fill(0);
  private _taskSummarizer = new TaskSummarizer();

  start(): void {
    this._loadHistory();

    try {
      const watcher = watch('*.jsonl', {
        cwd: config.sessionsDir,
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      watcher.on('add', (relativePath) => {
        const filePath = path.join(config.sessionsDir, relativePath);
        this._initFile(filePath);
      });

      watcher.on('change', (relativePath) => {
        const filePath = path.join(config.sessionsDir, relativePath);
        this._readNewEntries(filePath);
      });
    } catch (err) {
      console.error('[activity] Failed to start file watcher:', (err as Error).message);
    }
  }

  async getSnapshot(): Promise<ActivitySnapshot> {
    this._syncRecentFiles();

    return {
      recent: this._recentActivity.slice(0, 30),
      stats: { ...this._stats },
      hourlyActivity: [...this._hourlyActivity],
      tasks: await this._extractTasks(),
    };
  }

  private _loadHistory(): void {
    try {
      const recentFiles = this._listSessionFiles(HISTORY_LOOKBACK_MS);
      for (const { filePath } of recentFiles.slice(0, 5)) {
        this._loadRecentFromFile(filePath);
      }

      this._recentActivity.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      this._recentActivity = this._recentActivity.slice(0, MAX_RECENT_ACTIVITY);
      console.log(`[activity] Loaded ${this._recentActivity.length} historical events`);
    } catch (err) {
      console.error('[activity] History load error:', (err as Error).message);
    }
  }

  private _loadRecentFromFile(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const offset = Math.max(0, stat.size - HISTORY_READ_BYTES);
      const lines = readFileRegionLines(filePath, offset, HISTORY_READ_BYTES);
      const entries = parseJsonLines(lines.slice(-50));

      for (const entry of entries) {
        this._processEntry(entry, filePath);
      }

      this._fileOffsets.set(filePath, { offset: stat.size });
    } catch {
      // ignore unreadable history files
    }
  }

  private _initFile(filePath: string): void {
    if (this._fileOffsets.has(filePath)) return;
    try {
      const stat = fs.statSync(filePath);
      this._fileOffsets.set(filePath, { offset: stat.size });
    } catch {
      // ignore inaccessible files
    }
  }

  private _readNewEntries(filePath: string): void {
    let state = this._fileOffsets.get(filePath);
    if (!state) {
      this._loadRecentFromFile(filePath);
      state = this._fileOffsets.get(filePath);
      if (!state) return;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= state.offset) {
        state.offset = stat.size;
        return;
      }

      const lines = readFileRegionLines(filePath, state.offset, TAIL_READ_BYTES);
      state.offset = stat.size;

      for (const entry of parseJsonLines(lines)) {
        this._processEntry(entry, filePath);
      }
    } catch {
      // ignore truncated/removed files
    }
  }

  private _processEntry(entry: Record<string, unknown>, filePath: string): void {
    if (entry.type !== 'message' || !entry.message) return;

    const msg = entry.message as { role: string; content: unknown };
    const ts = (entry.timestamp as string) || new Date().toISOString();
    const sessionId = getSessionDisplayId(filePath);

    this._recordTimestamp(ts);

    if (msg.role === 'assistant') {
      this._processAssistantMessage(msg, ts, sessionId);
    } else if (msg.role === 'user') {
      this._processUserMessage(msg, ts, sessionId);
    }
  }

  private _processAssistantMessage(msg: Record<string, unknown>, ts: string, sessionId: string): void {
    const { text, toolCalls } = parseMessageContent(msg as { role: string; content: string });
    if (isDashboardSummaryPrompt(text) || isDashboardSummaryResult(text)) return;

    for (const tc of toolCalls) {
      this._stats.toolCalls++;
      this._addActivity({
        type: 'tool_call',
        tool: tc.name,
        text: summarizeToolCall(tc),
        ts,
        session: sessionId,
        icon: '🔧',
      });
    }

    if (text) {
      this._stats.messages++;
      const summary = extractAssistantSummary(text, 100, 5);
      this._addActivity({
        type: 'message',
        text: summary || text.slice(0, 80),
        ts,
        session: sessionId,
        icon: toolCalls.length > 0 ? '🤖' : '💬',
      });
    }
  }

  private _processUserMessage(msg: Record<string, unknown>, ts: string, sessionId: string): void {
    const { text: rawText } = parseMessageContent(msg as { role: string; content: string });
    if (isDashboardSummaryPrompt(rawText)) return;

    const text = extractUserText(rawText);
    if (!text || text.startsWith('Read HEARTBEAT')) return;

    this._stats.messages++;
    this._addActivity({ type: 'user_message', text, ts, session: sessionId, icon: '👤' });
  }

  private _recordTimestamp(ts: string): void {
    const hour = new Date(ts).getHours();
    this._hourlyActivity[hour] = (this._hourlyActivity[hour] || 0) + 1;
    this._stats.lastActivityAt = ts;
  }

  private _addActivity(activity: ActivityItem): void {
    this._recentActivity.unshift(activity);
    if (this._recentActivity.length > MAX_RECENT_ACTIVITY) {
      this._recentActivity.pop();
    }
  }

  private _syncRecentFiles(): void {
    try {
      const recentFiles = this._listSessionFiles(HISTORY_LOOKBACK_MS);
      for (const { filePath } of recentFiles.slice(0, 8)) {
        this._readNewEntries(filePath);
      }
    } catch {
      // ignore sync failures
    }
  }

  private async _extractTasks(): Promise<TaskItem[]> {
    try {
      const recentFiles = this._listSessionFiles(TASK_LOOKBACK_MS, { includeResetArchives: true });
      const tasks: TaskItem[] = [];

      for (const { filePath } of recentFiles.slice(0, 8)) {
        const task = this._extractTaskFromFile(filePath);
        if (task) tasks.push(task);
      }

      await this._taskSummarizer.ensureSummaries(tasks.map((task) => ({ key: task.key, task: task.task })));

      for (const task of tasks) {
        task.title = this._taskSummarizer.getTitle(task.key) ?? '正在整理任务摘要';
      }

      tasks.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
      return tasks.slice(0, 15);
    } catch {
      return [];
    }
  }

  private _extractTaskFromFile(filePath: string): TaskItem | null {
    try {
      const stat = fs.statSync(filePath);
      const headLines = readFileRegionLines(filePath, 0, HISTORY_READ_BYTES);
      const tailOffset = Math.max(0, stat.size - TAIL_READ_BYTES);
      const tailLines = tailOffset > 0 ? readFileRegionLines(filePath, tailOffset, TAIL_READ_BYTES) : [];

      const initialUserTexts: string[] = [];
      let firstUserTs: string | null = null;
      let lastTs: string | null = null;
      let totalToolCalls = 0;
      let lastAssistantSummary = '';
      let sawAssistantAfterUser = false;

      for (const entry of parseJsonLines(headLines)) {
        if (entry.type !== 'message') continue;
        const msg = entry.message as Record<string, unknown>;
        const ts = entry.timestamp as string;
        lastTs = ts;

        if ((msg as { role: string }).role === 'user' && !sawAssistantAfterUser) {
          const { text: rawText } = parseMessageContent(msg as { role: string; content: string });
          if (isDashboardSummaryPrompt(rawText)) continue;

          const text = extractUserText(rawText, 160);
          if (text && !text.startsWith('A new session was started')) {
            if (!firstUserTs) firstUserTs = ts;
            if (initialUserTexts.length < 3) initialUserTexts.push(text);
          }
        }

        if ((msg as { role: string }).role === 'assistant') {
          if (initialUserTexts.length > 0) sawAssistantAfterUser = true;
          const { text, toolCalls } = parseMessageContent(msg as { role: string; content: string });
          if (isDashboardSummaryPrompt(text) || isDashboardSummaryResult(text)) continue;

          totalToolCalls += toolCalls.length;
          const summary = extractAssistantSummary(text);
          if (summary) lastAssistantSummary = summary;
        }
      }

      for (const entry of parseJsonLines(tailLines)) {
        if (entry.type !== 'message') continue;
        if (entry.timestamp) lastTs = entry.timestamp as string;

        const msg = entry.message as { role: string; content: string };
        if (msg.role === 'assistant') {
          const { text, toolCalls } = parseMessageContent(msg);
          if (isDashboardSummaryPrompt(text) || isDashboardSummaryResult(text)) continue;
          totalToolCalls += toolCalls.length;
          const summary = extractAssistantSummary(text);
          if (summary) lastAssistantSummary = summary;
        }
      }

      if (initialUserTexts.length === 0 || !firstUserTs) return null;

      const taskText = initialUserTexts.join(' ').slice(0, 220);
      const result = lastAssistantSummary || null;
      const sessionFile = getSessionDisplayId(filePath);

      return {
        key: sessionFile,
        title: '正在整理任务摘要',
        task: taskText,
        startedAt: firstUserTs,
        lastActivityAt: lastTs || firstUserTs,
        toolCount: totalToolCalls,
        result,
        sessionFile,
      };
    } catch {
      return null;
    }
  }

  private _listSessionFiles(lookbackMs: number, options?: { includeResetArchives?: boolean }): SessionFileInfo[] {
    const includeResetArchives = options?.includeResetArchives ?? false;
    const files = fs.readdirSync(config.sessionsDir).filter((f) => {
      if (f.endsWith('.jsonl')) return true;
      if (includeResetArchives && /\.jsonl\.reset\./.test(f)) return true;
      return false;
    });
    const cutoff = Date.now() - lookbackMs;

    return files
      .map((f): SessionFileInfo | null => {
        const filePath = path.join(config.sessionsDir, f);
        try {
          return { filePath, mtime: fs.statSync(filePath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SessionFileInfo => entry !== null && entry.mtime > cutoff)
      .sort((a, b) => b.mtime - a.mtime);
  }
}
