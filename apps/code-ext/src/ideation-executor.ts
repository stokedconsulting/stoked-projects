import { IdeationContext } from './category-prompt-manager';

/**
 * Parsed idea structure from Claude's ideation response
 */
export interface ParsedIdea {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  technicalApproach: string;
  effortHours: number;
  category: string;
}

/**
 * Result of ideation execution
 */
export interface IdeationResult {
  success: boolean;
  idea?: ParsedIdea;
  noIdeaAvailable?: boolean;
  validationError?: string;
  parseError?: string;
}

/**
 * Result of idea validation
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Execute ideation for a given category
 *
 * @deprecated Ideation execution is now handled by IdeationAgent in @stoked-projects/agent.
 * This function is retained for backward compatibility and returns a not-available result.
 * Use AgentOrchestrator from @stoked-projects/agent for real ideation execution.
 *
 * @param category - The category to generate ideas for
 * @param context - The ideation context with repo info
 * @param existingIssues - List of existing issue titles for duplicate detection
 * @returns Promise resolving to IdeationResult
 */
export async function executeIdeation(
  category: string,
  context: IdeationContext,
  existingIssues: string[] = []
): Promise<IdeationResult> {
  // Ideation now handled by @stoked-projects/agent IdeationAgent
  // This function is retained for backward compatibility
  return {
    success: false,
    parseError: 'Ideation execution deprecated: use AgentOrchestrator from @stoked-projects/agent'
  };
}

/**
 * Parse Claude's ideation response into structured data
 *
 * Expected format:
 * **Title:** <title>
 * **Description:** <description>
 * **Acceptance Criteria:**
 * - AC-1: <criterion>
 * - AC-2: <criterion>
 * **Technical Approach:** <approach>
 * **Estimated Effort:** <hours> hours
 *
 * @param response - Raw response from Claude
 * @returns ParsedIdea or null if parsing fails
 */
export function parseIdeationResponse(response: string): ParsedIdea | null {
  try {
    // Extract title
    const titleMatch = response.match(/\*\*Title:\*\*\s*(.+)/);
    if (!titleMatch) {
      return null;
    }
    const title = titleMatch[1].trim();

    // Extract description
    const descMatch = response.match(/\*\*Description:\*\*\s*([^\*]+)/s);
    if (!descMatch) {
      return null;
    }
    const description = descMatch[1].trim();

    // Extract acceptance criteria
    const acceptanceCriteria: string[] = [];
    const acSection = response.match(/\*\*Acceptance Criteria:\*\*\s*([\s\S]*?)(?:\*\*|$)/);

    if (acSection) {
      const acLines = acSection[1].split('\n');
      for (const line of acLines) {
        const trimmed = line.trim();
        // Match lines starting with "- AC-", "- [ ]", or just "- "
        if (trimmed.match(/^-\s*(AC-\d+:|(\[\s*\]))/)) {
          acceptanceCriteria.push(trimmed.replace(/^-\s*(AC-\d+:|\[\s*\])\s*/, '').trim());
        } else if (trimmed.startsWith('- ') && !trimmed.includes('**')) {
          acceptanceCriteria.push(trimmed.substring(2).trim());
        }
      }
    }

    if (acceptanceCriteria.length === 0) {
      return null;
    }

    // Extract technical approach
    const techMatch = response.match(/\*\*Technical Approach:\*\*\s*([^\*]+)/s);
    if (!techMatch) {
      return null;
    }
    const technicalApproach = techMatch[1].trim();

    // Extract effort estimate
    const effortMatch = response.match(/\*\*Estimated Effort:\*\*\s*(\d+)\s*hours?/i);
    if (!effortMatch) {
      return null;
    }
    const effortHours = parseInt(effortMatch[1], 10);

    return {
      title,
      description,
      acceptanceCriteria,
      technicalApproach,
      effortHours,
      category: '' // Will be set by caller
    };

  } catch (error) {
    console.error('[IdeationExecutor] Parse error:', error);
    return null;
  }
}

/**
 * Validate a parsed idea against business rules
 *
 * Rules:
 * - Title must be present and < 100 characters
 * - Description must be 20-500 characters
 * - At least 3 acceptance criteria required
 * - Effort estimate must be 1-8 hours
 * - No duplicates (title similarity > 80%)
 *
 * @param idea - The parsed idea to validate
 * @param existingIssues - List of existing issue titles
 * @returns ValidationResult
 */
export async function validateIdea(
  idea: ParsedIdea,
  existingIssues: string[]
): Promise<ValidationResult> {
  // Validate title
  if (!idea.title || idea.title.length === 0) {
    return { valid: false, error: 'Title is required' };
  }

  if (idea.title.length > 100) {
    return { valid: false, error: 'Title must be less than 100 characters' };
  }

  // Validate description
  if (!idea.description || idea.description.length < 20) {
    return { valid: false, error: 'Description must be at least 20 characters' };
  }

  if (idea.description.length > 500) {
    return { valid: false, error: 'Description must be less than 500 characters' };
  }

  // Validate acceptance criteria
  if (idea.acceptanceCriteria.length < 3) {
    return {
      valid: false,
      error: `At least 3 acceptance criteria required (found ${idea.acceptanceCriteria.length})`
    };
  }

  // Validate effort estimate
  if (!isValidEffortEstimate(idea.effortHours)) {
    return {
      valid: false,
      error: `Effort estimate must be between 1-8 hours (got ${idea.effortHours})`
    };
  }

  // Check for duplicates
  const isDuplicate = await checkForDuplicates(idea.title, existingIssues);
  if (isDuplicate) {
    return {
      valid: false,
      error: 'Duplicate idea detected - similar issue already exists'
    };
  }

  return { valid: true };
}

/**
 * Check if a title is a duplicate of existing issues
 * Uses simple string similarity (> 80% match = duplicate)
 *
 * @param title - The title to check
 * @param existingIssues - List of existing issue titles
 * @returns Promise resolving to true if duplicate found
 */
export async function checkForDuplicates(
  title: string,
  existingIssues: string[]
): Promise<boolean> {
  const normalizedTitle = title.toLowerCase().trim();

  for (const existingTitle of existingIssues) {
    const normalizedExisting = existingTitle.toLowerCase().trim();
    const similarity = calculateStringSimilarity(normalizedTitle, normalizedExisting);

    if (similarity > 0.80) {
      console.log(
        `[IdeationExecutor] Duplicate detected: "${title}" is ${(similarity * 100).toFixed(1)}% similar to "${existingTitle}"`
      );
      return true;
    }
  }

  return false;
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns value between 0 (completely different) and 1 (identical)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Check if effort estimate is within valid range (1-8 hours)
 *
 * @param hours - Effort estimate in hours
 * @returns True if valid, false otherwise
 */
export function isValidEffortEstimate(hours: number): boolean {
  return hours >= 1 && hours <= 8;
}
