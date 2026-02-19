"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoDBServiceManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class MongoDBServiceManager {
    outputChannel;
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
    }
    /**
     * Check if Homebrew is installed
     */
    async isHomebrewInstalled() {
        try {
            await execAsync('which brew');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if MongoDB is installed via Homebrew
     */
    async isMongoDBInstalled() {
        try {
            const { stdout } = await execAsync('brew list mongodb-community 2>/dev/null');
            return stdout.trim().length > 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if MongoDB service is running
     */
    async isMongoDBRunning() {
        try {
            const { stdout } = await execAsync('brew services list | grep mongodb-community');
            return stdout.includes('started');
        }
        catch {
            return false;
        }
    }
    /**
     * Install MongoDB via Homebrew
     */
    async installMongoDB() {
        try {
            this.outputChannel.appendLine('[MongoDB] Installing MongoDB Community via Homebrew...');
            this.outputChannel.appendLine('[MongoDB] This may take several minutes...');
            // Add MongoDB tap
            await execAsync('brew tap mongodb/brew');
            // Install MongoDB
            await execAsync('brew install mongodb-community@7.0');
            this.outputChannel.appendLine('[MongoDB] MongoDB installed successfully');
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Installation failed: ${error}`);
            return false;
        }
    }
    /**
     * Start MongoDB service
     */
    async startMongoDB() {
        try {
            this.outputChannel.appendLine('[MongoDB] Starting MongoDB service...');
            await execAsync('brew services start mongodb-community@7.0');
            // Wait a moment for service to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            const running = await this.isMongoDBRunning();
            if (running) {
                this.outputChannel.appendLine('[MongoDB] MongoDB started successfully');
                return true;
            }
            else {
                this.outputChannel.appendLine('[MongoDB] MongoDB failed to start');
                return false;
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to start: ${error}`);
            return false;
        }
    }
    /**
     * Stop MongoDB service
     */
    async stopMongoDB() {
        try {
            this.outputChannel.appendLine('[MongoDB] Stopping MongoDB service...');
            await execAsync('brew services stop mongodb-community@7.0');
            this.outputChannel.appendLine('[MongoDB] MongoDB stopped');
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to stop: ${error}`);
            return false;
        }
    }
    /**
     * Restart MongoDB service
     */
    async restartMongoDB() {
        try {
            this.outputChannel.appendLine('[MongoDB] Restarting MongoDB service...');
            await execAsync('brew services restart mongodb-community@7.0');
            await new Promise(resolve => setTimeout(resolve, 3000));
            const running = await this.isMongoDBRunning();
            if (running) {
                this.outputChannel.appendLine('[MongoDB] MongoDB restarted successfully');
                return true;
            }
            else {
                this.outputChannel.appendLine('[MongoDB] MongoDB failed to restart');
                return false;
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to restart: ${error}`);
            return false;
        }
    }
    /**
     * Uninstall MongoDB
     */
    async uninstallMongoDB() {
        try {
            // Stop service first
            await this.stopMongoDB();
            this.outputChannel.appendLine('[MongoDB] Uninstalling MongoDB...');
            await execAsync('brew uninstall mongodb-community@7.0');
            this.outputChannel.appendLine('[MongoDB] MongoDB uninstalled');
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to uninstall: ${error}`);
            return false;
        }
    }
    /**
     * Get MongoDB service status
     */
    async getStatus() {
        return {
            homebrewInstalled: await this.isHomebrewInstalled(),
            mongodbInstalled: await this.isMongoDBInstalled(),
            mongodbRunning: await this.isMongoDBRunning()
        };
    }
    /**
     * Create MongoDB Atlas connection URI helper
     */
    createAtlasUri(username, password, cluster) {
        // Format: mongodb+srv://username:password@cluster.mongodb.net/stoked-projects?retryWrites=true&w=majority
        return `mongodb+srv://${username}:${encodeURIComponent(password)}@${cluster}.mongodb.net/stoked-projects?retryWrites=true&w=majority`;
    }
    /**
     * Test MongoDB connection
     */
    async testConnection(uri) {
        try {
            this.outputChannel.appendLine(`[MongoDB] Testing connection to: ${uri.replace(/:[^:@]+@/, ':****@')}`);
            // Use mongosh to test connection
            const command = `mongosh "${uri}" --eval "db.runCommand({ ping: 1 })" --quiet`;
            const { stdout } = await execAsync(command);
            if (stdout.includes('"ok"') || stdout.includes('1')) {
                this.outputChannel.appendLine('[MongoDB] Connection successful');
                return { success: true };
            }
            else {
                this.outputChannel.appendLine('[MongoDB] Connection failed');
                return { success: false, error: 'Connection test returned unexpected result' };
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Connection failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}
exports.MongoDBServiceManager = MongoDBServiceManager;
//# sourceMappingURL=mongodb-service-manager.js.map