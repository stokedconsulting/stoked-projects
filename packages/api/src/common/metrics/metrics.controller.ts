import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrometheusService } from './prometheus.service';

@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly prometheusService: PrometheusService) {}

  @Get()
  getMetrics(): string {
    return this.prometheusService.export();
  }
}
