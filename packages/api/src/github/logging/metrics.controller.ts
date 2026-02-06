import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Metrics Controller
 *
 * Exposes Prometheus metrics endpoint at /metrics
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * GET /metrics - Prometheus metrics endpoint
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }

  /**
   * GET /metrics/json - JSON metrics for debugging
   */
  @Get('json')
  async getMetricsJSON(): Promise<any> {
    return this.metricsService.getMetricsJSON();
  }
}
