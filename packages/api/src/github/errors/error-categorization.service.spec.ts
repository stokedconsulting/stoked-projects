import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCategorizationService } from './error-categorization.service';
import {
  GitHubRateLimitException,
  GitHubAuthException,
  GitHubValidationException,
  GitHubServerException,
  GitHubNetworkException,
  GitHubUnknownException,
} from './github.exception';
import { GitHubErrorType } from './github-error.types';

describe('ErrorCategorizationService', () => {
  let service: ErrorCategorizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ErrorCategorizationService],
    }).compile();

    service = module.get<ErrorCategorizationService>(
      ErrorCategorizationService,
    );
  });

  describe('Rate Limit Errors (429)', () => {
    it('AC-1.4.a: should categorize 429 error with rate limit reset time', () => {
      const resetTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
      const error = {
        response: {
          status: 429,
          headers: {
            'x-ratelimit-reset': resetTime.toString(),
          },
        },
        message: 'API rate limit exceeded',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubRateLimitException);
      expect(result.details.type).toBe(GitHubErrorType.RATE_LIMIT);
      expect(result.details.status_code).toBe(429);
      expect(result.details.rate_limit_reset).toBe(resetTime);
      expect(result.details.retry_decision.should_retry).toBe(true);
      expect(result.details.retry_decision.max_retries).toBe(1);
      expect(result.details.user_message).toContain('rate limit');
    });

    it('should use default reset time if header missing', () => {
      const error = {
        response: { status: 429 },
        message: 'Rate limited',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubRateLimitException);
      expect(result.details.rate_limit_reset).toBeDefined();
      expect(result.details.rate_limit_reset).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
    });
  });

  describe('Auth Errors (401/403)', () => {
    it('AC-1.4.c: should categorize 401 error without retry', () => {
      const error = {
        response: { status: 401 },
        message: 'Bad credentials',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubAuthException);
      expect(result.details.type).toBe(GitHubErrorType.AUTH);
      expect(result.details.status_code).toBe(401);
      expect(result.details.retry_decision.should_retry).toBe(false);
      expect(result.details.retry_decision.max_retries).toBe(0);
      expect(result.details.user_message).toContain('authentication');
    });

    it('AC-1.4.c: should categorize 403 error without retry', () => {
      const error = {
        response: { status: 403 },
        message: 'Forbidden',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubAuthException);
      expect(result.details.type).toBe(GitHubErrorType.AUTH);
      expect(result.details.status_code).toBe(403);
      expect(result.details.retry_decision.should_retry).toBe(false);
      expect(result.details.user_message).toContain('authorization');
      expect(result.details.user_message).toContain('permissions');
    });
  });

  describe('Server Errors (500/502/503)', () => {
    it('AC-1.4.b: should categorize 500 error with retry strategy', () => {
      const error = {
        response: { status: 500 },
        message: 'Internal server error',
      };

      const result = service.categorize(error, 0);

      expect(result).toBeInstanceOf(GitHubServerException);
      expect(result.details.type).toBe(GitHubErrorType.SERVER);
      expect(result.details.status_code).toBe(500);
      expect(result.details.retry_decision.should_retry).toBe(true);
      expect(result.details.retry_decision.max_retries).toBe(3);
      expect(result.details.retry_decision.delay_ms).toBe(1000); // First attempt: 1s
    });

    it('AC-1.4.b: should use exponential backoff for retries', () => {
      const error = {
        response: { status: 502 },
        message: 'Bad gateway',
      };

      // Initial attempt (attempt 0) - first retry delay
      let result = service.categorize(error, 0);
      expect(result.details.retry_decision.delay_ms).toBe(1000); // 2^0 * 1000

      // First retry (attempt 1) - second retry delay
      result = service.categorize(error, 1);
      expect(result.details.retry_decision.delay_ms).toBe(2000); // 2^1 * 1000

      // Second retry (attempt 2) - third retry delay
      result = service.categorize(error, 2);
      expect(result.details.retry_decision.delay_ms).toBe(4000); // 2^2 * 1000

      // Third retry (attempt 3) - max retries reached
      result = service.categorize(error, 3);
      expect(result.details.retry_decision.delay_ms).toBe(8000); // 2^3 * 1000
      expect(result.details.retry_decision.should_retry).toBe(false); // Max retries reached
    });

    it('should handle 503 service unavailable', () => {
      const error = {
        response: { status: 503 },
        message: 'Service unavailable',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubServerException);
      expect(result.details.retry_decision.should_retry).toBe(true);
    });
  });

  describe('Network Errors', () => {
    it('should categorize timeout error with retry strategy', () => {
      const error = {
        code: 'ETIMEDOUT',
        message: 'Request timed out',
      };

      const result = service.categorize(error, 0);

      expect(result).toBeInstanceOf(GitHubNetworkException);
      expect(result.details.type).toBe(GitHubErrorType.NETWORK);
      expect(result.details.retry_decision.should_retry).toBe(true);
      expect(result.details.retry_decision.max_retries).toBe(3);
      expect(result.details.retry_decision.delay_ms).toBe(1000);
    });

    it('should categorize connection refused error', () => {
      const error = {
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubNetworkException);
      expect(result.details.type).toBe(GitHubErrorType.NETWORK);
      expect(result.details.user_message).toContain('Network error');
    });

    it('should detect timeout from error name', () => {
      const error = {
        name: 'TimeoutError',
        message: 'Operation timed out',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubNetworkException);
    });
  });

  describe('Validation Errors (400/422)', () => {
    it('should categorize 400 error without retry', () => {
      const error = {
        response: { status: 400 },
        message: 'Bad request',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubValidationException);
      expect(result.details.type).toBe(GitHubErrorType.VALIDATION);
      expect(result.details.status_code).toBe(400);
      expect(result.details.retry_decision.should_retry).toBe(false);
      expect(result.details.user_message).toContain('Invalid request');
    });

    it('should categorize 422 unprocessable entity', () => {
      const error = {
        response: { status: 422 },
        message: 'Validation failed',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubValidationException);
      expect(result.details.status_code).toBe(422);
    });
  });

  describe('Unknown Errors', () => {
    it('should categorize unknown error with single retry', () => {
      const error = {
        message: 'Something went wrong',
      };

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubUnknownException);
      expect(result.details.type).toBe(GitHubErrorType.UNKNOWN);
      expect(result.details.retry_decision.should_retry).toBe(true);
      expect(result.details.retry_decision.max_retries).toBe(1);
      expect(result.details.retry_decision.delay_ms).toBe(1000);
    });

    it('should handle errors without message', () => {
      const error = {};

      const result = service.categorize(error);

      expect(result).toBeInstanceOf(GitHubUnknownException);
      expect(result.details.technical_message).toBeDefined();
    });
  });

  describe('Error Message Extraction', () => {
    it('should extract message from error.message', () => {
      const error = {
        response: { status: 500 },
        message: 'Custom error message',
      };

      const result = service.categorize(error);

      expect(result.details.technical_message).toBe('Custom error message');
    });

    it('should extract message from response.data.message', () => {
      const error = {
        response: {
          status: 500,
          data: { message: 'Server error message' },
        },
      };

      const result = service.categorize(error);

      expect(result.details.technical_message).toBe('Server error message');
    });

    it('should extract message from GraphQL errors', () => {
      const error = {
        response: { status: 500 },
        errors: [{ message: 'GraphQL error 1' }, { message: 'GraphQL error 2' }],
      };

      const result = service.categorize(error);

      expect(result.details.technical_message).toContain('GraphQL error 1');
      expect(result.details.technical_message).toContain('GraphQL error 2');
    });
  });

  describe('AC-1.4.f: User-Friendly Error Messages', () => {
    it('should provide actionable message for rate limit', () => {
      const error = { response: { status: 429 } };
      const result = service.categorize(error);

      expect(result.details.user_message).toContain('rate limit');
      expect(result.details.user_message).toContain('wait');
    });

    it('should provide actionable message for auth errors', () => {
      const error = { response: { status: 401 } };
      const result = service.categorize(error);

      expect(result.details.user_message).toContain('authentication');
      expect(result.details.user_message).toContain('token');
    });

    it('should provide actionable message for validation errors', () => {
      const error = { response: { status: 400 } };
      const result = service.categorize(error);

      expect(result.details.user_message).toContain('Invalid request');
      expect(result.details.user_message).toContain('check');
    });
  });
});
