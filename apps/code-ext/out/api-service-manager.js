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
exports.ApiServiceManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ApiServiceManager {
    extensionUri;
    apiPort = 8167;
    apiHost = 'localhost';
    serviceName = 'com.stoked-projects.api';
    plistName = 'com.stoked-projects.api.plist';
    outputChannel;
    deploymentMode = 'local';
    awsEndpoint;
    awsApiKey;
    awsRegion;
    mongodbUri = 'mongodb://localhost:27017/stoked-projects';
    apiKeys = [];
    constructor(extensionUri, outputChannel) {
        this.extensionUri = extensionUri;
        this.outputChannel = outputChannel;
        this.loadConfiguration();
    }
    /**
     * Load configuration from VS Code settings
     */
    loadConfiguration() {
        const config = vscode.workspace.getConfiguration('claudeProjects.api');
        const mongodbConfig = vscode.workspace.getConfiguration('claudeProjects.mongodb');
        // General settings
        this.deploymentMode = config.get('deploymentMode', 'local');
        // Local settings
        this.apiPort = config.get('local.port', 8167);
        this.apiKeys = config.get('local.apiKeys', []);
        // MongoDB URI - build from MongoDB configuration
        const mongoMode = mongodbConfig.get('mode', 'local');
        if (mongoMode === 'local') {
            this.mongodbUri = 'mongodb://localhost:27017/stoked-projects';
        }
        else if (mongoMode === 'atlas') {
            const username = mongodbConfig.get('atlas.username', '');
            const password = mongodbConfig.get('atlas.password', '');
            const cluster = mongodbConfig.get('atlas.cluster', '');
            if (username && password && cluster) {
                this.mongodbUri = `mongodb+srv://${username}:${encodeURIComponent(password)}@${cluster}.mongodb.net/stoked-projects?retryWrites=true&w=majority`;
            }
            else {
                this.outputChannel.appendLine('[API Service] WARNING: Atlas mode selected but credentials not configured, falling back to local');
                this.mongodbUri = 'mongodb://localhost:27017/stoked-projects';
            }
        }
        else if (mongoMode === 'custom') {
            this.mongodbUri = mongodbConfig.get('customUri', 'mongodb://localhost:27017/stoked-projects');
        }
        else {
            // Fallback to legacy setting if it exists
            this.mongodbUri = config.get('local.mongodbUri', 'mongodb://localhost:27017/stoked-projects');
        }
        // AWS settings
        this.awsEndpoint = config.get('aws.endpoint');
        this.awsApiKey = config.get('aws.apiKey');
        this.awsRegion = config.get('aws.region', 'us-east-1');
        this.outputChannel.appendLine(`[API Service] Deployment mode: ${this.deploymentMode}`);
        if (this.deploymentMode === 'local') {
            this.outputChannel.appendLine(`[API Service] Local port: ${this.apiPort}`);
            this.outputChannel.appendLine(`[API Service] MongoDB mode: ${mongoMode}`);
            this.outputChannel.appendLine(`[API Service] MongoDB URI: ${this.mongodbUri.replace(/:[^:@]+@/, ':****@')}`);
            if (this.apiKeys.length > 0) {
                this.outputChannel.appendLine(`[API Service] API keys configured: ${this.apiKeys.length}`);
            }
        }
        else if (this.deploymentMode === 'aws') {
            this.outputChannel.appendLine(`[API Service] AWS endpoint: ${this.awsEndpoint}`);
            this.outputChannel.appendLine(`[API Service] AWS region: ${this.awsRegion}`);
            if (this.awsApiKey) {
                this.outputChannel.appendLine(`[API Service] AWS API key configured`);
            }
        }
    }
    /**
     * Check if service is installed
     */
    async isServiceInstalled() {
        const homeDir = require('os').homedir();
        const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', this.plistName);
        return fs.existsSync(plistPath);
    }
    /**
     * Install the service
     */
    async installService() {
        try {
            const homeDir = require('os').homedir();
            const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
            const plistPath = path.join(launchAgentsDir, this.plistName);
            const logDir = path.join(homeDir, 'Library', 'Logs', 'stoked-projects');
            const apiPath = vscode.Uri.joinPath(this.extensionUri, 'api').fsPath;
            // Create directories if needed
            if (!fs.existsSync(launchAgentsDir)) {
                fs.mkdirSync(launchAgentsDir, { recursive: true });
            }
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            // Get node path
            const { stdout: nodePath } = await execAsync('which node');
            const nodePathTrimmed = nodePath.trim();
            // Create plist content with user-configured values
            const apiKeysEnv = this.apiKeys.length > 0 ? this.apiKeys.join(',') : '';
            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${this.serviceName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePathTrimmed}</string>
        <string>${apiPath}/main.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${apiPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>${this.apiPort}</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>MONGODB_URI</key>
        <string>${this.mongodbUri}</string>${apiKeysEnv ? `
        <key>API_KEYS</key>
        <string>${apiKeysEnv}</string>` : ''}
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${logDir}/api.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/api.error.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>`;
            fs.writeFileSync(plistPath, plistContent);
            this.outputChannel.appendLine(`[API Service] Service installed at ${plistPath}`);
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[API Service] Failed to install service: ${error}`);
            return false;
        }
    }
    /**
     * Check if service is loaded (running)
     */
    async isServiceLoaded() {
        try {
            const { stdout } = await execAsync(`launchctl list | grep ${this.serviceName}`);
            return stdout.trim().length > 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Start the API service
     */
    async startService() {
        // If using AWS deployment, don't start local service
        if (this.deploymentMode === 'aws') {
            this.outputChannel.appendLine('[API Service] Using AWS deployment, skipping local service start');
            if (!this.awsEndpoint) {
                this.outputChannel.appendLine('[API Service] WARNING: AWS mode enabled but no endpoint configured');
                return false;
            }
            return true;
        }
        // Check if service is installed
        const installed = await this.isServiceInstalled();
        if (!installed) {
            this.outputChannel.appendLine('[API Service] Service not installed, installing...');
            const installSuccess = await this.installService();
            if (!installSuccess) {
                return false;
            }
        }
        // Check if already loaded
        const loaded = await this.isServiceLoaded();
        if (loaded) {
            this.outputChannel.appendLine('[API Service] Service already running');
            return true;
        }
        try {
            const homeDir = require('os').homedir();
            const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', this.plistName);
            this.outputChannel.appendLine('[API Service] Starting service...');
            await execAsync(`launchctl load ${plistPath}`);
            // Wait for service to be ready
            const ready = await this.waitForService(10000);
            if (ready) {
                this.outputChannel.appendLine('[API Service] Service started successfully on port ' + this.apiPort);
                return true;
            }
            else {
                this.outputChannel.appendLine('[API Service] Service failed to start');
                return false;
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`[API Service] Failed to start: ${error}`);
            return false;
        }
    }
    /**
     * Stop the API service
     */
    async stopService() {
        try {
            const loaded = await this.isServiceLoaded();
            if (!loaded) {
                this.outputChannel.appendLine('[API Service] Service is not running');
                return true;
            }
            const homeDir = require('os').homedir();
            const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', this.plistName);
            this.outputChannel.appendLine('[API Service] Stopping service...');
            await execAsync(`launchctl unload ${plistPath}`);
            this.outputChannel.appendLine('[API Service] Service stopped');
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[API Service] Failed to stop: ${error}`);
            return false;
        }
    }
    /**
     * Uninstall the service
     */
    async uninstallService() {
        try {
            // Stop service first if running
            await this.stopService();
            const homeDir = require('os').homedir();
            const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', this.plistName);
            if (fs.existsSync(plistPath)) {
                fs.unlinkSync(plistPath);
                this.outputChannel.appendLine('[API Service] Service uninstalled');
            }
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[API Service] Failed to uninstall: ${error}`);
            return false;
        }
    }
    /**
     * Get service status information
     */
    async getServiceStatus() {
        const installed = await this.isServiceInstalled();
        const running = this.deploymentMode === 'aws' ? false : await this.isServiceLoaded();
        const responding = await this.isServiceRunning();
        return {
            installed,
            running,
            responding,
            mode: this.deploymentMode,
            endpoint: this.getApiUrl()
        };
    }
    /**
     * Check if the service is running by attempting a health check
     */
    async isServiceRunning() {
        return new Promise((resolve) => {
            const req = http.request({
                hostname: this.apiHost,
                port: this.apiPort,
                path: '/health',
                method: 'GET',
                timeout: 2000
            }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => {
                resolve(false);
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        });
    }
    /**
     * Wait for the service to become ready
     */
    async waitForService(timeoutMs) {
        const startTime = Date.now();
        const checkInterval = 500; // Check every 500ms
        while (Date.now() - startTime < timeoutMs) {
            const isRunning = await this.isServiceRunning();
            if (isRunning) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        return false;
    }
    /**
     * Get the API base URL
     */
    getApiUrl() {
        if (this.deploymentMode === 'aws' && this.awsEndpoint) {
            return this.awsEndpoint;
        }
        return `http://${this.apiHost}:${this.apiPort}`;
    }
    /**
     * Get current deployment mode
     */
    getDeploymentMode() {
        return this.deploymentMode;
    }
    /**
     * Reload configuration and restart service if needed
     */
    async reloadConfiguration() {
        const oldMode = this.deploymentMode;
        const oldEndpoint = this.awsEndpoint;
        const oldPort = this.apiPort;
        const oldMongoUri = this.mongodbUri;
        const oldApiKeys = [...this.apiKeys];
        this.loadConfiguration();
        // Check if local service configuration changed
        const localConfigChanged = oldPort !== this.apiPort ||
            oldMongoUri !== this.mongodbUri ||
            JSON.stringify(oldApiKeys) !== JSON.stringify(this.apiKeys);
        // If mode changed or local config changed, restart service
        if (oldMode !== this.deploymentMode || oldEndpoint !== this.awsEndpoint || localConfigChanged) {
            this.outputChannel.appendLine('[API Service] Configuration changed, restarting service...');
            // Stop old service if it was local
            if (oldMode === 'local') {
                await this.stopService();
            }
            // Reinstall service if local config changed (to update plist file)
            if (localConfigChanged && this.deploymentMode === 'local') {
                const installed = await this.isServiceInstalled();
                if (installed) {
                    this.outputChannel.appendLine('[API Service] Reinstalling service with new configuration...');
                    await this.installService();
                }
            }
            // Start new service
            await this.startService();
        }
    }
}
exports.ApiServiceManager = ApiServiceManager;
//# sourceMappingURL=api-service-manager.js.map