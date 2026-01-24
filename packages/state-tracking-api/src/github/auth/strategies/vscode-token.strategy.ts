import { Injectable } from '@nestjs/common';
import { ITokenStrategy } from './token-strategy.interface';
import { TokenMetadata, TokenSource } from '../types';

/**
 * VSCode authentication session data structure
 */
export interface VSCodeAuthSession {
  accessToken: string;
  scopes: string[];
  account: {
    id: string;
    label: string;
  };
}

/**
 * Strategy for obtaining GitHub token from VSCode authentication API
 * This is primarily used when running as a VSCode extension
 */
@Injectable()
export class VSCodeTokenStrategy implements ITokenStrategy {
  private sessionProvider?: () => Promise<VSCodeAuthSession | null>;

  /**
   * Set the VSCode session provider
   * This should be called by the extension to inject the authentication session
   */
  setSessionProvider(provider: () => Promise<VSCodeAuthSession | null>): void {
    this.sessionProvider = provider;
  }

  async getToken(): Promise<TokenMetadata | null> {
    if (!this.sessionProvider) {
      return null;
    }

    const session = await this.sessionProvider();
    if (!session) {
      return null;
    }

    return {
      token: session.accessToken,
      scopes: session.scopes || [],
      expiresAt: null, // VSCode handles token expiration internally
      source: TokenSource.VSCODE,
    };
  }

  async refreshToken(): Promise<TokenMetadata | null> {
    // VSCode handles token refresh internally
    // Just fetch the current session which may have been refreshed
    return this.getToken();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.sessionProvider) {
      return false;
    }

    const session = await this.sessionProvider();
    return !!session;
  }
}
