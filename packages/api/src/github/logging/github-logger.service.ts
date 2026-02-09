import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile = require('winston-daily-rotate-file');
import { SensitiveDataFilter } from './sensitive-data.filter';

/**
 * GitHub Operation Types
 */
export enum GitHubOperation {
  // Query operations
  GET_REPOSITORY = 'github.repository.get',
  GET_ISSUE = 'github.issue.get',
  LIST_ISSUES = 'github.issues.list',
  GET_PROJECT = 'github.project.get',
  LIST_PROJECTS = 'github.projects.list',

  // Mutation operations
  CREATE_ISSUE = 'github.issue.create',
  UPDATE_ISSUE = 'github.issue.update',
  CLOSE_ISSUE = 'github.issue.close',
  CREATE_PROJECT = 'github.project.create',
  UPDATE_PROJECT = 'github.project.update',
  DELETE_PROJECT = 'github.project.delete',
  ADD_LABEL = 'github.label.add',
  REMOVE_LABEL = 'github.label.remove',
  CREATE_COMMENT = 'github.comment.create',
  UPDATE_COMMENT = 'github.comment.update',
  DELETE_COMMENT = 'github.comment.delete',
}

/**
 * Log entry interface
 */
export interface GitHubLogEntry {
  timestamp: string;
  level: string;
  requestId?: string;
  userId?: string;
  operation: string;
  duration?: number;
  status: 'success' | 'error' | 'pending';
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Audit log entry for mutations
 */
export interface AuditLogEntry extends GitHubLogEntry {
  userId: string; // Required for audit logs
  mutationType: 'create' | 'update' | 'delete';
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, any>;
}

/**
 * GitHub Logger Service
 *
 * Provides structured logging for all GitHub operations with:
 * - Winston-based structured JSON logging
 * - Sensitive data filtering
 * - Separate audit log stream for mutations
 * - Request tracing via requestId
 * - Automatic log rotation
 * - Graceful failure handling
 */
@Injectable()
export class GitHubLoggerService implements OnModuleInit {
  private logger: winston.Logger;
  private auditLogger: winston.Logger;
  private logVolume: number = 0;
  private volumeCheckInterval: NodeJS.Timeout;
  private readonly MAX_LOGS_PER_MINUTE = 1000;
  private readonly isDevelopment: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isDevelopment = this.configService.get<string>('app.environment', 'development') === 'development';
  }

  onModuleInit() {
    this.initializeLoggers();
    this.startVolumeMonitoring();
  }

  /**
   * Initialize Winston loggers
   */
  private initializeLoggers(): void {
    try {
      // Main logger configuration
      this.logger = winston.createLogger({
        level: this.isDevelopment ? 'debug' : 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
        defaultMeta: { service: 'github-operations' },
        transports: this.createMainTransports(),
        // Don't exit on errors
        exitOnError: false,
      });

      // Audit logger configuration (mutations only)
      this.auditLogger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        defaultMeta: { service: 'github-audit' },
        transports: this.createAuditTransports(),
        exitOnError: false,
      });

      // Fallback to stderr on logging failure
      this.logger.on('error', (error) => {
        process.stderr.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message: 'Logger error',
            error: error.message,
          }) + '\n'
        );
      });

      this.auditLogger.on('error', (error) => {
        process.stderr.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message: 'Audit logger error',
            error: error.message,
          }) + '\n'
        );
      });
    } catch (error: any) {
      // Fallback to stderr if logger initialization fails
      process.stderr.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          message: 'Failed to initialize loggers',
          error: error.message,
        }) + '\n'
      );
    }
  }

  /**
   * Create transports for main logger
   */
  private createMainTransports(): winston.transport[] {
    const transports: winston.transport[] = [];

    // Console transport for development
    if (this.isDevelopment) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        })
      );
    }

    // File transport with rotation
    transports.push(
      new DailyRotateFile({
        filename: 'logs/github-operations-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.json(),
      })
    );

    // Error-only file
    transports.push(
      new DailyRotateFile({
        filename: 'logs/github-errors-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        format: winston.format.json(),
      })
    );

    return transports;
  }

  /**
   * Create transports for audit logger
   */
  private createAuditTransports(): winston.transport[] {
    return [
      new DailyRotateFile({
        filename: 'logs/github-audit-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '50m',
        maxFiles: '90d', // Keep audit logs longer for compliance
        format: winston.format.json(),
      }),
    ];
  }

  /**
   * Start monitoring log volume
   */
  private startVolumeMonitoring(): void {
    this.volumeCheckInterval = setInterval(() => {
      if (this.logVolume > this.MAX_LOGS_PER_MINUTE) {
        this.logger.warn({
          message: 'High log volume detected',
          logsPerMinute: this.logVolume,
          threshold: this.MAX_LOGS_PER_MINUTE,
        });
      }
      this.logVolume = 0;
    }, 60000); // Check every minute
  }

  /**
   * Log a GitHub operation
   */
  log(
    operation: GitHubOperation | string,
    status: 'success' | 'error' | 'pending',
    options?: {
      requestId?: string;
      userId?: string;
      duration?: number;
      error?: Error;
      metadata?: Record<string, any>;
    }
  ): void {
    try {
      this.logVolume++;

      const entry: GitHubLogEntry = {
        timestamp: new Date().toISOString(),
        level: status === 'error' ? 'error' : 'info',
        requestId: options?.requestId,
        userId: options?.userId,
        operation,
        duration: options?.duration,
        status,
      };

      if (options?.error) {
        entry.error = {
          message: options.error.message,
          code: (options.error as any).code,
          stack: options.error.stack,
        };
      }

      if (options?.metadata) {
        // Filter sensitive data from metadata
        entry.metadata = SensitiveDataFilter.filter(options.metadata);
      }

      this.logger.log(entry.level, {
        message: entry.operation,
        ...entry,
      });

      // If this is a mutation, also log to audit
      if (this.isMutation(operation)) {
        this.logAudit(operation, options);
      }
    } catch (error: any) {
      // Fallback to stderr
      this.logToStderr({
        level: 'ERROR',
        message: 'Failed to log operation',
        operation,
        error: error.message,
      });
    }
  }

  /**
   * Log to audit stream (mutations only)
   */
  private logAudit(
    operation: string,
    options?: {
      requestId?: string;
      userId?: string;
      duration?: number;
      metadata?: Record<string, any>;
    }
  ): void {
    try {
      if (!options?.userId) {
        this.logger.warn({
          message: 'Mutation logged without userId',
          operation,
          requestId: options?.requestId,
        });
      }

      const auditEntry: Partial<AuditLogEntry> = {
        timestamp: new Date().toISOString(),
        level: 'info',
        requestId: options?.requestId,
        userId: options?.userId || 'unknown',
        operation,
        mutationType: this.getMutationType(operation),
        resourceType: this.getResourceType(operation),
      };

      if (options?.metadata) {
        auditEntry.metadata = SensitiveDataFilter.filter(options.metadata);
        auditEntry.resourceId = options.metadata.resourceId;
        auditEntry.changes = options.metadata.changes;
      }

      this.auditLogger.info(auditEntry);
    } catch (error: any) {
      this.logToStderr({
        level: 'ERROR',
        message: 'Failed to log audit entry',
        operation,
        error: error.message,
      });
    }
  }

  /**
   * Check if operation is a mutation
   */
  private isMutation(operation: string): boolean {
    const mutationOps = [
      'create', 'update', 'delete', 'close', 'add', 'remove'
    ];
    return mutationOps.some(op => operation.toLowerCase().includes(op));
  }

  /**
   * Get mutation type from operation
   */
  private getMutationType(operation: string): 'create' | 'update' | 'delete' {
    if (operation.includes('create')) return 'create';
    if (operation.includes('delete')) return 'delete';
    return 'update';
  }

  /**
   * Get resource type from operation
   */
  private getResourceType(operation: string): string {
    const parts = operation.split('.');
    return parts.length > 1 ? parts[1] : 'unknown';
  }

  /**
   * Fallback logging to stderr
   */
  private logToStderr(data: Record<string, any>): void {
    process.stderr.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ...data,
      }) + '\n'
    );
  }

  /**
   * Log operation start
   */
  startOperation(
    operation: GitHubOperation | string,
    requestId?: string,
    userId?: string,
    metadata?: Record<string, any>
  ): { endOperation: (status: 'success' | 'error', error?: Error) => void } {
    const startTime = Date.now();

    return {
      endOperation: (status: 'success' | 'error', error?: Error) => {
        const duration = Date.now() - startTime;
        this.log(operation, status, {
          requestId,
          userId,
          duration,
          error,
          metadata,
        });
      },
    };
  }

  /**
   * Clean up resources
   */
  onModuleDestroy(): void {
    if (this.volumeCheckInterval) {
      clearInterval(this.volumeCheckInterval);
    }

    // Close loggers gracefully
    this.logger.end();
    this.auditLogger.end();
  }
}
