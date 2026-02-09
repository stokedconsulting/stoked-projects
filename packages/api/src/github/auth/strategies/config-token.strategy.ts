import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ITokenStrategy } from './token-strategy.interface';
import { TokenMetadata, TokenSource } from '../types';

/**
 * Strategy for obtaining GitHub token from application configuration
 */
@Injectable()
export class ConfigTokenStrategy implements ITokenStrategy {
  constructor(private readonly configService: ConfigService) {}

  async getToken(): Promise<TokenMetadata | null> {
    const token = this.configService.get<string>('github.token');
    if (!token) {
      return null;
    }

    // Config tokens don't have scope information available
    // They will need to be validated by the auth service
    return {
      token,
      scopes: [], // Unknown until validated
      expiresAt: null, // Config tokens typically don't expire
      source: TokenSource.CONFIG,
    };
  }

  async refreshToken(): Promise<TokenMetadata | null> {
    // Config tokens can't be refreshed automatically
    // Just return the current token
    return this.getToken();
  }

  async isAvailable(): Promise<boolean> {
    return !!this.configService.get<string>('github.token');
  }
}
