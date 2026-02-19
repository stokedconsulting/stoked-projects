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
exports.ApiServiceManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const api_key_manager_1 = require("./api-key-manager");
const service_installers_1 = require("./service-installers");
const platform_utils_1 = require("./platform-utils");
/**
 * Manages the Stoked Projects API service installation and lifecycle
 *
 * This manager handles:
 * - Cross-platform service installation (macOS, Linux, Windows)
 * - Automatic API key generation and configuration
 * - Service health monitoring
 * - Configuration updates and service restarts
 */
class ApiServiceManager {
    context;
    outputChannel;
    serviceName = 'stoked-projects-api';
    serviceDisplayName = 'Stoked Projects API';
    serviceDescription = 'State tracking and notification API for Stoked Projects VSCode extension';
    apiKeyManager;
    platformInfo = (0, platform_utils_1.detectPlatform)();
    servicePaths = (0, platform_utils_1.getServicePaths)(this.serviceName);
    constructor(context, outputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.apiKeyManager = new api_key_manager_1.ApiKeyManager(context);
    }
    /**
     * Initialize service - ensures it's installed and running
     */
    async initialize() {
        try {
            this.log('Initializing Stoked Projects API service...');
            this.log(`Platform: ${this.platformInfo.platform}`);
            // Check if platform is supported
            if (!this.platformInfo.isSupported) {
                this.logError(`Unsupported platform: ${this.platformInfo.platform}`);
                vscode.window.showErrorMessage(`Stoked Projects: Platform ${this.platformInfo.platform} is not currently supported for service installation.`);
                return false;
            }
            // Generate or get API key
            const apiKey = await this.apiKeyManager.getOrGenerateApiKey();
            this.log('API key configured');
            // Get configuration
            const config = await this.getServiceConfig(apiKey);
            // Create service installer for platform
            const installer = (0, service_installers_1.createServiceInstaller)(config, this.outputChannel);
            // Check if service is installed
            const installed = await installer.isInstalled();
            if (!installed) {
                this.log('Service not installed, installing...');
                const installSuccess = await installer.install();
                if (!installSuccess) {
                    this.logError('Failed to install service');
                    return false;
                }
            }
            else {
                this.log('Service already installed');
            }
            // Check if service is running
            const running = await installer.isRunning();
            if (!running) {
                // Check if auto-start is enabled
                const autoStart = vscode.workspace.getConfiguration('claudeProjects.service').get('autoStart', true);
                if (autoStart) {
                    this.log('Auto-start enabled, starting service...');
                    const startSuccess = await installer.start();
                    if (!startSuccess) {
                        this.logError('Failed to start service');
                        return false;
                    }
                }
                else {
                    this.log('Auto-start disabled, service not started');
                    return false;
                }
            }
            else {
                this.log('Service is running');
                // Check if service is responding
                const status = await installer.getStatus();
                if (!status.responding) {
                    this.log('Service not responding, restarting...');
                    await installer.restart();
                }
            }
            this.log('Service initialization complete');
            return true;
        }
        catch (error) {
            this.logError('Failed to initialize service', error);
            return false;
        }
    }
    /**
     * Stop the service
     */
    async stop() {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }
            const config = await this.getServiceConfig(apiKey);
            const installer = (0, service_installers_1.createServiceInstaller)(config, this.outputChannel);
            return await installer.stop();
        }
        catch (error) {
            this.logError('Failed to stop service', error);
            return false;
        }
    }
    /**
     * Restart the service
     */
    async restart() {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }
            const config = await this.getServiceConfig(apiKey);
            const installer = (0, service_installers_1.createServiceInstaller)(config, this.outputChannel);
            return await installer.restart();
        }
        catch (error) {
            this.logError('Failed to restart service', error);
            return false;
        }
    }
    /**
     * Uninstall the service
     */
    async uninstall() {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            if (!apiKey) {
                this.logError('No API key found');
                return false;
            }
            const config = await this.getServiceConfig(apiKey);
            const installer = (0, service_installers_1.createServiceInstaller)(config, this.outputChannel);
            return await installer.uninstall();
        }
        catch (error) {
            this.logError('Failed to uninstall service', error);
            return false;
        }
    }
    /**
     * Get service status
     */
    async getStatus() {
        try {
            const apiKey = this.apiKeyManager.getCurrentApiKey();
            const config = await this.getServiceConfig(apiKey || 'none');
            const installer = (0, service_installers_1.createServiceInstaller)(config, this.outputChannel);
            const status = await installer.getStatus();
            return {
                ...status,
                port: config.port,
                apiKey: apiKey
            };
        }
        catch (error) {
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
    getApiUrl() {
        const port = vscode.workspace.getConfiguration('claudeProjects.service').get('port', 8167);
        return `http://localhost:${port}`;
    }
    /**
     * Get current API key
     */
    getCurrentApiKey() {
        return this.apiKeyManager.getCurrentApiKey();
    }
    /**
     * Build service configuration from extension settings
     */
    async getServiceConfig(apiKey) {
        // Get port from settings
        const port = vscode.workspace.getConfiguration('claudeProjects.service').get('port', 8167);
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
    buildMongoDbUri() {
        const mongoConfig = vscode.workspace.getConfiguration('claudeProjects.mongodb');
        const mode = mongoConfig.get('mode', 'local');
        switch (mode) {
            case 'local':
                return 'mongodb://localhost:27017/stoked-projects';
            case 'atlas': {
                const username = mongoConfig.get('atlas.username', '');
                const password = mongoConfig.get('atlas.password', '');
                const cluster = mongoConfig.get('atlas.cluster', '');
                if (username && password && cluster) {
                    return `mongodb+srv://${username}:${encodeURIComponent(password)}@${cluster}.mongodb.net/stoked-projects?retryWrites=true&w=majority`;
                }
                else {
                    this.log('WARNING: Atlas mode selected but credentials not configured, falling back to local');
                    return 'mongodb://localhost:27017/stoked-projects';
                }
            }
            case 'custom':
                return mongoConfig.get('customUri', 'mongodb://localhost:27017/stoked-projects');
            default:
                return 'mongodb://localhost:27017/stoked-projects';
        }
    }
    /**
     * Find node executable path
     */
    async findNodeExecutable() {
        const { execAsync } = require('./service-installers/base-service-installer');
        try {
            if (this.platformInfo.platform === 'win32') {
                const { stdout } = await execAsync('where node');
                return stdout.split('\n')[0].trim();
            }
            else {
                const { stdout } = await execAsync('which node');
                return stdout.trim();
            }
        }
        catch (error) {
            this.logError('Failed to find node executable, using default "node"', error);
            return 'node';
        }
    }
    log(message) {
        this.outputChannel.appendLine(`[API Service] ${message}`);
    }
    logError(message, error) {
        this.outputChannel.appendLine(`[API Service] ERROR: ${message}`);
        if (error) {
            this.outputChannel.appendLine(`[API Service] ${error}`);
        }
    }
}
exports.ApiServiceManager = ApiServiceManager;
//# sourceMappingURL=api-service-manager-v2.js.map