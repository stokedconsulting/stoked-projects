import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Manages API key generation and storage for the Stoked Projects service
 *
 * The API key is stored in globalState so it's shared across all VSCode
 * instances on the machine. This allows the single system service to
 * authenticate all extension instances with the same key.
 */
export class ApiKeyManager {
    private static readonly API_KEY_STATE_KEY = 'claudeProjects.apiKey';
    private static readonly API_KEY_LENGTH = 32; // 32 bytes = 256 bits

    constructor(private context: vscode.ExtensionContext) { }

    /**
     * Get or generate API key
     * Returns existing key from global state, or generates and stores a new one
     */
    async getOrGenerateApiKey(): Promise<string> {
        // Check if we already have an API key
        const existingKey = this.context.globalState.get<string>(ApiKeyManager.API_KEY_STATE_KEY);

        if (existingKey) {
            return existingKey;
        }

        // Generate new API key
        const apiKey = this.generateApiKey();

        // Store in global state (shared across all VSCode instances)
        await this.context.globalState.update(ApiKeyManager.API_KEY_STATE_KEY, apiKey);

        return apiKey;
    }

    /**
     * Get current API key without generating a new one
     * Returns undefined if no key exists
     */
    getCurrentApiKey(): string | undefined {
        return this.context.globalState.get<string>(ApiKeyManager.API_KEY_STATE_KEY);
    }

    /**
     * Regenerate API key (useful for security rotation)
     * WARNING: This will break all existing service configurations until they're updated
     */
    async regenerateApiKey(): Promise<string> {
        const newKey = this.generateApiKey();
        await this.context.globalState.update(ApiKeyManager.API_KEY_STATE_KEY, newKey);
        return newKey;
    }

    /**
     * Clear API key from storage
     * WARNING: This will require service restart and reconfiguration
     */
    async clearApiKey(): Promise<void> {
        await this.context.globalState.update(ApiKeyManager.API_KEY_STATE_KEY, undefined);
    }

    /**
     * Generate a cryptographically secure random API key
     * Format: hex string (64 characters for 32 bytes)
     */
    private generateApiKey(): string {
        const buffer = crypto.randomBytes(ApiKeyManager.API_KEY_LENGTH);
        return buffer.toString('hex');
    }

    /**
     * Validate API key format
     */
    static isValidApiKey(key: string): boolean {
        // Must be 64 hex characters (32 bytes)
        return /^[0-9a-f]{64}$/i.test(key);
    }
}
