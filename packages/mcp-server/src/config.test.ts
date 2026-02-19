import {
  loadConfig,
  getConfig,
  resetConfig,
  createLogger,
  getLogger,
  resetLogger,
  ServerConfig,
  Logger,
} from './config';

// Prevent dotenv from re-injecting .env values during tests
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('Configuration Management', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment and config before each test
    jest.resetModules();
    process.env = { ...originalEnv };
    resetConfig();
    resetLogger();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    describe('AC-1.4.a: Required API key validation', () => {
      it('should fail when STATE_TRACKING_API_KEY is not set', () => {
        delete process.env.STATE_TRACKING_API_KEY;

        expect(() => loadConfig()).toThrow(
          'Required environment variable STATE_TRACKING_API_KEY not set'
        );
      });

      it('should fail when STATE_TRACKING_API_KEY is empty string', () => {
        process.env.STATE_TRACKING_API_KEY = '';

        expect(() => loadConfig()).toThrow(
          'Required environment variable STATE_TRACKING_API_KEY not set'
        );
      });

      it('should succeed when STATE_TRACKING_API_KEY is set', () => {
        process.env.STATE_TRACKING_API_KEY = 'test-api-key';

        expect(() => loadConfig()).not.toThrow();
        const config = getConfig();
        expect(config.apiKey).toBe('test-api-key');
      });
    });

    describe('AC-1.4.d: Default values for optional settings', () => {
      beforeEach(() => {
        process.env.STATE_TRACKING_API_KEY = 'test-key';
      });

      it('should apply default apiBaseUrl when not provided', () => {
        delete process.env.STATE_TRACKING_API_URL;

        const config = loadConfig();
        expect(config.apiBaseUrl).toBe('http://localhost:8167');
      });

      it('should apply default logLevel when not provided', () => {
        delete process.env.LOG_LEVEL;

        const config = loadConfig();
        expect(config.logLevel).toBe('info');
      });

      it('should apply default requestTimeout when not provided', () => {
        delete process.env.REQUEST_TIMEOUT_MS;

        const config = loadConfig();
        expect(config.requestTimeout).toBe(10000);
      });

      it('should apply default retryAttempts when not provided', () => {
        delete process.env.RETRY_ATTEMPTS;

        const config = loadConfig();
        expect(config.retryAttempts).toBe(3);
      });

      it('should use all default values when only API key is provided', () => {
        process.env = { STATE_TRACKING_API_KEY: 'test-key' };

        const config = loadConfig();
        expect(config).toEqual({
          apiKey: 'test-key',
          apiBaseUrl: 'http://localhost:8167',
          logLevel: 'info',
          requestTimeout: 10000,
          retryAttempts: 3,
        });
      });
    });

    describe('AC-1.4.e: Invalid log level validation', () => {
      beforeEach(() => {
        process.env.STATE_TRACKING_API_KEY = 'test-key';
      });

      it('should fail with invalid log level', () => {
        process.env.LOG_LEVEL = 'invalid';

        expect(() => loadConfig()).toThrow(
          "Invalid log level 'invalid'. Valid options are: debug, info, warn, error"
        );
      });

      it('should accept debug log level', () => {
        process.env.LOG_LEVEL = 'debug';

        const config = loadConfig();
        expect(config.logLevel).toBe('debug');
      });

      it('should accept info log level', () => {
        process.env.LOG_LEVEL = 'info';

        const config = loadConfig();
        expect(config.logLevel).toBe('info');
      });

      it('should accept warn log level', () => {
        process.env.LOG_LEVEL = 'warn';

        const config = loadConfig();
        expect(config.logLevel).toBe('warn');
      });

      it('should accept error log level', () => {
        process.env.LOG_LEVEL = 'error';

        const config = loadConfig();
        expect(config.logLevel).toBe('error');
      });
    });

    describe('Environment variable overrides', () => {
      beforeEach(() => {
        process.env.STATE_TRACKING_API_KEY = 'custom-key';
      });

      it('should override apiBaseUrl when STATE_TRACKING_API_URL is set', () => {
        process.env.STATE_TRACKING_API_URL = 'https://custom.example.com';

        const config = loadConfig();
        expect(config.apiBaseUrl).toBe('https://custom.example.com');
      });

      it('should override requestTimeout when REQUEST_TIMEOUT_MS is set', () => {
        process.env.REQUEST_TIMEOUT_MS = '30000';

        const config = loadConfig();
        expect(config.requestTimeout).toBe(30000);
      });

      it('should override retryAttempts when RETRY_ATTEMPTS is set', () => {
        process.env.RETRY_ATTEMPTS = '5';

        const config = loadConfig();
        expect(config.retryAttempts).toBe(5);
      });
    });

    describe('Numeric validation', () => {
      beforeEach(() => {
        process.env.STATE_TRACKING_API_KEY = 'test-key';
      });

      it('should fail with invalid REQUEST_TIMEOUT_MS', () => {
        process.env.REQUEST_TIMEOUT_MS = 'not-a-number';

        expect(() => loadConfig()).toThrow(
          'Invalid REQUEST_TIMEOUT_MS: must be a positive number'
        );
      });

      it('should fail with negative REQUEST_TIMEOUT_MS', () => {
        process.env.REQUEST_TIMEOUT_MS = '-1000';

        expect(() => loadConfig()).toThrow(
          'Invalid REQUEST_TIMEOUT_MS: must be a positive number'
        );
      });

      it('should fail with zero REQUEST_TIMEOUT_MS', () => {
        process.env.REQUEST_TIMEOUT_MS = '0';

        expect(() => loadConfig()).toThrow(
          'Invalid REQUEST_TIMEOUT_MS: must be a positive number'
        );
      });

      it('should fail with invalid RETRY_ATTEMPTS', () => {
        process.env.RETRY_ATTEMPTS = 'not-a-number';

        expect(() => loadConfig()).toThrow(
          'Invalid RETRY_ATTEMPTS: must be a non-negative number'
        );
      });

      it('should fail with negative RETRY_ATTEMPTS', () => {
        process.env.RETRY_ATTEMPTS = '-1';

        expect(() => loadConfig()).toThrow(
          'Invalid RETRY_ATTEMPTS: must be a non-negative number'
        );
      });

      it('should accept zero RETRY_ATTEMPTS', () => {
        process.env.RETRY_ATTEMPTS = '0';

        const config = loadConfig();
        expect(config.retryAttempts).toBe(0);
      });
    });
  });

  describe('getConfig', () => {
    it('should throw error when config not loaded', () => {
      expect(() => getConfig()).toThrow('Configuration not loaded. Call loadConfig() first.');
    });

    it('should return config after loading', () => {
      process.env.STATE_TRACKING_API_KEY = 'test-key';
      loadConfig();

      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('resetConfig', () => {
    it('should reset config state', () => {
      process.env.STATE_TRACKING_API_KEY = 'test-key';
      loadConfig();

      resetConfig();

      expect(() => getConfig()).toThrow('Configuration not loaded. Call loadConfig() first.');
    });
  });
});

describe('Logger', () => {
  let config: ServerConfig;
  let logger: Logger;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    resetLogger();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('AC-1.4.c: Debug logging when LOG_LEVEL=debug', () => {
    beforeEach(() => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'debug',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      logger = createLogger(config);
    });

    it('should log debug messages when log level is debug', () => {
      logger.debug('Debug message', { key: 'value' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Debug message')
      );
    });

    it('should log info messages when log level is debug', () => {
      logger.info('Info message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Info message'));
    });

    it('should log warn messages when log level is debug', () => {
      logger.warn('Warn message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
    });

    it('should log error messages when log level is debug', () => {
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
    });
  });

  describe('Log level filtering', () => {
    it('should only log info and above when log level is info', () => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'info',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      logger = createLogger(config);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Debug message')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Info message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
    });

    it('should only log warn and above when log level is warn', () => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'warn',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      logger = createLogger(config);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Debug message')
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Info message')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
    });

    it('should only log error when log level is error', () => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'error',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      logger = createLogger(config);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Debug message')
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Info message')
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Warn message')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
    });
  });

  describe('Log message formatting', () => {
    beforeEach(() => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'debug',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      logger = createLogger(config);
    });

    it('should include timestamp in ISO format', () => {
      logger.info('Test message');

      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should include log level in uppercase', () => {
      logger.info('Test message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
    });

    it('should include the message', () => {
      logger.info('Test message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Test message'));
    });

    it('should include additional arguments as JSON', () => {
      logger.info('Test message', { key: 'value', num: 42 });

      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toContain('{"key":"value","num":42}');
    });

    it('should handle multiple additional arguments', () => {
      logger.info('Test message', 'arg1', 'arg2', 123);

      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toContain('["arg1","arg2",123]');
    });

    it('should not include args JSON when no additional arguments', () => {
      logger.info('Test message');

      const call = consoleErrorSpy.mock.calls[0][0];
      // Check that the message ends with "Test message" and not with JSON args
      expect(call).toMatch(/Test message$/);
      // Should not contain JSON object/array after the message
      expect(call).not.toMatch(/Test message\s+[\[{]/);
    });
  });

  describe('getLogger', () => {
    it('should throw error when logger not initialized', () => {
      expect(() => getLogger()).toThrow('Logger not initialized. Call createLogger() first.');
    });

    it('should return logger after creation', () => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'info',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      createLogger(config);

      const logger = getLogger();
      expect(logger).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });
  });

  describe('resetLogger', () => {
    it('should reset logger state', () => {
      config = {
        apiKey: 'test-key',
        apiBaseUrl: 'https://test.example.com',
        logLevel: 'info',
        requestTimeout: 10000,
        retryAttempts: 3,
      };
      createLogger(config);

      resetLogger();

      expect(() => getLogger()).toThrow('Logger not initialized. Call createLogger() first.');
    });
  });
});
