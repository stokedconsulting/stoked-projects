"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyManager = void 0;
const crypto = __importStar(require("crypto"));
/**
 * Manages API key generation and storage for the Stoked Projects service
 *
 * The API key is stored in globalState so it's shared across all VSCode
 * instances on the machine. This allows the single system service to
 * authenticate all extension instances with the same key.
 */
class ApiKeyManager {
    context;
    static API_KEY_STATE_KEY = 'claudeProjects.apiKey';
    static API_KEY_LENGTH = 32; // 32 bytes = 256 bits
    constructor(context) {
        this.context = context;
    }
    /**
     * Get or generate API key
     * Returns existing key from global state, or generates and stores a new one
     */
    async getOrGenerateApiKey() {
        // Check if we already have an API key
        const existingKey = this.context.globalState.get(ApiKeyManager.API_KEY_STATE_KEY);
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
    getCurrentApiKey() {
        return this.context.globalState.get(ApiKeyManager.API_KEY_STATE_KEY);
    }
    /**
     * Regenerate API key (useful for security rotation)
     * WARNING: This will break all existing service configurations until they're updated
     */
    async regenerateApiKey() {
        const newKey = this.generateApiKey();
        await this.context.globalState.update(ApiKeyManager.API_KEY_STATE_KEY, newKey);
        return newKey;
    }
    /**
     * Clear API key from storage
     * WARNING: This will require service restart and reconfiguration
     */
    async clearApiKey() {
        await this.context.globalState.update(ApiKeyManager.API_KEY_STATE_KEY, undefined);
    }
    /**
     * Generate a cryptographically secure random API key
     * Format: hex string (64 characters for 32 bytes)
     */
    generateApiKey() {
        const buffer = crypto.randomBytes(ApiKeyManager.API_KEY_LENGTH);
        return buffer.toString('hex');
    }
    /**
     * Validate API key format
     */
    static isValidApiKey(key) {
        // Must be 64 hex characters (32 bytes)
        return /^[0-9a-f]{64}$/i.test(key);
    }
}
exports.ApiKeyManager = ApiKeyManager;
//# sourceMappingURL=api-key-manager.js.map