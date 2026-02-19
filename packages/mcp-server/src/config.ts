import { config as loadEnvFile } from 'dotenv';

/**
 * Server configuration interface
 *
 * Defines all configuration options for the MCP server including
 * API credentials, runtime settings, and logging configuration.
 */
export interface ServerConfig {
  /** Base URL for the state tracking API */
  apiBaseUrl: string;

  /** API key for authentication (required) */
  apiKey: string;

  /** Logging level for the server */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Request timeout in milliseconds */
  requestTimeout: number;

  /** Number of retry attempts for failed requests */
  retryAttempts: number;

}

/**
 * Default configuration values for optional settings
 */
const DEFAULT_CONFIG: Partial<ServerConfig> = {
  apiBaseUrl: 'http://localhost:8167',
  logLevel: 'info',
  requestTimeout: 10000,
  retryAttempts: 3,
};

/**
 * Valid log levels for validation
 */
const VALID_LOG_LEVELS: ReadonlyArray<ServerConfig['logLevel']> = ['debug', 'info', 'warn', 'error'];

/**
 * Global configuration instance
 */
let configInstance: ServerConfig | null = null;

/**
 * Load and validate configuration from environment variables and .env file
 *
 * Configuration sources (in order of precedence):
 * 1. Environment variables (highest priority)
 * 2. .env file
 * 3. Default values (lowest priority)
 *
 * @throws {Error} If required configuration is missing or invalid
 * @returns {ServerConfig} Validated configuration object
 */
export function loadConfig(): ServerConfig {
  // Load .env file (does not override existing environment variables)
  loadEnvFile();

  // Validate required API key
  const apiKey = process.env.STATE_TRACKING_API_KEY;
  if (!apiKey) {
    throw new Error('Required environment variable STATE_TRACKING_API_KEY not set');
  }

  // Load optional configuration with defaults
  const apiBaseUrl = process.env.STATE_TRACKING_API_URL || DEFAULT_CONFIG.apiBaseUrl!;
  const logLevel = (process.env.LOG_LEVEL || DEFAULT_CONFIG.logLevel!) as ServerConfig['logLevel'];
  const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS || String(DEFAULT_CONFIG.requestTimeout!), 10);
  const retryAttempts = parseInt(process.env.RETRY_ATTEMPTS || String(DEFAULT_CONFIG.retryAttempts!), 10);

  // Validate log level
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new Error(
      `Invalid log level '${logLevel}'. Valid options are: ${VALID_LOG_LEVELS.join(', ')}`
    );
  }

  // Validate numeric values
  if (isNaN(requestTimeout) || requestTimeout <= 0) {
    throw new Error(`Invalid REQUEST_TIMEOUT_MS: must be a positive number`);
  }

  if (isNaN(retryAttempts) || retryAttempts < 0) {
    throw new Error(`Invalid RETRY_ATTEMPTS: must be a non-negative number`);
  }

  // Create and store configuration
  configInstance = {
    apiKey,
    apiBaseUrl,
    logLevel,
    requestTimeout,
    retryAttempts,
  };

  return configInstance;
}

/**
 * Get the current configuration
 *
 * @throws {Error} If configuration has not been loaded
 * @returns {ServerConfig} Current configuration object
 */
export function getConfig(): ServerConfig {
  if (!configInstance) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return configInstance;
}

/**
 * Reset configuration (primarily for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Logger interface for structured logging
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Console-based logger with configurable log levels
 */
class ConsoleLogger implements Logger {
  private minLevel: ServerConfig['logLevel'];
  private levelPriority: Record<ServerConfig['logLevel'], number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: ServerConfig['logLevel']) {
    this.minLevel = minLevel;
  }

  private shouldLog(level: ServerConfig['logLevel']): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatMessage(level: string, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.error(this.formatMessage('debug', message, args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.error(this.formatMessage('info', message, args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.error(this.formatMessage('warn', message, args));
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, args));
    }
  }
}

/**
 * Global logger instance
 */
let loggerInstance: Logger | null = null;

/**
 * Create a logger with the configured log level
 *
 * @param config Server configuration
 * @returns {Logger} Logger instance
 */
export function createLogger(config: ServerConfig): Logger {
  loggerInstance = new ConsoleLogger(config.logLevel);
  return loggerInstance;
}

/**
 * Get the current logger instance
 *
 * @throws {Error} If logger has not been created
 * @returns {Logger} Current logger instance
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    throw new Error('Logger not initialized. Call createLogger() first.');
  }
  return loggerInstance;
}

/**
 * Reset logger (primarily for testing)
 */
export function resetLogger(): void {
  loggerInstance = null;
}
