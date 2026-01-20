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
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    const validApiKeys = this.configService.get<string[]>('auth.apiKeys') || [];
    
    if (validApiKeys.length === 0) {
      // In development, allow if no API keys configured
      if (this.configService.get('app.environment') === 'development') {
        return true;
      }
      throw new UnauthorizedException('API keys not configured');
    }

    if (!validApiKeys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

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
