import fs from 'fs';
import path from 'path';
import { watch } from 'chokidar';
import { config } from './config.js';
import {
  extractAssistantSummary,
  extractUserText,
  parseJsonLines,
  parseMessageContent,
  readFileRegionLines,
  summarizeToolCall,
} from './session-parser.js';
import { SUMMARY_SESSION_KEY, TaskSummarizer } from './task-summarizer.js';

const MAX_RECENT_ACTIVITY = 100;
const HISTORY_LOOKBACK_MS = 24 * 3600 * 1000;
const TASK_LOOKBACK_MS = 48 * 3600 * 1000;
const HISTORY_READ_BYTES = 2 * 1024 * 1024;
const TASK_HEAD_READ_BYTES = 512 * 1024;
const TAIL_READ_BYTES = 64 * 1024;
const TASK_ACTIVE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface ActivityItem {
  type: 'tool_call' | 'message' | 'user_message';
  ts: string;
  session: string;
  icon: string;
  seq: number;
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
  isActive: boolean;
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

interface SessionIndexEntry {
  sessionId: string;
  sessionFile?: string;
  [key: string]: unknown;
}

type SessionIndex = Record<string, SessionIndexEntry>;

function getSessionBaseId(filePath: string): string {
  return path.basename(filePath).replace(/\.jsonl(?:\.(?:reset|deleted)\..+)?$/, '');
}

function getSessionDisplayId(filePath: string): string {
  return getSessionBaseId(filePath).slice(0, 8);
}

export class ActivityTracker {
  private _fileOffsets = new Map<string, FileState>();
  private _recentActivity: ActivityItem[] = [];
  private _stats: ActivityStats = { messages: 0, toolCalls: 0, errors: 0, lastActivityAt: null };
  private _hourlyActivity = new Array<number>(24).fill(0);
  private _taskSummarizer = new TaskSummarizer();
  private _activitySeq = 0;
  private _sessionIndex: SessionIndex = {};
  private _summarizerSessionIds = new Set<string>();

  start(): void {
    this._refreshSessionIndex();
    this._loadHistory();

    try {
      const watcher = watch(['*.jsonl', 'sessions.json'], {
        cwd: config.sessionsDir,
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      watcher.on('add', (relativePath) => {
        if (relativePath === 'sessions.json') return;
        const filePath = path.join(config.sessionsDir, relativePath);
        if (this._isSummarizerFile(filePath)) return;
        this._initFile(filePath);
      });

      watcher.on('change', (relativePath) => {
        if (relativePath === 'sessions.json') {
          this._refreshSessionIndex();
          return;
        }
        const filePath = path.join(config.sessionsDir, relativePath);
        if (this._isSummarizerFile(filePath)) return;
        this._readNewEntries(filePath);
      });
    } catch (err) {
      console.error('[activity] Failed to start file watcher:', (err as Error).message);
    }
  }

  async getSnapshot(): Promise<ActivitySnapshot> {
    this._syncRecentFiles();

    const recent = [...this._recentActivity]
      .sort((a, b) => this._compareActivityDesc(a, b))
      .slice(0, 30);

    return {
      recent,
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

      this._recentActivity.sort((a, b) => this._compareActivityDesc(a, b));
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

  private _addActivity(activity: Omit<ActivityItem, 'seq'>): void {
    const withSeq: ActivityItem = { ...activity, seq: ++this._activitySeq };
    this._recentActivity.unshift(withSeq);
    if (this._recentActivity.length > MAX_RECENT_ACTIVITY) {
      this._recentActivity.pop();
    }
  }

  private _compareActivityDesc(a: ActivityItem, b: ActivityItem): number {
    const tsDelta = new Date(b.ts).getTime() - new Date(a.ts).getTime();
    return tsDelta || b.seq - a.seq;
  }

  private _isTaskActive(lastActivityAt: string, isSessionFileActive: boolean): boolean {
    if (!isSessionFileActive) return false;
    const lastActivityMs = new Date(lastActivityAt).getTime();
    if (!Number.isFinite(lastActivityMs)) return false;
    return Date.now() - lastActivityMs <= TASK_ACTIVE_IDLE_TIMEOUT_MS;
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
      const maxScannedFiles = 96;
      const maxCollectedTasks = 24;
      const seenSessions = new Set<string>();

      for (const { filePath } of recentFiles) {
        const sessionId = getSessionBaseId(filePath);
        if (seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);
        if (seenSessions.size > maxScannedFiles) break;

        const task = this._extractTaskFromFile(filePath);
        if (!task) continue;
        tasks.push(task);
        if (tasks.length >= maxCollectedTasks) break;
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
      const isSessionFileActive = filePath.endsWith('.jsonl');
      const headLines = readFileRegionLines(filePath, 0, TASK_HEAD_READ_BYTES);
      const tailOffset = Math.max(0, stat.size - TAIL_READ_BYTES);
      const tailLines = tailOffset > 0 ? readFileRegionLines(filePath, tailOffset, TAIL_READ_BYTES) : [];

      const initialUserTexts: string[] = [];
      let firstUserTs: string | null = null;
      let lastTs: string | null = null;
      let totalToolCalls = 0;
      let lastAssistantSummary = '';
      let collectingTaskWindow = false;
      let sawAssistantAfterTaskStart = false;

      for (const entry of parseJsonLines(headLines)) {
        if (entry.type !== 'message') continue;
        const msg = entry.message as Record<string, unknown>;
        const ts = entry.timestamp as string;
        lastTs = ts;

        if ((msg as { role: string }).role === 'user') {
          const { text: rawText } = parseMessageContent(msg as { role: string; content: string });

          const text = extractUserText(rawText, 160);
          if (!text || text.startsWith('A new session was started')) continue;

          if (!collectingTaskWindow) {
            collectingTaskWindow = true;
            firstUserTs = ts;
          }

          if (!sawAssistantAfterTaskStart && initialUserTexts.length < 3) {
            initialUserTexts.push(text);
          }
        }

        if ((msg as { role: string }).role === 'assistant') {
          const { text, toolCalls } = parseMessageContent(msg as { role: string; content: string });

          totalToolCalls += toolCalls.length;
          const summary = extractAssistantSummary(text);
          if (summary) lastAssistantSummary = summary;

          if (collectingTaskWindow && initialUserTexts.length > 0) {
            sawAssistantAfterTaskStart = true;
          }
        }
      }

      for (const entry of parseJsonLines(tailLines)) {
        if (entry.type !== 'message') continue;
        if (entry.timestamp) lastTs = entry.timestamp as string;

        const msg = entry.message as { role: string; content: string };
        if (msg.role === 'assistant') {
          const { text, toolCalls } = parseMessageContent(msg);
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
        isActive: this._isTaskActive(lastTs || firstUserTs, isSessionFileActive),
        toolCount: totalToolCalls,
        result,
        sessionFile,
      };
    } catch {
      return null;
    }
  }

  private _refreshSessionIndex(): void {
    try {
      const indexPath = path.join(config.sessionsDir, 'sessions.json');
      const raw = fs.readFileSync(indexPath, 'utf-8');
      this._sessionIndex = JSON.parse(raw) as SessionIndex;
    } catch {
      this._sessionIndex = {};
    }

    this._summarizerSessionIds.clear();
    for (const [key, entry] of Object.entries(this._sessionIndex)) {
      if (key === SUMMARY_SESSION_KEY && entry.sessionId) {
        this._summarizerSessionIds.add(entry.sessionId);
      }
    }
  }

  private _isSummarizerFile(filePath: string): boolean {
    return this._summarizerSessionIds.has(getSessionBaseId(filePath));
  }

  private _listSessionFiles(lookbackMs: number, options?: { includeResetArchives?: boolean }): SessionFileInfo[] {
    const includeResetArchives = options?.includeResetArchives ?? false;
    const cutoff = Date.now() - lookbackMs;
    const results: SessionFileInfo[] = [];

    for (const [key, entry] of Object.entries(this._sessionIndex)) {
      if (key === SUMMARY_SESSION_KEY) continue;
      if (!entry.sessionId) continue;

      const filePath = entry.sessionFile || path.join(config.sessionsDir, `${entry.sessionId}.jsonl`);
      try {
        const mtime = fs.statSync(filePath).mtimeMs;
        if (mtime > cutoff) {
          results.push({ filePath, mtime });
        }
      } catch {
        // File may not exist yet
      }
    }

    if (includeResetArchives) {
      try {
        for (const f of fs.readdirSync(config.sessionsDir)) {
          if (!/\.jsonl\.(?:reset|deleted)\./.test(f)) continue;
          const filePath = path.join(config.sessionsDir, f);
          if (this._isSummarizerFile(filePath)) continue;

          try {
            const mtime = fs.statSync(filePath).mtimeMs;
            if (mtime > cutoff) {
              results.push({ filePath, mtime });
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Directory scan failure
      }
    }

    return results.sort((a, b) => b.mtime - a.mtime);
  }
}
