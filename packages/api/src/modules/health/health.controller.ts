import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // Health endpoints should not be rate limited
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
        uptime: { type: 'number' },
        database: { type: 'string', example: 'connected' },
        latency: { type: 'number', nullable: true },
      },
    },
  })
  async check() {
    return this.healthService.check();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe - checks if ready to serve traffic',
    description:
      'Kubernetes-style readiness probe. Returns 200 if the application is ready to accept traffic.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is ready',
    schema: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        timestamp: { type: 'string', format: 'date-time' },
        database: { type: 'string', enum: ['connected', 'disconnected'] },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready',
  })
  async ready() {
    return this.healthService.ready();
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe - checks if process is alive',
    description:
      'Kubernetes-style liveness probe. Returns 200 if the application process is responsive.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
    schema: {
      type: 'object',
      properties: {
        alive: { type: 'boolean' },
        timestamp: { type: 'string', format: 'date-time' },
        uptime: { type: 'number' },
      },
    },
  })
  async live() {
    return this.healthService.live();
  }

  @Get('detailed')
  @ApiOperation({
    summary: 'Detailed health check with system metrics',
    description:
      'Returns comprehensive health information including system metrics, memory usage, CPU, database connectivity, and active session counts.',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed health information',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded', 'unhealthy'] },
        timestamp: { type: 'string', format: 'date-time' },
        uptime: { type: 'number' },
        database: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['connected', 'disconnected'] },
            latency: { type: 'number' },
          },
        },
        metrics: {
          type: 'object',
          properties: {
            uptime: { type: 'number' },
            memoryUsage: { type: 'object' },
            cpuUsage: { type: 'object' },
            activeSessionCount: { type: 'number' },
            errorRate: { type: 'number' },
            averageResponseTime: { type: 'number' },
            databaseLatency: { type: 'number' },
            version: { type: 'string' },
          },
        },
        checks: {
          type: 'object',
          properties: {
            memory: { type: 'string', enum: ['ok', 'warning', 'critical'] },
            database: { type: 'string', enum: ['ok', 'warning', 'critical'] },
            responseTime: { type: 'string', enum: ['ok', 'warning', 'critical'] },
          },
        },
      },
    },
  })
  async detailed() {
    return this.healthService.detailed();
  }

  @Get('system')
  @ApiOperation({
    summary: 'System information',
    description: 'Returns detailed system information including Node.js version, platform, CPU count, and memory statistics.',
  })
  @ApiResponse({
    status: 200,
    description: 'System information',
    schema: {
      type: 'object',
      properties: {
        uptime: { type: 'number' },
        nodeVersion: { type: 'string' },
        platform: { type: 'string' },
        arch: { type: 'string' },
        cpus: { type: 'number' },
        totalMemory: { type: 'number' },
        freeMemory: { type: 'number' },
        heapUsed: { type: 'number' },
        heapTotal: { type: 'number' },
        external: { type: 'number' },
        rss: { type: 'number' },
      },
    },
  })
  async system() {
    return this.healthService.getSystemInfo();
  }
}
