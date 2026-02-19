"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
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
exports.APIClient = void 0;
const vscode = __importStar(require("vscode"));
/**
 * HTTP API Client for GitHub operations
 * Replaces direct GraphQL calls with HTTP requests to api
 */
class APIClient {
    baseUrl;
    timeout;
    session;
    _outputChannel;
    constructor(config = {}, outputChannel) {
        this.baseUrl = config.baseUrl || 'http://localhost:8167';
        this.timeout = config.timeout || 10000;
        this._outputChannel = outputChannel;
    }
    async initialize() {
        // Check if this is a localhost connection
        const isLocalhost = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
        // For localhost, skip GitHub authentication (API runs in development mode)
        if (isLocalhost) {
            if (this._outputChannel) {
                this._outputChannel.appendLine('[APIClient] Using localhost - skipping GitHub authentication');
            }
            return true;
        }
        // For remote API, require GitHub authentication
        try {
            this.session = await vscode.authentication.getSession('github', ['repo', 'read:org', 'read:project', 'project'], { createIfNone: true });
            return !!this.session;
        }
        catch (e) {
            console.error('Failed to initialize API client:', e);
            vscode.window.showErrorMessage('Failed to authenticate with GitHub.');
            return false;
        }
    }
    /**
     * Make HTTP request with authentication and timeout
     */
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        // Check if this is a localhost connection
        const isLocalhost = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
        try {
            const headers = {
                'Content-Type': 'application/json',
            };
            // Only add authentication headers for non-localhost URLs
            // Localhost API runs in development mode and allows unauthenticated access
            if (!isLocalhost) {
                if (!this.session) {
                    return { data: null, error: 'Not authenticated' };
                }
                headers['x-api-key'] = this.session.accessToken;
                headers['Authorization'] = `Bearer ${this.session.accessToken}`;
            }
            if (this._outputChannel) {
                this._outputChannel.appendLine(`[APIClient] ${method} ${path} (localhost: ${isLocalhost})`);
            }
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                if (this._outputChannel) {
                    this._outputChannel.appendLine(`[APIClient] Error ${response.status}: ${JSON.stringify(errorBody)}`);
                }
                return {
                    data: null,
                    error: errorBody.message || `HTTP ${response.status}: ${response.statusText}`,
                    errors: errorBody.errors,
                };
            }
            const data = await response.json();
            return { data };
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                return { data: null, error: 'Request timeout' };
            }
            if (this._outputChannel) {
                this._outputChannel.appendLine(`[APIClient] Request failed: ${error.message}`);
            }
            return { data: null, error: error.message };
        }
    }
    /**
     * Get projects linked to a repository
     */
    async getLinkedProjects(owner, repo) {
        return this.request('GET', `/api/github/projects/linked/${owner}/${repo}`).then((result) => ({
            projects: result.data?.projects || [],
            repositoryId: result.data?.repositoryId,
            error: result.error || result.data?.error,
            errors: result.errors,
        }));
    }
    /**
     * Get organization projects (unlinked)
     */
    async getOrganizationProjects(owner) {
        const result = await this.request('GET', `/api/github/projects/org/${owner}`);
        return result.data || [];
    }
    /**
     * Get project items
     */
    async getProjectItems(projectId) {
        const result = await this.request('GET', `/api/github/projects/${projectId}/items`);
        return result.data || [];
    }
    /**
     * Get project fields
     */
    async getProjectFields(projectId) {
        const result = await this.request('GET', `/api/github/projects/${projectId}/fields`);
        return result.data || [];
    }
    /**
     * Update item field value
     */
    async updateItemFieldValue(projectId, itemId, fieldId, optionId) {
        const result = await this.request('POST', `/api/github/projects/${projectId}/items/${itemId}/update-field`, { fieldId, optionId });
        return result.data?.success || false;
    }
    /**
     * Delete project item
     */
    async deleteProjectItem(projectId, itemId) {
        const result = await this.request('DELETE', `/api/github/projects/${projectId}/items/${itemId}`);
        return result.data?.success || false;
    }
    /**
     * Delete project
     */
    async deleteProject(projectId) {
        const result = await this.request('DELETE', `/api/github/projects/${projectId}`);
        return result.data?.success || false;
    }
    /**
     * Link project to repository
     */
    async linkProjectToRepository(projectId, repositoryId) {
        const result = await this.request('POST', `/api/github/projects/${projectId}/link`, { repositoryId });
        return result.data?.success || false;
    }
    /**
     * Unlink project from repository
     */
    async unlinkProjectFromRepository(projectId, repositoryId) {
        const result = await this.request('DELETE', `/api/github/projects/${projectId}/link`, { repositoryId });
        return result.data?.success || false;
    }
    /**
     * Get repository ID
     */
    async getRepositoryId(owner, repo) {
        const result = await this.request('GET', `/api/github/projects/repo/${owner}/${repo}/id`);
        return result.data?.repositoryId || null;
    }
    /**
     * Close an issue
     */
    async closeIssue(owner, repo, issueNumber) {
        const result = await this.request('POST', `/api/github/repos/${owner}/${repo}/issues/${issueNumber}/close`);
        return result.data?.success || false;
    }
    /**
     * Update workspace orchestration desired count
     */
    async updateWorkspaceDesired(workspaceId, desired) {
        const encodedWorkspaceId = encodeURIComponent(workspaceId);
        const result = await this.request('PUT', `/api/orchestration/workspace/${encodedWorkspaceId}/desired`, {
            desired,
        });
        // If there's an error, log it and throw
        if (result.error) {
            if (this._outputChannel) {
                this._outputChannel.appendLine(`[APIClient] updateWorkspaceDesired failed: ${result.error}`);
            }
            throw new Error(result.error);
        }
        return result.data;
    }
    /**
     * Get workspace orchestration data
     */
    async getWorkspaceOrchestration(workspaceId) {
        const encodedWorkspaceId = encodeURIComponent(workspaceId);
        const result = await this.request('GET', `/api/orchestration/workspace/${encodedWorkspaceId}`);
        // If there's an error, log it and throw
        if (result.error) {
            if (this._outputChannel) {
                this._outputChannel.appendLine(`[APIClient] getWorkspaceOrchestration failed: ${result.error}`);
            }
            throw new Error(result.error);
        }
        return result.data;
    }
}
exports.APIClient = APIClient;
//# sourceMappingURL=api-client.js.map