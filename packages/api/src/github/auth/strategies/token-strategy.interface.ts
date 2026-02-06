import { TokenMetadata } from '../types';

/**
 * Interface for token acquisition strategies
 */
export interface ITokenStrategy {
  /**
   * Get a token from this source
   * @returns Token metadata if available, null otherwise
   */
  getToken(): Promise<TokenMetadata | null>;

  /**
   * Refresh the token from this source
   * @returns Refreshed token metadata if successful, null otherwise
   */
  refreshToken(): Promise<TokenMetadata | null>;

  /**
   * Check if this strategy can provide a token
   * @returns True if a token might be available
   */
  isAvailable(): Promise<boolean>;
}
