/**
 * Ideation agent for the autonomous agent loop.
 *
 * Calls the Claude Agent SDK to analyze the codebase and generate a single
 * new improvement idea in a structured ParsedIdea format.
 *
 * ZERO vscode imports — pure Node.js / SDK usage only.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

import { IdeationOutcome, OrchestratorConfig, ParsedIdea } from './types';

// ---------------------------------------------------------------------------
// Duplicate detection helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `title` has > 80% word overlap with any entry in
 * `existingTitles` (case-insensitive comparison on alphabetic word tokens).
 */
export function checkDuplicate(title: string, existingTitles: string[]): boolean {
  const normalize = (t: string): Set<string> => {
    const words = t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return new Set(words);
  };

  const candidateWords = normalize(title);
  if (candidateWords.size === 0) {
    return false;
  }

  for (const existing of existingTitles) {
    const existingWords = normalize(existing);
    if (existingWords.size === 0) {
      continue;
    }

    // Count words in candidate that also appear in existing
    let overlapCount = 0;
    for (const word of candidateWords) {
      if (existingWords.has(word)) {
        overlapCount++;
      }
    }

    // Use the smaller set as the denominator so short-title matches are caught
    const smaller = Math.min(candidateWords.size, existingWords.size);
    const overlapRatio = overlapCount / smaller;

    if (overlapRatio > 0.8) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// IdeationAgent class
// ---------------------------------------------------------------------------

/**
 * Runs a Claude session that reads the codebase (read-only) and produces a
 * single structured improvement idea for the given category.
 *
 * Usage:
 * ```ts
 * const agent = new IdeationAgent(config);
 * const outcome = await agent.ideate('testing', prompt, existingTitles, abortController);
 * ```
 */
export class IdeationAgent {
  private readonly _config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this._config = config;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Runs the ideation session and returns an IdeationOutcome.
   *
   * Steps:
   * 1. Builds the ideation prompt embedding the category, caller-supplied
   *    context prompt, and the list of existing issue titles.
   * 2. Calls `query()` with read-only tools and bypassPermissions mode.
   * 3. Parses and validates the response as a ParsedIdea JSON object, or
   *    handles the sentinel NO_IDEA_AVAILABLE string.
   * 4. Checks for duplicates against existingIssueTitles.
   *
   * All errors are caught and returned as an IdeationOutcome with a null idea.
   */
  async ideate(
    category: string,
    prompt: string,
    existingIssueTitles: string[],
    abortController: AbortController,
  ): Promise<IdeationOutcome> {
    const ideationPrompt = this._buildPrompt(category, prompt, existingIssueTitles);

    try {
      const sdkQuery = query({
        prompt: ideationPrompt,
        options: {
          allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
          cwd: this._config.workspaceRoot,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxBudgetUsd: this._config.maxBudgetPerIdeationUsd ?? 2.0,
          maxTurns: 30,
          abortController,
          persistSession: false,
        },
      });

      let resultText: string | null = null;

      for await (const message of sdkQuery) {
        if (message.type === 'result' && message.subtype === 'success') {
          resultText = message.result;
        }
      }

      if (resultText === null) {
        console.warn('[IdeationAgent] No result message received from SDK query');
        return { idea: null, noIdeaAvailable: false, category };
      }

      return this._parseResult(resultText, category, existingIssueTitles);
    } catch (err) {
      console.error('[IdeationAgent] SDK query failed:', err);
      return { idea: null, noIdeaAvailable: false, category };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the full ideation prompt string from the provided arguments.
   */
  private _buildPrompt(
    category: string,
    prompt: string,
    existingIssueTitles: string[],
  ): string {
    const existingList =
      existingIssueTitles.length > 0
        ? existingIssueTitles.map((t) => `- ${t}`).join('\n')
        : '(none)';

    return `You are an ideation agent for the category "${category}".

${prompt}

## Existing Issues (do not duplicate)
${existingList}

## Instructions
Analyze the codebase and generate ONE new improvement idea.
If no valuable improvement exists, respond with exactly: NO_IDEA_AVAILABLE

Otherwise respond with a JSON object (no markdown fences):
{
  "title": "Brief title under 100 chars",
  "description": "20-500 char description",
  "acceptanceCriteria": ["AC-1", "AC-2", "AC-3"],
  "technicalApproach": "How to implement",
  "effortHours": 1-8,
  "category": "${category}"
}`;
  }

  /**
   * Parses the raw result string from the SDK into an IdeationOutcome.
   *
   * Handles:
   * - NO_IDEA_AVAILABLE sentinel
   * - Markdown code fences (```json ... ``` or ``` ... ```)
   * - Raw JSON objects
   * - Validation of required fields and value ranges
   * - Duplicate detection against existing titles
   */
  private _parseResult(
    resultText: string,
    category: string,
    existingIssueTitles: string[],
  ): IdeationOutcome {
    const trimmed = resultText.trim();

    // Sentinel check
    if (trimmed.includes('NO_IDEA_AVAILABLE')) {
      return { idea: null, noIdeaAvailable: true, category };
    }

    // Strip markdown code fences if present
    const stripped = this._stripCodeFences(trimmed);

    // Attempt JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      // Try to extract the first JSON object from the text as a fallback
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          console.warn('[IdeationAgent] Failed to parse JSON from result:', err);
          return { idea: null, noIdeaAvailable: false, category };
        }
      } else {
        console.warn('[IdeationAgent] No JSON object found in result');
        return { idea: null, noIdeaAvailable: false, category };
      }
    }

    // Validate shape
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[IdeationAgent] Parsed value is not a JSON object');
      return { idea: null, noIdeaAvailable: false, category };
    }

    const raw = parsed as Record<string, unknown>;

    // Field-level validation
    if (!this._isValidIdea(raw)) {
      return { idea: null, noIdeaAvailable: false, category };
    }

    const idea: ParsedIdea = {
      title: raw.title as string,
      description: raw.description as string,
      acceptanceCriteria: raw.acceptanceCriteria as string[],
      technicalApproach: raw.technicalApproach as string,
      effortHours: raw.effortHours as number,
      category: typeof raw.category === 'string' ? raw.category : category,
    };

    // Duplicate check
    if (checkDuplicate(idea.title, existingIssueTitles)) {
      console.warn(
        `[IdeationAgent] Duplicate idea detected (>80% word overlap): "${idea.title}"`,
      );
      return { idea: null, noIdeaAvailable: false, category };
    }

    return { idea, noIdeaAvailable: false, category };
  }

  /**
   * Removes markdown code fences from a string.
   *
   * Handles both ` ```json ... ``` ` and ` ``` ... ``` ` variants.
   */
  private _stripCodeFences(text: string): string {
    // Match ```[lang]\n...content...\n```
    const fenceMatch = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // Match inline ``` fences without newlines after opening
    const inlineFenceMatch = text.match(/^```(?:\w+)?\s*([\s\S]*?)```\s*$/);
    if (inlineFenceMatch) {
      return inlineFenceMatch[1].trim();
    }

    return text;
  }

  /**
   * Validates the parsed object has all required fields with correct types and
   * value ranges for a ParsedIdea.
   *
   * Rules:
   * - title: string, 1–99 chars
   * - description: string, 20–500 chars
   * - acceptanceCriteria: string[], length >= 3
   * - technicalApproach: non-empty string
   * - effortHours: number, integer-ish, 1–8 inclusive
   */
  private _isValidIdea(raw: Record<string, unknown>): boolean {
    // title
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
      console.warn('[IdeationAgent] Validation failed: title missing or empty');
      return false;
    }
    if (raw.title.length >= 100) {
      console.warn('[IdeationAgent] Validation failed: title >= 100 chars');
      return false;
    }

    // description
    if (typeof raw.description !== 'string') {
      console.warn('[IdeationAgent] Validation failed: description not a string');
      return false;
    }
    if (raw.description.length < 20 || raw.description.length > 500) {
      console.warn(
        `[IdeationAgent] Validation failed: description length ${raw.description.length} outside 20-500 range`,
      );
      return false;
    }

    // acceptanceCriteria
    if (!Array.isArray(raw.acceptanceCriteria)) {
      console.warn('[IdeationAgent] Validation failed: acceptanceCriteria not an array');
      return false;
    }
    if (raw.acceptanceCriteria.length < 3) {
      console.warn(
        `[IdeationAgent] Validation failed: only ${raw.acceptanceCriteria.length} acceptance criteria (need >= 3)`,
      );
      return false;
    }
    if (!raw.acceptanceCriteria.every((c) => typeof c === 'string')) {
      console.warn('[IdeationAgent] Validation failed: acceptance criteria contain non-strings');
      return false;
    }

    // technicalApproach
    if (
      typeof raw.technicalApproach !== 'string' ||
      raw.technicalApproach.trim().length === 0
    ) {
      console.warn('[IdeationAgent] Validation failed: technicalApproach missing or empty');
      return false;
    }

    // effortHours
    if (typeof raw.effortHours !== 'number' || !isFinite(raw.effortHours)) {
      console.warn('[IdeationAgent] Validation failed: effortHours not a finite number');
      return false;
    }
    if (raw.effortHours < 1 || raw.effortHours > 8) {
      console.warn(
        `[IdeationAgent] Validation failed: effortHours ${raw.effortHours} outside 1-8 range`,
      );
      return false;
    }

    return true;
  }
}
