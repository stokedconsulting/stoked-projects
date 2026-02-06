import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to skip rate limiting for specific endpoints
 * Use this for health checks and other endpoints that should not be rate limited
 */
export const SKIP_THROTTLE_KEY = 'skipThrottle';
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
