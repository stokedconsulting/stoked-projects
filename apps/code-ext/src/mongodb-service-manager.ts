import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class MongoDBServiceManager {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Check if Homebrew is installed
     */
    async isHomebrewInstalled(): Promise<boolean> {
        try {
            await execAsync('which brew');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if MongoDB is installed via Homebrew
     */
    async isMongoDBInstalled(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('brew list mongodb-community 2>/dev/null');
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Check if MongoDB service is running
     */
    async isMongoDBRunning(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('brew services list | grep mongodb-community');
            return stdout.includes('started');
        } catch {
            return false;
        }
    }

    /**
     * Install MongoDB via Homebrew
     */
    async installMongoDB(): Promise<boolean> {
        try {
            this.outputChannel.appendLine('[MongoDB] Installing MongoDB Community via Homebrew...');
            this.outputChannel.appendLine('[MongoDB] This may take several minutes...');

            // Add MongoDB tap
            await execAsync('brew tap mongodb/brew');

            // Install MongoDB
            await execAsync('brew install mongodb-community@7.0');

            this.outputChannel.appendLine('[MongoDB] MongoDB installed successfully');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Installation failed: ${error}`);
            return false;
        }
    }

    /**
     * Start MongoDB service
     */
    async startMongoDB(): Promise<boolean> {
        try {
            this.outputChannel.appendLine('[MongoDB] Starting MongoDB service...');
            await execAsync('brew services start mongodb-community@7.0');

            // Wait a moment for service to start
            await new Promise(resolve => setTimeout(resolve, 3000));

            const running = await this.isMongoDBRunning();
            if (running) {
                this.outputChannel.appendLine('[MongoDB] MongoDB started successfully');
                return true;
            } else {
                this.outputChannel.appendLine('[MongoDB] MongoDB failed to start');
                return false;
            }
        } catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to start: ${error}`);
            return false;
        }
    }

    /**
     * Stop MongoDB service
     */
    async stopMongoDB(): Promise<boolean> {
        try {
            this.outputChannel.appendLine('[MongoDB] Stopping MongoDB service...');
            await execAsync('brew services stop mongodb-community@7.0');
            this.outputChannel.appendLine('[MongoDB] MongoDB stopped');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to stop: ${error}`);
            return false;
        }
    }

    /**
     * Restart MongoDB service
     */
    async restartMongoDB(): Promise<boolean> {
        try {
            this.outputChannel.appendLine('[MongoDB] Restarting MongoDB service...');
            await execAsync('brew services restart mongodb-community@7.0');

            await new Promise(resolve => setTimeout(resolve, 3000));

            const running = await this.isMongoDBRunning();
            if (running) {
                this.outputChannel.appendLine('[MongoDB] MongoDB restarted successfully');
                return true;
            } else {
                this.outputChannel.appendLine('[MongoDB] MongoDB failed to restart');
                return false;
            }
        } catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to restart: ${error}`);
            return false;
        }
    }

    /**
     * Uninstall MongoDB
     */
    async uninstallMongoDB(): Promise<boolean> {
        try {
            // Stop service first
            await this.stopMongoDB();

            this.outputChannel.appendLine('[MongoDB] Uninstalling MongoDB...');
            await execAsync('brew uninstall mongodb-community@7.0');
            this.outputChannel.appendLine('[MongoDB] MongoDB uninstalled');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`[MongoDB] Failed to uninstall: ${error}`);
            return false;
        }
    }

    /**
     * Get MongoDB service status
     */
    async getStatus(): Promise<{
        homebrewInstalled: boolean;
        mongodbInstalled: boolean;
        mongodbRunning: boolean;
    }> {
        return {
            homebrewInstalled: await this.isHomebrewInstalled(),
            mongodbInstalled: await this.isMongoDBInstalled(),
            mongodbRunning: await this.isMongoDBRunning()
        };
    }

    /**
     * Create MongoDB Atlas connection URI helper
     */
    createAtlasUri(username: string, password: string, cluster: string): string {
        // Format: mongodb+srv://username:password@cluster.mongodb.net/stoked-projects?retryWrites=true&w=majority
        return `mongodb+srv://${username}:${encodeURIComponent(password)}@${cluster}.mongodb.net/stoked-projects?retryWrites=true&w=majority`;
    }

    /**
     * Test MongoDB connection
     */
    async testConnection(uri: string): Promise<{ success: boolean; error?: string }> {
        try {
            this.outputChannel.appendLine(`[MongoDB] Testing connection to: ${uri.replace(/:[^:@]+@/, ':****@')}`);

            // Use mongosh to test connection
            const command = `mongosh "${uri}" --eval "db.runCommand({ ping: 1 })" --quiet`;
            const { stdout } = await execAsync(command);

            if (stdout.includes('"ok"') || stdout.includes('1')) {
                this.outputChannel.appendLine('[MongoDB] Connection successful');
                return { success: true };
            } else {
                this.outputChannel.appendLine('[MongoDB] Connection failed');
                return { success: false, error: 'Connection test returned unexpected result' };
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[MongoDB] Connection failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}
