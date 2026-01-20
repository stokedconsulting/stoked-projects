import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
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
      },
    },
  })
  async check() {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({ 
    status: 200, 
    description: 'Application is ready',
    schema: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  async ready() {
    return this.healthService.ready();
  }
}
