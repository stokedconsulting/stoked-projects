import { SensitiveDataFilter } from './sensitive-data.filter';

describe('SensitiveDataFilter', () => {
  describe('AC-1.3.b: Sensitive data redaction', () => {
    it('should redact GitHub personal access tokens', () => {
      const input = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('ghp_');
    });

    it('should redact GitHub fine-grained tokens', () => {
      const input = 'Auth: github_pat_' + 'A'.repeat(82);
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('github_pat_');
    });

    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer abc123def456ghi789';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('Bearer abc');
    });

    it('should redact API keys', () => {
      const input = 'api_key: sk_live_1234567890abcdefghij';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk_live');
    });

    it('should redact AWS access keys', () => {
      const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('AKIAIOSFO');
    });

    it('should redact passwords', () => {
      const input = 'password: mySecretPass123!';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('mySecretPass');
    });

    it('should redact credit card numbers', () => {
      const input = 'Card: 4532-1234-5678-9010';
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('4532-1234');
    });

    it('should redact private keys', () => {
      const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----`;
      const result = SensitiveDataFilter.filterString(input);
      expect(result).toBe('[REDACTED]');
    });
  });

  describe('filterObject', () => {
    it('should redact sensitive object keys', () => {
      const input = {
        username: 'john',
        password: 'secret123',
        apiKey: 'sk_test_123',
        data: 'public',
      };

      const result = SensitiveDataFilter.filter(input);

      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.data).toBe('public');
    });

    it('should recursively filter nested objects', () => {
      const input = {
        user: {
          name: 'john',
          auth: {
            token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
            refreshToken: 'refresh_abc123',
          },
        },
      };

      const result = SensitiveDataFilter.filter(input);

      expect(result.user.name).toBe('john');
      expect(result.user.auth.token).toBe('[REDACTED]');
      expect(result.user.auth.refreshToken).toBe('[REDACTED]');
    });

    it('should filter arrays of objects', () => {
      const input = [
        { id: 1, secret: 'secret1' },
        { id: 2, secret: 'secret2' },
      ];

      const result = SensitiveDataFilter.filter(input);

      expect(result[0].id).toBe(1);
      expect(result[0].secret).toBe('[REDACTED]');
      expect(result[1].id).toBe(2);
      expect(result[1].secret).toBe('[REDACTED]');
    });
  });

  describe('filterHeaders', () => {
    it('should redact authorization headers', () => {
      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-api-key': 'key123',
      };

      const result = SensitiveDataFilter.filterHeaders(headers);

      expect(result['content-type']).toBe('application/json');
      expect(result['authorization']).toBe('[REDACTED]');
      expect(result['x-api-key']).toBe('[REDACTED]');
    });

    it('should handle case-insensitive header names', () => {
      const headers = {
        'Authorization': 'Bearer token123',
        'X-API-Key': 'key123',
      };

      const result = SensitiveDataFilter.filterHeaders(headers);

      expect(result['Authorization']).toBe('[REDACTED]');
      expect(result['X-API-Key']).toBe('[REDACTED]');
    });
  });

  describe('containsSensitiveData', () => {
    it('should detect sensitive data in strings', () => {
      expect(SensitiveDataFilter.containsSensitiveData('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).toBe(true);
      expect(SensitiveDataFilter.containsSensitiveData('Bearer abc123def')).toBe(true);
      expect(SensitiveDataFilter.containsSensitiveData('Hello world')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined', () => {
      expect(SensitiveDataFilter.filter(null)).toBe(null);
      expect(SensitiveDataFilter.filter(undefined)).toBe(undefined);
    });

    it('should handle empty objects and arrays', () => {
      expect(SensitiveDataFilter.filter({})).toEqual({});
      expect(SensitiveDataFilter.filter([])).toEqual([]);
    });

    it('should handle non-string, non-object primitives', () => {
      expect(SensitiveDataFilter.filter(123)).toBe(123);
      expect(SensitiveDataFilter.filter(true)).toBe(true);
    });
  });
});
