/**
 * Cache Headers Interceptor
 *
 * Sets appropriate Cache-Control headers on API responses based on:
 * - HTTP method (GET, POST, PATCH, etc.)
 * - Endpoint route
 * - Response status code
 *
 * Ensures consistent cache behavior across the API.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response, Request } from 'express';

interface CacheEndpointConfig {
  pattern: RegExp;
  methods: string[];
  cacheControl: string;
  description: string;
}

@Injectable()
export class CacheHeadersInterceptor implements NestInterceptor {
  private readonly cacheConfigs: CacheEndpointConfig[] = [
    // Health endpoints - 30 seconds
    {
      pattern: /^\/health(\/(ready|live|detailed|system))?$/,
      methods: ['GET'],
      cacheControl: 'public, max-age=30',
      description: 'Health checks',
    },

    // Session GET - 1 minute
    {
      pattern: /^\/sessions(\/\w+)?$/,
      methods: ['GET'],
      cacheControl: 'public, max-age=60, must-revalidate',
      description: 'Session data (GET only)',
    },

    // Task GET - 5 minutes
    {
      pattern: /^\/tasks(\/\w+)?$/,
      methods: ['GET'],
      cacheControl: 'public, max-age=300, must-revalidate',
      description: 'Task data (GET only)',
    },

    // Machine GET - 5 minutes
    {
      pattern: /^\/machines(\/\w+)?$/,
      methods: ['GET'],
      cacheControl: 'public, max-age=300, must-revalidate',
      description: 'Machine data (GET only)',
    },

    // Default - no cache
    {
      pattern: /.*/,
      methods: [],
      cacheControl: 'no-store, private',
      description: 'Default (no cache)',
    },
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap((data) => {
        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();
        const method = request.method;
        const path = request.path;
        const statusCode = response.statusCode;

        // Find matching cache config
        const config = this.findCacheConfig(path, method);

        // Only cache successful GET responses
        if (method === 'GET' && statusCode >= 200 && statusCode < 300) {
          response.setHeader('Cache-Control', config.cacheControl);
          response.setHeader('Vary', 'Authorization, Accept-Encoding');

          // For responses that support validation
          if (config.cacheControl.includes('must-revalidate')) {
            this.setValidationHeaders(response, data);
          }
        } else {
          // Never cache non-GET or error responses
          response.setHeader('Cache-Control', 'no-store, private');
          response.setHeader('Pragma', 'no-cache');
          response.setHeader('Expires', '0');
        }

        // Add cache strategy header for debugging
        response.setHeader('X-Cache-Strategy', config.description);
      }),
    );
  }

  /**
   * Find cache configuration matching the path and method
   */
  private findCacheConfig(path: string, method: string): CacheEndpointConfig {
    // Find first matching config (order matters, more specific first)
    for (let i = 0; i < this.cacheConfigs.length - 1; i++) {
      const config = this.cacheConfigs[i];

      if (
        config.pattern.test(path) &&
        (config.methods.length === 0 || config.methods.includes(method))
      ) {
        return config;
      }
    }

    // Return default
    return this.cacheConfigs[this.cacheConfigs.length - 1];
  }

  /**
   * Set ETag and Last-Modified headers for cache validation
   */
  private setValidationHeaders(response: Response, data: any): void {
    try {
      // Generate ETag from response data
      const etag = this.generateETag(data);
      response.setHeader('ETag', etag);

      // Set Last-Modified to current time
      response.setHeader('Last-Modified', new Date().toUTCString());
    } catch (error) {
      // If we can't generate ETag, continue without it
      // This shouldn't break the response
    }
  }

  /**
   * Generate ETag hash from data
   */
  private generateETag(data: any): string {
    try {
      const crypto = require('crypto');
      const json = JSON.stringify(data);
      const hash = crypto.createHash('md5').update(json).digest('hex');
      return `"${hash}"`;
    } catch {
      // Fallback to timestamp-based ETag
      return `"${Date.now()}"`;
    }
  }
}
