import * as fs from 'fs';
import * as path from 'path';
import { BaseServiceInstaller, ServiceConfig, execAsync } from './base-service-installer';
import * as vscode from 'vscode';

/**
 * Windows service installer using NSSM (Non-Sucking Service Manager)
 *
 * NSSM is a service helper which doesn't suck. It will run any application
 * as a service, monitoring it and restarting it if it dies.
 *
 * If NSSM is not installed, this installer will attempt to download and use
 * a bundled version or guide the user to install it.
 */
export class WindowsServiceInstaller extends BaseServiceInstaller {
    private readonly nssmExecutable = 'nssm.exe';

    async isInstalled(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`sc query "${this.config.serviceName}"`);
            return stdout.includes('SERVICE_NAME');
        } catch {
            return false;
        }
    }

    async install(): Promise<boolean> {
        try {
            // Check if NSSM is available
            const nssmAvailable = await this.isNssmAvailable();
            if (!nssmAvailable) {
                this.logError('NSSM is not installed. Please install NSSM from https://nssm.cc/');
                vscode.window.showErrorMessage(
                    'NSSM is required to install the Stoked Projects service on Windows. Please install NSSM from https://nssm.cc/ and restart VSCode.',
                    'Open NSSM Website'
                ).then(selection => {
                    if (selection === 'Open NSSM Website') {
                        vscode.env.openExternal(vscode.Uri.parse('https://nssm.cc/download'));
                    }
                });
                return false;
            }

            // Create log directory if needed
            if (!fs.existsSync(this.config.logDirectory)) {
                fs.mkdirSync(this.config.logDirectory, { recursive: true });
            }

            // Install service
            this.log('Installing Windows service...');

            // Basic service installation
            await execAsync(`${this.nssmExecutable} install "${this.config.serviceName}" "${this.config.nodeExecutable}" "${this.config.apiMainScript}"`);

            // Configure service parameters
            await this.configureService();

            this.log('Service installed successfully');
            return true;
        } catch (error) {
            this.logError('Failed to install service', error);
            return false;
        }
    }

    async uninstall(): Promise<boolean> {
        try {
            // Stop service first
            await this.stop();

            // Remove service
            this.log('Uninstalling Windows service...');
            await execAsync(`${this.nssmExecutable} remove "${this.config.serviceName}" confirm`);

            this.log('Service uninstalled');
            return true;
        } catch (error) {
            this.logError('Failed to uninstall service', error);
            return false;
        }
    }

    async isRunning(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`${this.nssmExecutable} status "${this.config.serviceName}"`);
            return stdout.trim().toLowerCase().includes('running') ||
                stdout.trim().toLowerCase().includes('service_running');
        } catch {
            return false;
        }
    }

    async start(): Promise<boolean> {
        try {
            // Check if already running
            const running = await this.isRunning();
            if (running) {
                this.log('Service already running');
                return true;
            }

            this.log('Starting service...');
            await execAsync(`${this.nssmExecutable} start "${this.config.serviceName}"`);

            // Wait for service to be ready
            const ready = await this.waitForService(10000);
            if (ready) {
                this.log(`Service started successfully on port ${this.config.port}`);
                return true;
            } else {
                this.logError('Service failed to start (health check timeout)');
                return false;
            }
        } catch (error) {
            this.logError('Failed to start service', error);
            return false;
        }
    }

    async stop(): Promise<boolean> {
        try {
            const running = await this.isRunning();
            if (!running) {
                this.log('Service is not running');
                return true;
            }

            this.log('Stopping service...');
            await execAsync(`${this.nssmExecutable} stop "${this.config.serviceName}"`);
            this.log('Service stopped');
            return true;
        } catch (error) {
            this.logError('Failed to stop service', error);
            return false;
        }
    }

    /**
     * Check if NSSM is available in PATH
     */
    private async isNssmAvailable(): Promise<boolean> {
        try {
            await execAsync('where nssm.exe');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Configure service after installation
     */
    private async configureService(): Promise<void> {
        const logFile = path.join(this.config.logDirectory, 'api.log');
        const errorLogFile = path.join(this.config.logDirectory, 'api.error.log');

        // Set working directory
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppDirectory "${this.config.apiWorkingDirectory}"`);

        // Set display name and description
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" DisplayName "${this.config.displayName}"`);
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" Description "${this.config.description}"`);

        // Set environment variables
        const envVars = [
            `PORT=${this.config.port}`,
            `NODE_ENV=production`,
            `MONGODB_URI=${this.config.mongodbUri}`,
            `API_KEYS=${this.config.apiKey}`
        ].join('\n');

        // NSSM uses null-separated environment variables
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppEnvironmentExtra "${envVars.replace(/\n/g, '\0')}"`);

        // Set log files
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppStdout "${logFile}"`);
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppStderr "${errorLogFile}"`);

        // Configure restart behavior
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppExit Default Restart`);
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" AppRestartDelay 10000`); // 10 second delay

        // Set service to start automatically
        await execAsync(`${this.nssmExecutable} set "${this.config.serviceName}" Start SERVICE_AUTO_START`);
    }
}
