/**
 * API Client for State Tracking API
 *
 * Provides type-safe HTTP client for communicating with the api
 * with authentication, error handling, retries, and timeout support.
 */

/**
 * TypeScript interfaces for API schemas
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  order: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface WorkItem {
  id: string;
  phaseId: string;
  projectId: string;
  name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed';
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Custom error classes for API client
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';

    // Add setup instructions to help developers
    const setupInstructions = `

Authentication failed. Please ensure:
1. STATE_TRACKING_API_KEY environment variable is set
2. API key is valid and not expired
3. API key has appropriate permissions for the requested operation

To set up authentication:
  export STATE_TRACKING_API_KEY=your-api-key-here
`;
    this.message = message + setupInstructions;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ServerError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ServerError';
  }
}

/**
 * Configuration for API client
 */
export interface APIClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * HTTP request options
 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * API Client for State Tracking API
 */
export class APIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: APIClientConfig = {}) {
    // Read configuration from environment or config
    this.baseUrl = config.baseUrl || process.env.STATE_TRACKING_API_URL || 'https://claude-projects.truapi.com';
    this.apiKey = config.apiKey || process.env.STATE_TRACKING_API_KEY || '';
    this.timeout = config.timeout || 10000; // 10 seconds default
    this.maxRetries = config.maxRetries || 3;

    // Validate API key is present
    if (!this.apiKey) {
      throw new Error('STATE_TRACKING_API_KEY environment variable required');
    }
  }

  /**
   * Make HTTP request with authentication, timeout, and retry logic
   */
  private async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, body, headers = {} } = options;
    const url = `${this.baseUrl}${path}`;

    // Add authentication header
    const authHeaders: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    };

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        // Log request (sanitize API key)
        this.log(`${method} ${url}`, { headers: this.sanitizeHeaders(authHeaders) });

        const response = await fetch(url, {
          method,
          headers: authHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Log response
        this.log(`Response ${response.status}`, { url });

        // Handle error responses
        if (!response.ok) {
          await this.handleErrorResponse(response);
        }

        // Parse and return JSON response
        const data = await response.json();
        return data as T;

      } catch (error) {
        // Handle timeout
        if (error instanceof Error && error.name === 'AbortError') {
          throw new TimeoutError(`Request timeout after ${this.timeout}ms`);
        }

        // Handle server errors with retry logic
        if (error instanceof ServerError && attempt < this.maxRetries) {
          lastError = error;
          const backoffDelay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          this.log(`Server error, retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          await this.sleep(backoffDelay);
          attempt++;
          continue;
        }

        // Rethrow non-retryable errors
        throw error;
      }
    }

    // Max retries exceeded
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Handle error responses from API
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    const statusCode = response.status;
    let errorMessage = `HTTP ${statusCode}: ${response.statusText}`;

    // Try to parse error body
    try {
      const errorBody = await response.json() as { message?: string; error?: string };
      if (errorBody.message) {
        errorMessage = errorBody.message;
      } else if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // Ignore JSON parse errors, use default message
    }

    // Throw appropriate error type
    switch (statusCode) {
      case 401:
      case 403:
        throw new AuthenticationError(errorMessage);
      case 404:
        throw new NotFoundError(errorMessage);
      case 429:
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(errorMessage, retryAfter ? parseInt(retryAfter, 10) : undefined);
      case 500:
      case 502:
      case 503:
      case 504:
        throw new ServerError(errorMessage, statusCode);
      default:
        throw new Error(errorMessage);
    }
  }

  /**
   * GET request
   */
  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'GET', path, headers });
  }

  /**
   * POST request
   */
  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'POST', path, body, headers });
  }

  /**
   * PUT request
   */
  async put<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PUT', path, body, headers });
  }

  /**
   * PATCH request
   */
  async patch<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body, headers });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'DELETE', path, headers });
  }

  /**
   * Post a project event to the API for real-time broadcasting.
   * Fire-and-forget: errors are logged but never thrown.
   */
  async postProjectEvent(event: {
    type: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.post('/api/events/project', {
        type: event.type,
        data: event.data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.log(`Failed to post project event (non-fatal): ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Sanitize headers for logging (hide API keys)
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };
    if (sanitized['X-API-Key']) {
      sanitized['X-API-Key'] = '***REDACTED***';
    }
    if (sanitized['Authorization']) {
      sanitized['Authorization'] = 'Bearer ***REDACTED***';
    }
    return sanitized;
  }

  /**
   * Log message to stderr (don't pollute stdout for MCP)
   */
  private log(message: string, context?: unknown): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [APIClient] ${message}`, context ? JSON.stringify(context) : '');
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration (for testing)
   */
  getConfig() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      hasApiKey: !!this.apiKey,
    };
  }
}

/**
 * Create API client instance with configuration
 */
export function createAPIClient(config?: APIClientConfig): APIClient {
  return new APIClient(config);
}
