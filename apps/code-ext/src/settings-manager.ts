import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export type LlmProvider = 'claudeCode' | 'codex' | 'bonsai';

export interface ProjectSettings {
    llmProvider: LlmProvider;
    env: {
        BONSAI_API_KEY?: string;
    };
}

const DEFAULT_SETTINGS: ProjectSettings = {
    llmProvider: 'claudeCode',
    env: {},
};

export class SettingsManager {
    private globalDir: string;
    private globalFile: string;
    private workspaceFile: string;

    constructor(private workspaceRoot: string) {
        this.globalDir = path.join(os.homedir(), '.stoked-projects');
        this.globalFile = path.join(this.globalDir, 'settings.json');
        this.workspaceFile = path.join(workspaceRoot, '.stoked-projects', 'settings.json');
    }

    /**
     * Read settings with workspace overriding global, falling back to defaults.
     */
    getSettings(): ProjectSettings {
        const global = this.readFile(this.globalFile);
        const workspace = this.readFile(this.workspaceFile);
        return this.deepMerge(DEFAULT_SETTINGS, global, workspace);
    }

    /**
     * Deep-merge partial settings into the global settings file.
     */
    updateGlobal(partial: Partial<ProjectSettings>): void {
        const existing = this.readFile(this.globalFile);
        const merged = this.deepMerge(existing, partial);
        this.writeFile(this.globalFile, merged);
    }

    /**
     * Deep-merge partial settings into the workspace settings file.
     */
    updateWorkspace(partial: Partial<ProjectSettings>): void {
        const existing = this.readFile(this.workspaceFile);
        const merged = this.deepMerge(existing, partial);
        const dir = path.dirname(this.workspaceFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.writeFile(this.workspaceFile, merged);
    }

    private readFile(filePath: string): Record<string, any> {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(raw);
            }
        } catch {
            // Corrupt or unreadable — treat as empty
        }
        return {};
    }

    private writeFile(filePath: string, data: Record<string, any>): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    private deepMerge(...objects: Record<string, any>[]): any {
        const result: Record<string, any> = {};
        for (const obj of objects) {
            for (const key of Object.keys(obj)) {
                if (
                    obj[key] !== null &&
                    typeof obj[key] === 'object' &&
                    !Array.isArray(obj[key]) &&
                    result[key] !== null &&
                    typeof result[key] === 'object' &&
                    !Array.isArray(result[key])
                ) {
                    result[key] = this.deepMerge(result[key], obj[key]);
                } else {
                    result[key] = obj[key];
                }
            }
        }
        return result;
    }
}

export interface BuildLLMCommandOptions {
    prompt: string;
    wrapperScript?: string;
    sessionFile?: string;
    settings: ProjectSettings;
}

/**
 * Build the terminal command string for the selected LLM provider.
 */
export function buildLLMCommand(options: BuildLLMCommandOptions): string {
    const { prompt, wrapperScript, sessionFile, settings } = options;
    const provider = settings.llmProvider;

    switch (provider) {
        case 'codex':
            return `codex exec --dangerously-bypass-approvals-and-sandbox "${prompt}"`;

        case 'bonsai': {
            const key = settings.env.BONSAI_API_KEY || '';
            const envPrefix = `ANTHROPIC_BASE_URL=https://go.trybons.ai ANTHROPIC_AUTH_TOKEN=${key}`;
            if (wrapperScript && sessionFile) {
                return `${envPrefix} "${wrapperScript}" "${sessionFile}" --dangerously-skip-permissions "${prompt}"`;
            }
            return `${envPrefix} claude --dangerously-skip-permissions "${prompt}"`;
        }

        case 'claudeCode':
        default:
            if (wrapperScript && sessionFile) {
                return `"${wrapperScript}" "${sessionFile}" --dangerously-skip-permissions "${prompt}"`;
            }
            return `claude --dangerously-skip-permissions "${prompt}"`;
    }
}
