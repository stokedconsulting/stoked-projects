import { Injectable } from '@nestjs/common';
import { ITokenStrategy } from './token-strategy.interface';
import { TokenMetadata, TokenSource } from '../types';

/**
 * Strategy for obtaining GitHub token from environment variables
 */
@Injectable()
export class EnvTokenStrategy implements ITokenStrategy {
  private readonly tokenEnvVar = 'GITHUB_TOKEN';

  async getToken(): Promise<TokenMetadata | null> {
    const token = process.env[this.tokenEnvVar];
    if (!token) {
      return null;
    }

    // Environment tokens don't have scope information available
    // They will need to be validated by the auth service
    return {
      token,
      scopes: [], // Unknown until validated
      expiresAt: null, // Environment tokens typically don't expire
      source: TokenSource.ENV,
    };
  }

  async refreshToken(): Promise<TokenMetadata | null> {
    // Environment tokens can't be refreshed automatically
    // Just return the current token
    return this.getToken();
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env[this.tokenEnvVar];
  }
}
