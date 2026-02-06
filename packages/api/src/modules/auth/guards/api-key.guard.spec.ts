import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const createMockExecutionContext = (headers: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('should allow valid API key in Authorization header', () => {
      const validKey = 'test-api-key-123';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [validKey];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        authorization: `Bearer ${validKey}`,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow valid API key in X-API-Key header', () => {
      const validKey = 'test-api-key-123';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [validKey];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        'x-api-key': validKey,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should prefer Authorization header over X-API-Key header', () => {
      const validKey = 'valid-key';
      const invalidKey = 'invalid-key';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [validKey];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        authorization: `Bearer ${validKey}`,
        'x-api-key': invalidKey,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should reject invalid API key', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return ['valid-key'];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        authorization: 'Bearer invalid-key',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid API key');
    });

    it('should reject missing API key', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return ['valid-key'];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({});

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('API key is missing');
    });

    it('should allow requests in development mode when no keys configured', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [];
        if (key === 'app.environment') return 'development';
        return null;
      });

      const context = createMockExecutionContext({});

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should reject requests in production mode when no keys configured', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({});

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('API keys not configured');
    });

    it('should handle malformed Authorization header', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return ['valid-key'];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        authorization: 'InvalidFormat',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('API key is missing');
    });

    it('should allow any key from the configured list', () => {
      const keys = ['key1', 'key2', 'key3'];
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return keys;
        if (key === 'app.environment') return 'production';
        return null;
      });

      keys.forEach((validKey) => {
        const context = createMockExecutionContext({
          'x-api-key': validKey,
        });

        const result = guard.canActivate(context);
        expect(result).toBe(true);
      });
    });

    it('should be case-sensitive for API keys', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return ['ValidKey'];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        'x-api-key': 'validkey',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid API key');
    });
  });

  describe('extractApiKey', () => {
    it('should extract key from Bearer token', () => {
      const validKey = 'test-key';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [validKey];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        authorization: `Bearer ${validKey}`,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should extract key from X-API-Key header', () => {
      const validKey = 'test-key';
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return [validKey];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({
        'x-api-key': validKey,
      });

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should return undefined for empty headers', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.apiKeys') return ['valid-key'];
        if (key === 'app.environment') return 'production';
        return null;
      });

      const context = createMockExecutionContext({});

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });
});
