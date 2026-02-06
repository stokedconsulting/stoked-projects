import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const validApiKeys = this.configService.get<string[]>('auth.apiKeys') || [];

    // In development mode, allow unauthenticated access (for localhost clients)
    if (this.configService.get('app.environment') === 'development') {
      const apiKey = this.extractApiKey(request);

      // If no API key provided, allow in development mode
      if (!apiKey) {
        request.apiKeyIdentifier = 'development-mode-no-auth';
        return true;
      }

      // If API key provided, validate it
      if (validApiKeys.length > 0 && !validApiKeys.includes(apiKey)) {
        throw new UnauthorizedException('Invalid API key');
      }

      // Valid API key or no keys configured - allow
      request.apiKeyIdentifier = apiKey ? apiKey.substring(0, 8) : 'development-mode';
      return true;
    }

    // In production, require API key
    if (validApiKeys.length === 0) {
      throw new UnauthorizedException('API keys not configured');
    }

    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    if (!validApiKeys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach API key identifier to request context for logging
    // Use first 8 characters of the key as identifier
    request.apiKeyIdentifier = apiKey.substring(0, 8);

    return true;
  }

  private extractApiKey(request: any): string | undefined {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check x-api-key header
    const apiKeyHeader = request.headers['x-api-key'];
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    return undefined;
  }
}
