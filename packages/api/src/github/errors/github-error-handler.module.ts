import { Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ErrorCategorizationService } from './error-categorization.service';
import { RetryStrategyService } from './retry-strategy.service';

/**
 * GitHub Error Handler Module
 *
 * Provides error handling services for GitHub API operations
 */
@Module({
  providers: [
    CircuitBreakerService,
    ErrorCategorizationService,
    RetryStrategyService,
  ],
  exports: [
    CircuitBreakerService,
    ErrorCategorizationService,
    RetryStrategyService,
  ],
})
export class GitHubErrorHandlerModule {}
