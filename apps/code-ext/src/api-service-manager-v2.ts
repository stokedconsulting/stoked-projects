import * as vscode from 'vscode';
import * as path from 'path';
import { ApiKeyManager } from './api-key-manager';
import { createServiceInstaller, ServiceConfig } from './service-installers';
import { detectPlatform, getServicePaths } from './platform-utils';

/**
 * Manages the Stoked Projects API service installation and lifecycle
 *
 * This manager handles:
 * - Cross-platform service installation (macOS, Linux, Windows)
 * - Automatic API key generation and configuration
 * - Service health monitoring
 * - Configuration updates and service restarts
 */
export class ApiServiceManager {
    private readonly serviceName = 'stoked-projects-api';
    private readonly serviceDisplayName = 'Stoked Projects API';
    private readonly serviceDescription = 'State tracking and notification API for Stoked Projects VSCode extension';

    private apiKeyManager: ApiKeyManager;
    private platformInfo = detectPlatform();
    private servicePaths = getServicePaths(this.serviceName);

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.apiKeyManager = new ApiKeyManager(context);
    }

    /**
     * Initialize service - ensures it's installed and running
     */
    async initialize(): Promise<boolean> {
        try {
            this.log('Initializing Stoked Projects API service...');
            this.log(`Platform: ${this.platformInfo.platform}`);

            // Check if platform is supported
            if (!this.platformInfo.isSupported) {
                this.logError(`Unsupported platform: ${this.platformInfo.platform}`);
                vscode.window.showErrorMessage(
                    `Stoked Projects: Platform ${this.platformInfo.platform} is not currently supported for service installation.`
                );
                return false;
            }

            // Fast path: if the service is already responding on its port, skip
            // all install/start logic. This prevents multiple VSCode windows from
            // racing to restart the same launchd/systemd singleton.
            if (await this.isServiceResponding()) {
                this.log('Service already responding — skipping install/start');
                return true;
            }

            // Generate or get API key
            const apiKey = await this.apiKeyManager.getOrGenerateApiKey();
            this.log('API key configured');

            // Get configuration
            const config = await this.getServiceConfig(apiKey);

            // Create service installer for platform
            const installer = createServiceInstaller(config, this.outputChannel);

            // Check if service is installed
            const installed = await installer.isInstalled();

            if (!installed) {
                this.log('Service not installed, installing...');
                const installSuccess = await installer.install();
                if (!installSuccess) {
                    this.logError('Failed to install service');
                    return false;
                }
            } else {
                this.log('Service already installed');
            }

            // Check if service is running
            const running = await installer.isRunning();

            if (!running) {
                // Check if auto-start is enabled
                const autoStart = vscode.workspace.getConfiguration('claudeProjects.service').get<boolean>('autoStart', true);
                if (autoStart) {
                    this.log('Auto-start enabled, starting service...');
                    const startSuccess = await installer.start();
                    if (!startSuccess) {
                        this.logError('Failed to start service');
                        return false;
                    }
                } else {
                    this.log('Auto-start disabled, service not started');
                    return false;
                }
            } else {
                this.log('Service is running');

                // The service process exists but may still be booting.
                // Wait briefly before deciding to restart — another window may
                // have just launched it.
                const responding = await this.waitForResponding(8000);
                if (!responding) {
                    this.log('Service not responding after wait, restarting...');
                    await installer.restart();
                }
            }

            this.log('Service initialization complete');
            return true;
        } catch (error) {
            this.logError('Failed to initialize service', error);
            return false;
        }
    }

    /**
     * Stop the service
     */
    async stop(): Promise<boolean> {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }

            const config = await this.getServiceConfig(apiKey);
            const installer = createServiceInstaller(config, this.outputChannel);

            return await installer.stop();
        } catch (error) {
            this.logError('Failed to stop service', error);
            return false;
        }
    }

    /**
     * Restart the service
     */
    async restart(): Promise<boolean> {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }

            const config = await this.getServiceConfig(apiKey);
            const installer = createServiceInstaller(config, this.outputChannel);

            return await installer.restart();
        } catch (error) {
            this.logError('Failed to restart service', error);
            return false;
        }
    }

    /**
     * Uninstall the service
     */
    async uninstall(): Promise<boolean> {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }

            const config = await this.getServiceConfig(apiKey);
            const installer = createServiceInstaller(config, this.outputChannel);

            return await installer.uninstall();
        } catch (error) {
            this.logError('Failed to uninstall service', error);
            return false;
        }
    }

    /**
     * Get service status
     */
    async getStatus(): Promise<{
        installed: boolean;
        running: boolean;
        responding: boolean;
        port: number;
        apiKey: string | undefined;
    }> {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            const config = await this.getServiceConfig(apiKey || 'none');
            const installer = createServiceInstaller(config, this.outputChannel);

            const status = await installer.getStatus();

            return {
                ...status,
                port: config.port,
                apiKey: apiKey
            };
        } catch (error) {
            this.logError('Failed to get service status', error);
            return {
                installed: false,
                running: false,
                responding: false,
                port: 8167,
                apiKey: undefined
            };
        }
    }

    /**
     * Get API base URL
     */
    getApiUrl(): string {
        const port = vscode.workspace.getConfiguration('claudeProjects.service').get<number>('port', 8167);
        return `http://localhost:${port}`;
    }

    /**
     * Get current API key
     */
    getCurrentApiKey(): string | undefined {
        return this.apiKeyManager.getCurrentApiKey();
    }

    /**
     * Build service configuration from extension settings
     */
    private async getServiceConfig(apiKey: string): Promise<ServiceConfig> {
        // Get port from settings
        const port = vscode.workspace.getConfiguration('claudeProjects.service').get<number>('port', 8167);

        // Get MongoDB configuration
        const mongodbUri = this.buildMongoDbUri();

        // Find node executable
        const nodeExecutable = await this.findNodeExecutable();

        // Get API main script path from bundled extension
        // The API will be bundled into the extension's dist folder
        const apiMainScript = path.join(this.context.extensionPath, 'dist', 'api', 'main.js');
        const apiWorkingDirectory = path.join(this.context.extensionPath, 'dist', 'api');

        return {
            serviceName: this.serviceName,
            displayName: this.serviceDisplayName,
            description: this.serviceDescription,
            port,
            nodeExecutable,
            apiMainScript,
            apiWorkingDirectory,
            mongodbUri,
            apiKey,
            logDirectory: this.servicePaths.logPath
        };
    }

    /**
     * Build MongoDB URI from configuration
     */
    private buildMongoDbUri(): string {
        const mongoConfig = vscode.workspace.getConfiguration('claudeProjects.mongodb');
        const mode = mongoConfig.get<string>('mode', 'local');

        switch (mode) {
            case 'local':
                return 'mongodb://localhost:27017/stoked-projects';

            case 'atlas': {
                const username = mongoConfig.get<string>('atlas.username', '');
                const password = mongoConfig.get<string>('atlas.password', '');
                const cluster = mongoConfig.get<string>('atlas.cluster', '');

                if (username && password && cluster) {
                    return `mongodb+srv://${username}:${encodeURIComponent(password)}@${cluster}.mongodb.net/stoked-projects?retryWrites=true&w=majority`;
                } else {
                    this.log('WARNING: Atlas mode selected but credentials not configured, falling back to local');
                    return 'mongodb://localhost:27017/stoked-projects';
                }
            }

            case 'custom':
                return mongoConfig.get<string>('customUri', 'mongodb://localhost:27017/stoked-projects');

            default:
                return 'mongodb://localhost:27017/stoked-projects';
        }
    }

    /**
     * Find node executable path
     */
    private async findNodeExecutable(): Promise<string> {
        const { execAsync } = require('./service-installers/base-service-installer');

        try {
            if (this.platformInfo.platform === 'win32') {
                const { stdout } = await execAsync('where node');
                return stdout.split('\n')[0].trim();
            } else {
                const { stdout } = await execAsync('which node');
                return stdout.trim();
            }
        } catch (error) {
            this.logError('Failed to find node executable, using default "node"', error);
            return 'node';
        }
    }

    /**
     * Lightweight health check — just hit the port, no installer overhead.
     */
    private async isServiceResponding(): Promise<boolean> {
        const port = vscode.workspace.getConfiguration('claudeProjects.service').get<number>('port', 8167);
        const http = require('http');

        return new Promise<boolean>((resolve) => {
            const req = http.request(
                { hostname: 'localhost', port, path: '/health', method: 'GET', timeout: 2000 },
                (res: any) => resolve(res.statusCode === 200),
            );
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.end();
        });
    }

    /**
     * Poll the health endpoint for up to `timeoutMs`, giving a recently-
     * launched service time to finish booting before we restart it.
     */
    private async waitForResponding(timeoutMs: number): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this.isServiceResponding()) {
                return true;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        return false;
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[API Service] ${message}`);
    }

    private logError(message: string, error?: any): void {
        this.outputChannel.appendLine(`[API Service] ERROR: ${message}`);
        if (error) {
            this.outputChannel.appendLine(`[API Service] ${error}`);
        }
    }
}
