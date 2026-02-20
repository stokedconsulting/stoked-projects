/**
 * Structured logger for the agent package.
 *
 * ZERO vscode imports — pure Node.js using process.stdout/stderr and fs.
 *
 * Log format:
 *   [2026-02-19T12:00:00.000Z] [LEVEL] [Agent:1] message here
 *
 * - INFO  → stdout
 * - WARN  → stderr
 * - ERROR → stderr
 * - DEBUG → stdout (only when the DEBUG env-var is set)
 *
 * Optional file logging: call {@link Logger.setLogFile} to additionally
 * append every log line to a file.
 */

import { appendFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class Logger {
  private readonly agentId: number | undefined;
  private logFilePath: string | undefined;

  /**
   * @param agentId  Optional agent identifier.  When provided, each log line
   *                 includes a `[Agent:{agentId}]` prefix.
   */
  constructor(agentId?: number) {
    this.agentId = agentId;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Log an informational message to stdout.
   */
  info(message: string, ...args: unknown[]): void {
    this.write('INFO', process.stdout, message, args);
  }

  /**
   * Log a warning message to stderr.
   */
  warn(message: string, ...args: unknown[]): void {
    this.write('WARN', process.stderr, message, args);
  }

  /**
   * Log an error message to stderr.
   */
  error(message: string, ...args: unknown[]): void {
    this.write('ERROR', process.stderr, message, args);
  }

  /**
   * Log a debug message to stdout.  Only emitted when the `DEBUG` environment
   * variable is set (any non-empty value enables debug logging).
   */
  debug(message: string, ...args: unknown[]): void {
    if (!process.env['DEBUG']) {
      return;
    }
    this.write('DEBUG', process.stdout, message, args);
  }

  /**
   * Redirect log output to a file in addition to stdout/stderr.
   * Each log line is appended synchronously so that no lines are lost even
   * if the process crashes.
   *
   * @param path  Absolute or relative path to the log file.
   *              The file is created if it does not exist.
   */
  setLogFile(path: string): void {
    this.logFilePath = path;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private formatLine(level: LogLevel, message: string, args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const agentPart = this.agentId !== undefined ? ` [Agent:${this.agentId}]` : '';
    const suffix = args.length > 0 ? ` ${args.map(formatArg).join(' ')}` : '';
    return `[${timestamp}] [${level}]${agentPart} ${message}${suffix}`;
  }

  private write(
    level: LogLevel,
    stream: NodeJS.WriteStream,
    message: string,
    args: unknown[],
  ): void {
    const line = this.formatLine(level, message, args);
    stream.write(line + '\n');

    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, line + '\n', 'utf8');
      } catch {
        // Swallow file write errors to avoid infinite error loops;
        // the message has already been written to the stream.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function formatArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}
