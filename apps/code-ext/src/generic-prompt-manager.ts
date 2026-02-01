import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface GenericPrompt {
    filePath: string;
    filename: string;
    source: 'global' | 'workspace';
    content: string;
}

export class GenericPromptManager {
    private globalDir: string;
    private workspaceDir: string;

    constructor(private workspaceRoot: string) {
        this.globalDir = path.join(os.homedir(), '.claude-projects', 'generic');
        this.workspaceDir = path.join(workspaceRoot, '.claude-projects', 'generic');
    }

    /**
     * Discover all available generic prompts from both global and workspace directories.
     * Excludes files in `dispatched/` subdirectory and files with `.dispatched` markers.
     * Workspace prompts override global prompts when filenames collide.
     */
    discoverPrompts(): GenericPrompt[] {
        const prompts: Map<string, GenericPrompt> = new Map();

        // Load global prompts first
        const globalPrompts = this.loadPromptsFromDirectory(this.globalDir, 'global');
        for (const prompt of globalPrompts) {
            prompts.set(prompt.filename, prompt);
        }

        // Load workspace prompts (override global if same filename)
        const workspacePrompts = this.loadPromptsFromDirectory(this.workspaceDir, 'workspace');
        for (const prompt of workspacePrompts) {
            prompts.set(prompt.filename, prompt);
        }

        return Array.from(prompts.values());
    }

    /**
     * Mark a prompt as dispatched by creating a `.dispatched` marker file.
     */
    markDispatched(prompt: GenericPrompt): void {
        const markerPath = `${prompt.filePath}.dispatched`;
        const markerContent = JSON.stringify({
            dispatchedAt: new Date().toISOString(),
            filename: prompt.filename
        }, null, 2);

        try {
            fs.writeFileSync(markerPath, markerContent, 'utf8');
        } catch (error) {
            console.error(`Failed to create dispatched marker for ${prompt.filename}:`, error);
            throw error;
        }
    }

    /**
     * Get count of available (undispatched) prompts.
     */
    getAvailableCount(): number {
        return this.discoverPrompts().length;
    }

    /**
     * Load prompts from a specific directory.
     * Excludes files in `dispatched/` subdirectory and files with `.dispatched` markers.
     */
    private loadPromptsFromDirectory(dir: string, source: 'global' | 'workspace'): GenericPrompt[] {
        const prompts: GenericPrompt[] = [];

        // Check if directory exists
        if (!fs.existsSync(dir)) {
            console.log(`Directory does not exist: ${dir}`);
            return prompts;
        }

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                // Skip directories (including 'dispatched/' subdirectory)
                if (entry.isDirectory()) {
                    continue;
                }

                // Skip non-.md files
                if (!entry.name.endsWith('.md')) {
                    continue;
                }

                // Skip .dispatched marker files
                if (entry.name.endsWith('.md.dispatched')) {
                    continue;
                }

                const filePath = path.join(dir, entry.name);

                // Check if this file has a .dispatched marker
                const markerPath = `${filePath}.dispatched`;
                if (fs.existsSync(markerPath)) {
                    continue;
                }

                // Read file content
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    prompts.push({
                        filePath,
                        filename: entry.name,
                        source,
                        content
                    });
                } catch (error) {
                    console.error(`Failed to read prompt file ${filePath}:`, error);
                }
            }
        } catch (error) {
            console.error(`Failed to read directory ${dir}:`, error);
        }

        return prompts;
    }
}
