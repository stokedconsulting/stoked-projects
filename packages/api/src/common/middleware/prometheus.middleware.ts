import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrometheusService } from '../metrics/prometheus.service';

/**
 * Prometheus middleware for capturing HTTP metrics
 */
@Injectable()
export class PrometheusMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PrometheusMiddleware.name);

  constructor(private prometheusService: PrometheusService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Skip metrics collection for health and metrics endpoints themselves
    if (req.path === '/metrics' || req.path === '/health') {
      return next();
    }

    const startTime = Date.now();
    const method = req.method;
    const path = req.path;

    // Record request start
    this.prometheusService.recordHttpRequestStart(method, path);

    // Intercept response
    const originalSend = res.send;
    res.send = function (data: any) {
      const responseTime = Date.now() - startTime;
      const status = res.statusCode;

      // Record request end
      this.prometheusService.recordHttpRequestEnd(method, path, status, responseTime);

      // Call original send
      return originalSend.call(this, data);
    }.bind(this);

    next();
  }
}
