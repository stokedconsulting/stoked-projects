import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

export interface LogContext {
  session_id?: string;
  project_id?: string;
  machine_id?: string;
  request_id?: string;
  task_id?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  service?: string;
}

/**
 * Enhanced logging service with structured JSON output.
 *
 * Features:
 * - Structured JSON format in production
 * - Pretty-print format in development
 * - Contextual logging with session_id, project_id, machine_id, request_id
 * - Log levels: ERROR, WARN, INFO, DEBUG
 * - Environment-based configuration
 *
 * Usage:
 * ```typescript
 * constructor(private readonly logger: AppLoggerService) {}
 *
 * this.logger.logSessionCreated(sessionId, projectId, { machine_id: machineId });
 * this.logger.logHeartbeat(sessionId, { project_id: projectId });
 * this.logger.logError('Database connection failed', error, { session_id: sessionId });
 * ```
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements LoggerService {
  private context?: string;
  private readonly isDevelopment: boolean;
  private readonly isProduction: boolean;
  private readonly logLevel: LogLevel;

  constructor(private readonly configService: ConfigService) {
    const env = this.configService.get<string>('app.environment', 'development');
    this.isDevelopment = env === 'development';
    this.isProduction = env === 'production';

    // Set log level based on environment
    this.logLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
  }

  /**
   * Set context for all subsequent log entries
   */
  setContext(context: string) {
    this.context = context;
  }

  /**
   * Log a message with INFO level
   */
  log(message: string, context?: LogContext) {
    this.logMessage(LogLevel.INFO, message, context);
  }

  /**
   * Log a message with ERROR level
   */
  error(message: string, trace?: string, context?: LogContext) {
    this.logMessage(LogLevel.ERROR, message, context, { message, stack: trace });
  }

  /**
   * Log a message with WARN level
   */
  warn(message: string, context?: LogContext) {
    this.logMessage(LogLevel.WARN, message, context);
  }

  /**
   * Log a message with DEBUG level
   */
  debug(message: string, context?: LogContext) {
    if (this.isDevelopment) {
      this.logMessage(LogLevel.DEBUG, message, context);
    }
  }

  /**
   * Log a message with WARN level (alias for warn)
   */
  verbose(message: string, context?: LogContext) {
    this.warn(message, context);
  }

  /**
   * Log session creation event
   */
  logSessionCreated(sessionId: string, projectId: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Session created', {
      session_id: sessionId,
      project_id: projectId,
      event: 'session.created',
      ...additionalContext,
    });
  }

  /**
   * Log session update event
   */
  logSessionUpdated(sessionId: string, updates: Record<string, any>, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Session updated', {
      session_id: sessionId,
      event: 'session.updated',
      updates,
      ...additionalContext,
    });
  }

  /**
   * Log session completion event
   */
  logSessionCompleted(sessionId: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Session completed', {
      session_id: sessionId,
      event: 'session.completed',
      ...additionalContext,
    });
  }

  /**
   * Log session failure event
   */
  logSessionFailed(sessionId: string, reason: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.ERROR, 'Session failed', {
      session_id: sessionId,
      event: 'session.failed',
      failure_reason: reason,
      ...additionalContext,
    });
  }

  /**
   * Log heartbeat event
   */
  logHeartbeat(sessionId: string, additionalContext?: LogContext) {
    // Sample heartbeat logs in production (log 1 in 10)
    if (this.isProduction && Math.random() > 0.1) {
      return;
    }

    this.logMessage(LogLevel.INFO, 'Heartbeat received', {
      session_id: sessionId,
      event: 'heartbeat.received',
      ...additionalContext,
    });
  }

  /**
   * Log heartbeat failure event
   */
  logHeartbeatFailure(sessionId: string, reason: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.WARN, 'Heartbeat failed', {
      session_id: sessionId,
      event: 'heartbeat.failed',
      failure_reason: reason,
      ...additionalContext,
    });
  }

  /**
   * Log session recovery event
   */
  logRecovery(sessionId: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Session recovery initiated', {
      session_id: sessionId,
      event: 'session.recovery',
      ...additionalContext,
    });
  }

  /**
   * Log session recovery success
   */
  logRecoverySuccess(sessionId: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Session recovery successful', {
      session_id: sessionId,
      event: 'session.recovery.success',
      ...additionalContext,
    });
  }

  /**
   * Log session recovery failure
   */
  logRecoveryFailure(sessionId: string, reason: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.ERROR, 'Session recovery failed', {
      session_id: sessionId,
      event: 'session.recovery.failed',
      failure_reason: reason,
      ...additionalContext,
    });
  }

  /**
   * Log stalled session detection
   */
  logStalledSession(sessionId: string, minutesSinceHeartbeat: number, additionalContext?: LogContext) {
    this.logMessage(LogLevel.WARN, 'Session stalled', {
      session_id: sessionId,
      event: 'session.stalled',
      minutes_since_heartbeat: minutesSinceHeartbeat,
      ...additionalContext,
    });
  }

  /**
   * Log task state transition
   */
  logTaskStateChange(taskId: string, fromState: string, toState: string, additionalContext?: LogContext) {
    this.logMessage(LogLevel.INFO, 'Task state changed', {
      task_id: taskId,
      event: 'task.state_change',
      from_state: fromState,
      to_state: toState,
      ...additionalContext,
    });
  }

  /**
   * Log background job execution
   */
  logBackgroundJob(jobName: string, status: 'started' | 'completed' | 'failed', additionalContext?: LogContext) {
    const level = status === 'failed' ? LogLevel.ERROR : LogLevel.INFO;
    this.logMessage(level, `Background job ${status}`, {
      job_name: jobName,
      event: `background_job.${status}`,
      ...additionalContext,
    });
  }

  /**
   * Log database operation error
   */
  logDatabaseError(operation: string, error: Error, additionalContext?: LogContext) {
    this.logMessage(LogLevel.ERROR, `Database ${operation} failed`, additionalContext, {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    });
  }

  /**
   * Log validation error
   */
  logValidationError(entity: string, errors: any[], additionalContext?: LogContext) {
    this.logMessage(LogLevel.WARN, 'Validation error', {
      entity,
      event: 'validation.error',
      validation_errors: errors,
      ...additionalContext,
    });
  }

  /**
   * Core logging method that formats and outputs log entries
   */
  private logMessage(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: { message: string; stack?: string; code?: string },
  ) {
    // Check if this log level should be output
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.context,
    };

    if (context) {
      entry.context = context;
    }

    if (error) {
      entry.error = error;
    }

    // Format output based on environment
    if (this.isDevelopment) {
      this.prettyPrint(entry);
    } else {
      // Production: JSON format for structured logging
      console.log(JSON.stringify(entry));
    }
  }

  /**
   * Check if the log level should be output based on current log level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Pretty-print log entry for development
   */
  private prettyPrint(entry: LogEntry) {
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[90m', // Gray
    };
    const reset = '\x1b[0m';

    const color = colors[entry.level] || reset;
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const service = entry.service ? `[${entry.service}] ` : '';

    console.log(
      `${color}${entry.level}${reset} ${timestamp} ${service}${entry.message}`,
    );

    if (entry.context && Object.keys(entry.context).length > 0) {
      console.log('  Context:', entry.context);
    }

    if (entry.error) {
      console.log('  Error:', entry.error.message);
      if (entry.error.stack) {
        console.log(entry.error.stack);
      }
    }
  }
}
