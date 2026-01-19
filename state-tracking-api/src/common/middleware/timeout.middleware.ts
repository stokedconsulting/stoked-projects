import { Injectable, NestMiddleware, RequestTimeoutException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to enforce request timeout
 * Default timeout: 30 seconds
 */
@Injectable()
export class TimeoutMiddleware implements NestMiddleware {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Set timeout on request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        // Throw timeout exception which will be caught by exception filter
        throw new RequestTimeoutException('Request timeout - operation took too long to complete');
      }
    }, this.timeoutMs);

    // Clear timeout when response finishes
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    // Clear timeout on error
    res.on('error', () => {
      clearTimeout(timeout);
    });

    next();
  }
}

/**
 * Factory function to create timeout middleware with custom timeout
 */
export function createTimeoutMiddleware(timeoutMs: number) {
  return new TimeoutMiddleware(timeoutMs);
}
