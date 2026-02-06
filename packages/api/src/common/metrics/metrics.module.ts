import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrometheusService } from './prometheus.service';
import { MetricsController } from './metrics.controller';

@Module({
  providers: [MetricsService, PrometheusService],
  controllers: [MetricsController],
  exports: [MetricsService, PrometheusService],
})
export class MetricsModule {}
