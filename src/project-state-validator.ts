import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProjectItem {
    id: string;
    number: string;
    title: string;
    status: 'Todo' | 'In Progress' | 'Done' | string;
    phase: string;
    content?: {
        title: string;
        number?: number;
        state?: string;
    };
}

export interface ProjectPhase {
    name: string;
    status: 'Todo' | 'In Progress' | 'Done' | string;
    items: ProjectItem[];
    phaseNumber: number;
}

export interface ProjectState {
    projectNumber: number;
    phases: ProjectPhase[];
    completionPercentage: number;
    nextIncompleteItem?: ProjectItem;
    totalItems: number;
    completedItems: number;
}

export class ProjectStateValidator {
    /**
     * Fetch current state from GitHub using gh CLI
     */
    async fetchProjectState(projectNumber: number): Promise<ProjectState> {
        try {
            // Get project items using gh CLI
            const { stdout } = await execAsync(
                `gh project item-list --owner $(gh repo view --json owner -q .owner.login) --number ${projectNumber} --format json`
            );

            const data = JSON.parse(stdout);

            // Parse items and group by phase
            const items: ProjectItem[] = data.items?.map((item: any) => ({
                id: item.id,
                number: item.content?.number?.toString() || '',
                title: item.content?.title || 'Untitled',
                status: item.fieldValues?.Status || 'Todo',
                phase: this.extractPhase(item.content?.title || ''),
                content: item.content
            })) || [];

            // Group items by phase
            const phaseMap = new Map<string, ProjectItem[]>();
            items.forEach(item => {
                const phase = item.phase;
                if (!phaseMap.has(phase)) {
                    phaseMap.set(phase, []);
                }
                phaseMap.get(phase)!.push(item);
            });

            // Create phase objects
            const phases: ProjectPhase[] = Array.from(phaseMap.entries()).map(([name, items], index) => {
                const doneCount = items.filter(i => i.status === 'Done').length;
                const inProgressCount = items.filter(i => i.status === 'In Progress').length;

                let phaseStatus: string = 'Todo';
                if (doneCount === items.length) {
                    phaseStatus = 'Done';
                } else if (inProgressCount > 0 || doneCount > 0) {
                    phaseStatus = 'In Progress';
                }

                return {
                    name,
                    status: phaseStatus,
                    items,
                    phaseNumber: index + 1
                };
            });

            // Calculate completion
            const totalItems = items.length;
            const completedItems = items.filter(i => i.status === 'Done').length;
            const completionPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

            // Find next incomplete item
            const nextIncompleteItem = this.findNextItem({
                projectNumber,
                phases,
                completionPercentage,
                totalItems,
                completedItems
            });

            return {
                projectNumber,
                phases,
                completionPercentage,
                nextIncompleteItem,
                totalItems,
                completedItems
            };
        } catch (error) {
            console.error('Error fetching project state:', error);
            throw new Error(`Failed to fetch project state: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Extract phase name from item title
     * Assumes format like "Phase 1: Name" or "(Phase 1.1) Title"
     */
    private extractPhase(title: string): string {
        // Try to match "Phase N" or "Phase N.M"
        const phaseMatch = title.match(/Phase\s+(\d+(?:\.\d+)?)/i);
        if (phaseMatch) {
            return `Phase ${phaseMatch[1]}`;
        }

        // Try to match "(N.M)" at start
        const numberMatch = title.match(/^\((\d+)\.(\d+)\)/);
        if (numberMatch) {
            return `Phase ${numberMatch[1]}`;
        }

        return 'Uncategorized';
    }

    /**
     * Validate if "In Progress" items are actually complete
     * This checks the actual state vs. the GitHub status
     */
    async validateInProgressItems(items: ProjectItem[]): Promise<Map<string, boolean>> {
        const validationResults = new Map<string, boolean>();

        for (const item of items) {
            if (item.status !== 'In Progress') {
                continue;
            }

            // For now, we trust the GitHub status
            // In a more advanced implementation, we could:
            // - Check if files mentioned in the item exist
            // - Run tests to verify completion
            // - Check git commits for related work
            validationResults.set(item.id, false); // Assume incomplete
        }

        return validationResults;
    }

    /**
     * Find the next item that should be worked on
     * Prioritizes: In Progress items first, then first Todo item
     */
    findNextItem(state: ProjectState): ProjectItem | undefined {
        // First, check for "In Progress" items
        for (const phase of state.phases) {
            const inProgressItem = phase.items.find(i => i.status === 'In Progress');
            if (inProgressItem) {
                return inProgressItem;
            }
        }

        // Then, find first "Todo" item
        for (const phase of state.phases) {
            const todoItem = phase.items.find(i => i.status === 'Todo' || i.status === '');
            if (todoItem) {
                return todoItem;
            }
        }

        return undefined; // All items complete
    }

    /**
     * Format project state as a readable string
     */
    formatProjectState(state: ProjectState): string {
        let output = `📊 Project #${state.projectNumber} Current State\n\n`;
        output += `**Progress:** ${state.completedItems}/${state.totalItems} items (${state.completionPercentage}%)\n\n`;

        for (const phase of state.phases) {
            const statusIcon = phase.status === 'Done' ? '✓' : phase.status === 'In Progress' ? '⏳' : '○';
            output += `**${phase.name}:** ${phase.status} ${statusIcon}\n`;

            for (const item of phase.items) {
                const itemIcon = item.status === 'Done' ? '✓' : item.status === 'In Progress' ? '⏳' : '○';
                const isNext = state.nextIncompleteItem?.id === item.id ? ' ← NEXT' : '';
                output += `- ${item.title}: ${item.status} ${itemIcon}${isNext}\n`;
            }
            output += '\n';
        }

        if (state.nextIncompleteItem) {
            output += `**Next Action:** Resume work on "${state.nextIncompleteItem.title}"\n`;
        } else {
            output += `**Status:** All items complete! 🎉\n`;
        }

        return output;
    }
}
