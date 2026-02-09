import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

/**
 * Module for GitHub API rate limiting and request queuing
 */
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
