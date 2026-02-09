/**
 * Sensitive Data Filter
 *
 * Filters and redacts sensitive information from logs including:
 * - Authentication tokens (Bearer, GitHub tokens, API keys)
 * - Authorization headers
 * - Passwords and secrets
 * - Credit card numbers
 * - Email addresses (optional)
 */

export class SensitiveDataFilter {
  private static readonly REDACTED = '[REDACTED]';

  // Patterns to detect and redact
  private static readonly SENSITIVE_PATTERNS = [
    // GitHub tokens (classic and fine-grained)
    { pattern: /ghp_[a-zA-Z0-9]{36,}/gi, name: 'GitHub Personal Access Token' },
    { pattern: /github_pat_[a-zA-Z0-9_]{82}/gi, name: 'GitHub Fine-Grained Token' },
    { pattern: /gho_[a-zA-Z0-9]{36,}/gi, name: 'GitHub OAuth Token' },
    { pattern: /ghs_[a-zA-Z0-9]{36,}/gi, name: 'GitHub Server Token' },
    { pattern: /ghr_[a-zA-Z0-9]{36,}/gi, name: 'GitHub Refresh Token' },

    // Generic Bearer tokens
    { pattern: /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/gi, name: 'Bearer Token' },

    // API keys
    { pattern: /api[_-]?key["\s:=]+[a-zA-Z0-9\-_]{20,}/gi, name: 'API Key' },
    { pattern: /access[_-]?token["\s:=]+[a-zA-Z0-9\-_]{20,}/gi, name: 'Access Token' },
    { pattern: /secret[_-]?key["\s:=]+[a-zA-Z0-9\-_]{20,}/gi, name: 'Secret Key' },

    // AWS keys
    { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
    { pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)["\s:=]+[a-zA-Z0-9\/+=]{40}/gi, name: 'AWS Secret Key' },

    // Passwords
    { pattern: /password["\s:=]+[^\s"',}]{8,}/gi, name: 'Password' },
    { pattern: /passwd["\s:=]+[^\s"',}]{8,}/gi, name: 'Password' },

    // Credit cards (basic pattern)
    { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, name: 'Credit Card' },

    // Private keys
    { pattern: /-----BEGIN\s+(?:RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----/gi, name: 'Private Key' },
  ];

  // Header names that contain sensitive data
  private static readonly SENSITIVE_HEADERS = [
    'authorization',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'cookie',
    'set-cookie',
    'x-csrf-token',
    'x-xsrf-token',
  ];

  // Object keys that likely contain sensitive data
  private static readonly SENSITIVE_KEYS = [
    'password',
    'passwd',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'privateKey',
    'private_key',
    'clientSecret',
    'client_secret',
    'authorization',
    // Note: 'auth' removed to allow recursive filtering of auth objects
  ];

  /**
   * Filter sensitive data from any value
   */
  static filter(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.filterString(data);
    }

    if (typeof data === 'object') {
      if (Array.isArray(data)) {
        return data.map(item => this.filter(item));
      }
      return this.filterObject(data);
    }

    return data;
  }

  /**
   * Filter sensitive data from strings
   */
  static filterString(str: string): string {
    let filtered = str;

    for (const { pattern } of this.SENSITIVE_PATTERNS) {
      filtered = filtered.replace(pattern, this.REDACTED);
    }

    return filtered;
  }

  /**
   * Filter sensitive data from objects
   */
  static filterObject(obj: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if key is sensitive
      if (this.isSensitiveKey(key)) {
        filtered[key] = this.REDACTED;
        continue;
      }

      // Recursively filter the value
      filtered[key] = this.filter(value);
    }

    return filtered;
  }

  /**
   * Check if a key name indicates sensitive data
   */
  private static isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return this.SENSITIVE_KEYS.some(sensitiveKey =>
      lowerKey.includes(sensitiveKey.toLowerCase())
    ) || this.SENSITIVE_HEADERS.includes(lowerKey);
  }

  /**
   * Filter HTTP headers object
   */
  static filterHeaders(headers: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      if (this.SENSITIVE_HEADERS.includes(lowerKey)) {
        filtered[key] = this.REDACTED;
      } else {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Filter request/response body for logging
   */
  static filterBody(body: any): any {
    return this.filter(body);
  }

  /**
   * Check if a string contains sensitive data
   */
  static containsSensitiveData(str: string): boolean {
    return this.SENSITIVE_PATTERNS.some(({ pattern }) => {
      const regex = new RegExp(pattern);
      return regex.test(str);
    });
  }
}
