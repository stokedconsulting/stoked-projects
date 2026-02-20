/**
 * Budget tracking for the autonomous agent loop.
 *
 * ZERO vscode imports — pure Node.js with no external dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';

import { BudgetStatus } from './types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CostEntry {
  agentId: string;
  costUsd: number;
  projectNumber: number;
  timestamp: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// BudgetTracker class
// ---------------------------------------------------------------------------

/**
 * Tracks per-agent cost entries, enforces daily and monthly budget limits,
 * and persists data atomically to `{sessionDir}/cost-log.json`.
 *
 * Usage:
 * ```ts
 * const tracker = new BudgetTracker(5.00, 50.00, '/path/to/.claude-sessions');
 * tracker.loadFromFile();
 * tracker.onBudgetExceeded((status) => console.warn('Budget exceeded', status));
 * tracker.recordCost('agent-1', 0.25, 92);
 * tracker.persistToFile();
 * ```
 */
export class BudgetTracker {
  private readonly _dailyLimit: number;
  private readonly _monthlyLimit: number;
  private readonly _sessionDir: string;
  private _entries: CostEntry[] = [];
  private _callbacks: Array<(status: BudgetStatus) => void> = [];

  constructor(dailyBudgetUsd: number, monthlyBudgetUsd: number, sessionDir: string) {
    this._dailyLimit = dailyBudgetUsd;
    this._monthlyLimit = monthlyBudgetUsd;
    this._sessionDir = sessionDir;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Records a cost entry for the given agent and project, then checks whether
   * budget limits have been exceeded and fires registered callbacks if so.
   */
  recordCost(agentId: string, costUsd: number, projectNumber: number): void {
    const entry: CostEntry = {
      agentId,
      costUsd,
      projectNumber,
      timestamp: new Date().toISOString(),
    };
    this._entries.push(entry);

    if (!this.isWithinBudget()) {
      const status = this.getBudgetStatus();
      for (const cb of this._callbacks) {
        cb(status);
      }
    }
  }

  /**
   * Returns the total spend (in USD) for the current UTC calendar day.
   */
  getDailySpend(): number {
    const todayPrefix = this._utcDatePrefix(new Date());
    return this._entries
      .filter((e) => e.timestamp.startsWith(todayPrefix))
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Returns the total spend (in USD) for the current UTC calendar month.
   */
  getMonthlySpend(): number {
    const monthPrefix = this._utcMonthPrefix(new Date());
    return this._entries
      .filter((e) => e.timestamp.startsWith(monthPrefix))
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Returns `true` if both daily and monthly spend are strictly below their
   * respective limits.
   */
  isWithinBudget(): boolean {
    return this.getDailySpend() < this._dailyLimit &&
      this.getMonthlySpend() < this._monthlyLimit;
  }

  /**
   * Returns a full snapshot of current budget consumption.
   */
  getBudgetStatus(): BudgetStatus {
    const dailySpend = this.getDailySpend();
    const monthlySpend = this.getMonthlySpend();
    return {
      dailySpend,
      monthlySpend,
      dailyLimit: this._dailyLimit,
      monthlyLimit: this._monthlyLimit,
      dailyRemaining: Math.max(0, this._dailyLimit - dailySpend),
      monthlyRemaining: Math.max(0, this._monthlyLimit - monthlySpend),
      isWithinBudget: this.isWithinBudget(),
    };
  }

  /**
   * Registers a callback that is invoked whenever budget limits are exceeded
   * after a `recordCost` call.
   */
  onBudgetExceeded(callback: (status: BudgetStatus) => void): void {
    this._callbacks.push(callback);
  }

  /**
   * Atomically writes all cost entries to `{sessionDir}/cost-log.json`.
   * Uses a temporary file and rename to avoid partial writes.
   */
  persistToFile(): void {
    const logPath = path.join(this._sessionDir, 'cost-log.json');
    const tmpPath = path.join(this._sessionDir, '.cost-log.json.tmp');

    fs.mkdirSync(this._sessionDir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(this._entries, null, 2), 'utf8');
    fs.renameSync(tmpPath, logPath);
  }

  /**
   * Loads existing cost entries from `{sessionDir}/cost-log.json`.
   * If the file is missing, nothing happens. If the file contains invalid
   * JSON, a warning is logged and entries are reset to an empty array.
   */
  loadFromFile(): void {
    const logPath = path.join(this._sessionDir, 'cost-log.json');

    if (!fs.existsSync(logPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(logPath, 'utf8');
      this._entries = JSON.parse(raw) as CostEntry[];
    } catch (err) {
      console.warn(
        `[BudgetTracker] Failed to parse ${logPath} — starting with empty cost log.`,
        err,
      );
      this._entries = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the UTC date prefix `YYYY-MM-DD` for the given date, used to
   * filter entries belonging to the current day.
   */
  private _utcDatePrefix(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Returns the UTC month prefix `YYYY-MM` for the given date, used to
   * filter entries belonging to the current month.
   */
  private _utcMonthPrefix(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
}
