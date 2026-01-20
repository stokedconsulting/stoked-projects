
import { ProjectItem } from './github-api';

export interface PhaseInfo {
    phaseName: string;
    phaseNumber: number;
    isMaster: boolean;
    allItems: ProjectItem[];
    workItems: ProjectItem[];
    masterItem: ProjectItem | null;
}

/**
 * Detect if an item is a phase master
 * Supports multiple formats:
 * - [Phase N] at the start of title (e.g., "[Phase 0] Terraform Migration")
 * - (Phase N) at the start of title (e.g., "(Phase 0) Terraform Migration")
 * - Phase N: at the start of title (e.g., "Phase 1: Version Detection - MASTER")
 * - MASTER keyword (legacy support)
 * Work items use [PN-WX], (Phase N.M), or [PN.M] format and are NOT masters
 */
export function isPhaseMaster(title: string): boolean {
    if (!title) return false;

    // Check for work item format [PN-WX] (e.g., [P0-W1]) - these are NOT masters
    const isWorkItemBracket = /\[P\d+-W\d+\]/i.test(title);
    if (isWorkItemBracket) {
        return false;
    }

    // Check for decimal phase patterns - these are work items, NOT masters
    // Matches: (Phase 1.1), [Phase 1.1], (1.1), [P1.1], Phase 1.1 (without MASTER)
    const hasDecimalPhase = /[\[(]?(?:Phase\s*)?\d+\.\d+[\])]?/i.test(title);
    if (hasDecimalPhase && !/MASTER/i.test(title)) {
        return false;
    }

    // Check for [Phase N] format at the start - these ARE masters
    const hasSquareBracketPhase = /^\[Phase\s+\d+\]/i.test(title);
    if (hasSquareBracketPhase) {
        return true;
    }

    // Check for (Phase N) format at the start (parentheses) - these ARE masters
    const hasParenPhase = /^\(Phase\s+\d+\)/i.test(title);
    if (hasParenPhase) {
        return true;
    }

    // Check for "Phase N:" format at the start - these ARE masters
    const hasColonPhase = /^Phase\s+\d+\s*:/i.test(title);
    if (hasColonPhase) {
        return true;
    }

    // Legacy support: MASTER keyword
    const hasMaster = /MASTER/i.test(title);
    if (hasMaster) {
        return true;
    }

    return false;
}

/**
 * Extract phase name and number from item
 * Supports multiple formats:
 * - [Phase N] format (e.g., "[Phase 0] Title")
 * - (Phase N) format (e.g., "(Phase 0) Title")
 * - Phase N: format (e.g., "Phase 1: Title")
 * - [PN-WX] format (e.g., "[P0-W1] Title" = Phase 0, Work Item 1)
 * - (Phase N.M) format (e.g., "(Phase 1.1) Title" = Phase 1)
 * - [PN.M] format (e.g., "[P1.1] Title" = Phase 1)
 * - (N.M) shorthand format (e.g., "(1.1) Title" = Phase 1)
 * - Phase field with "Phase N" value
 * - Title containing "Phase N" text
 */
export function extractPhaseInfo(item: ProjectItem): { name: string; number: number } | null {
    const title = item.content?.title || '';

    // Check for [Phase N] format at the start (phase master format)
    const squareBracketPhaseMatch = title.match(/^\[Phase\s+(\d+)\]/i);
    if (squareBracketPhaseMatch) {
        return {
            name: `Phase ${squareBracketPhaseMatch[1]}`,
            number: parseInt(squareBracketPhaseMatch[1], 10),
        };
    }

    // Check for (Phase N) format at the start (phase master format)
    const parenPhaseMatch = title.match(/^\(Phase\s+(\d+)\)/i);
    if (parenPhaseMatch) {
        return {
            name: `Phase ${parenPhaseMatch[1]}`,
            number: parseInt(parenPhaseMatch[1], 10),
        };
    }

    // Check for "Phase N:" format at the start (e.g., "Phase 1: Title - MASTER")
    const colonPhaseMatch = title.match(/^Phase\s+(\d+)\s*:/i);
    if (colonPhaseMatch) {
        return {
            name: `Phase ${colonPhaseMatch[1]}`,
            number: parseInt(colonPhaseMatch[1], 10),
        };
    }

    // Check for [PN-WX] work item format (e.g., [P0-W1] = Phase 0, Work Item 1)
    const workItemBracketMatch = title.match(/^\[P(\d+)-W\d+\]/i);
    if (workItemBracketMatch) {
        return {
            name: `Phase ${workItemBracketMatch[1]}`,
            number: parseInt(workItemBracketMatch[1], 10),
        };
    }

    // Check for (Phase N.M) work item format (e.g., (Phase 1.1) = Phase 1)
    const parenDecimalMatch = title.match(/^\(Phase\s+(\d+)\.\d+\)/i);
    if (parenDecimalMatch) {
        return {
            name: `Phase ${parenDecimalMatch[1]}`,
            number: parseInt(parenDecimalMatch[1], 10),
        };
    }

    // Check for [PN.M] format (e.g., [P1.1] = Phase 1)
    const bracketDecimalMatch = title.match(/^\[P(\d+)\.\d+\]/i);
    if (bracketDecimalMatch) {
        return {
            name: `Phase ${bracketDecimalMatch[1]}`,
            number: parseInt(bracketDecimalMatch[1], 10),
        };
    }

    // Check for (N.M) shorthand format (e.g., (1.1) = Phase 1)
    const shorthandDecimalMatch = title.match(/^\((\d+)\.\d+\)/i);
    if (shorthandDecimalMatch) {
        return {
            name: `Phase ${shorthandDecimalMatch[1]}`,
            number: parseInt(shorthandDecimalMatch[1], 10),
        };
    }

    // Try Phase field from project fields
    const phaseField = item.fieldValues['Phase'] || item.fieldValues['Epic'];
    if (phaseField) {
        const match = phaseField.match(/Phase\s+(\d+)/i);
        if (match) {
            return {
                name: phaseField,
                number: parseInt(match[1], 10),
            };
        }
    }

    // Fallback: Title pattern matching for "Phase N" anywhere in title
    if (title) {
        const titleMatch = title.match(/\bPhase\s+(\d+)/i);
        if (titleMatch) {
            return {
                name: `Phase ${titleMatch[1]}`,
                number: parseInt(titleMatch[1], 10),
            };
        }
    }

    return null;
}

/**
 * Extract the clean title from a phase master item
 * Removes phase prefixes like "[Phase 1]", "(Phase 1)", "Phase 1:"
 */
export function extractMasterTitle(title: string): string {
    if (!title) return '';

    // Remove [Phase N] prefix
    let cleaned = title.replace(/^\[Phase\s+\d+\]\s*/i, '');
    // Remove (Phase N) prefix
    cleaned = cleaned.replace(/^\(Phase\s+\d+\)\s*/i, '');
    // Remove Phase N: prefix
    cleaned = cleaned.replace(/^Phase\s+\d+\s*:\s*/i, '');
    // Remove trailing " - MASTER" or "- MASTER"
    cleaned = cleaned.replace(/\s*-?\s*MASTER\s*$/i, '');

    return cleaned.trim();
}

/**
 * Check if an item has an explicit master indicator (MASTER keyword or Epic: prefix)
 */
function hasExplicitMasterIndicator(title: string): boolean {
    return /MASTER/i.test(title) || /^Epic:/i.test(title);
}

/**
 * Group all items by phase
 * 
 * When multiple items look like phase masters (e.g., all have [Phase N] format),
 * we need to determine which one is the ACTUAL master and treat others as work items.
 * Priority:
 * 1. Item with explicit "MASTER" keyword in title
 * 2. Item with "Epic:" prefix
 * 3. First item encountered (fallback)
 */
export function groupItemsByPhase(items: ProjectItem[]): Map<string, PhaseInfo> {
    const phaseMap = new Map<string, PhaseInfo>();
    // Track items that look like phase masters for each phase, to resolve later
    const masterCandidates = new Map<string, ProjectItem[]>();

    // First pass: group all items by phase
    for (const item of items) {
        const phaseInfo = extractPhaseInfo(item);
        if (!phaseInfo) continue;

        const { name, number } = phaseInfo;

        if (!phaseMap.has(name)) {
            phaseMap.set(name, {
                phaseName: name,
                phaseNumber: number,
                isMaster: false,
                allItems: [],
                workItems: [],
                masterItem: null,
            });
            masterCandidates.set(name, []);
        }

        const phase = phaseMap.get(name)!;
        phase.allItems.push(item);

        const title = item.content?.title || '';

        if (isPhaseMaster(title)) {
            // Track as a master candidate for now, we'll resolve later
            masterCandidates.get(name)!.push(item);
        } else {
            // Definitely a work item
            phase.workItems.push(item);
        }
    }

    // Second pass: resolve master candidates
    // When multiple items look like masters, pick the best one and demote others to work items
    for (const [phaseName, candidates] of masterCandidates) {
        const phase = phaseMap.get(phaseName)!;

        if (candidates.length === 0) {
            continue;
        }

        if (candidates.length === 1) {
            // Only one candidate, it becomes the master
            phase.masterItem = candidates[0];
            phase.isMaster = true;
        } else {
            // Multiple candidates - find the best one
            // Priority: MASTER keyword > Epic: prefix > first encountered
            let bestMaster: ProjectItem | null = null;

            for (const candidate of candidates) {
                const title = candidate.content?.title || '';
                if (hasExplicitMasterIndicator(title)) {
                    bestMaster = candidate;
                    break; // MASTER or Epic: takes priority
                }
            }

            // Fallback to first candidate if no explicit indicator found
            if (!bestMaster) {
                bestMaster = candidates[0];
            }

            // Set the master and demote others to work items
            phase.masterItem = bestMaster;
            phase.isMaster = true;

            for (const candidate of candidates) {
                if (candidate !== bestMaster) {
                    phase.workItems.push(candidate);
                }
            }
        }
    }

    return phaseMap;
}

export function calculatePhaseStatus(phase: PhaseInfo): string | null {
    if (!phase.masterItem || phase.workItems.length === 0) return null;

    const allDone = phase.workItems.every(i => {
        const status = i.fieldValues['Status'];
        return ['Done', 'Merged', 'Closed'].includes(status || '');
    });

    if (allDone) return 'Done';

    const anyInProgress = phase.workItems.some(i => {
        const status = i.fieldValues['Status'];
        return ['In Progress', 'Active'].includes(status || '');
    });

    if (anyInProgress) return 'In Progress';

    // Default: if items are Todo, Master stays whatever it is (usually Todo or In Progress)
    // Maybe we want to set it to In Progress if at least one item is done?
    // For now, let's just handle the "Done" case which is the most useful automation.
    return null;
}
