/**
 * Template substitution engine for category prompt files.
 *
 * ZERO vscode imports — pure Node.js with no external dependencies.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Runtime context variables available for substitution in prompt templates.
 */
export interface TemplateContext {
  owner: string;
  repo: string;
  recentCommits: string[];
  techStack: string[];
  existingIssueCount: number;
}

// ---------------------------------------------------------------------------
// TemplateSubstitution class
// ---------------------------------------------------------------------------

/**
 * Loads prompt templates from disk and substitutes `{{variable}}` placeholders
 * with live context gathered from the workspace.
 *
 * Supported placeholders:
 * - `{{owner}}`            – GitHub organisation / user
 * - `{{repo}}`             – GitHub repository name
 * - `{{recentCommits}}`    – newline-joined list of recent commits
 * - `{{techStack}}`        – comma-joined list of detected packages
 * - `{{existingIssueCount}}` – number of open GitHub issues
 *
 * Unknown placeholders are left in place and a warning is emitted to stderr.
 */
export class TemplateSubstitution {
  // ---------------------------------------------------------------------------
  // Substitution
  // ---------------------------------------------------------------------------

  /**
   * Replaces all `{{variable}}` placeholders in `template` using the supplied
   * `context`.  Unknown placeholders are preserved verbatim and a warning is
   * printed to `console.warn`.
   */
  substitute(template: string, context: TemplateContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      switch (key) {
        case 'owner':
          return context.owner;
        case 'repo':
          return context.repo;
        case 'recentCommits':
          return context.recentCommits.join('\n');
        case 'techStack':
          return context.techStack.join(', ');
        case 'existingIssueCount':
          return String(context.existingIssueCount);
        default:
          console.warn(
            `[TemplateSubstitution] Unknown placeholder '{{${key}}}' — leaving in place`,
          );
          return _match;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Context building
  // ---------------------------------------------------------------------------

  /**
   * Gathers live context from the workspace:
   * - Recent commits via `git log --oneline -20`
   * - Tech stack from `package.json` dependency keys
   * - Open issue count from the GitHub REST API
   */
  async buildContext(
    workspaceRoot: string,
    owner: string,
    repo: string,
    githubToken: string,
  ): Promise<TemplateContext> {
    const [recentCommits, techStack, existingIssueCount] = await Promise.all([
      this._getRecentCommits(workspaceRoot),
      this._getTechStack(workspaceRoot),
      this._getIssueCount(owner, repo, githubToken),
    ]);

    return { owner, repo, recentCommits, techStack, existingIssueCount };
  }

  // ---------------------------------------------------------------------------
  // Load + substitute
  // ---------------------------------------------------------------------------

  /**
   * Reads `{categoryPromptsDir}/{category}.md` from disk and applies
   * `substitute()` with the provided context.
   */
  async loadAndSubstitute(
    categoryPromptsDir: string,
    category: string,
    context: TemplateContext,
  ): Promise<string> {
    const filePath = join(categoryPromptsDir, `${category}.md`);
    const raw = await readFile(filePath, 'utf-8');
    return this.substitute(raw, context);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the last 20 commits as oneline strings, or an empty array if git
   * is unavailable or the directory is not a repository.
   */
  private async _getRecentCommits(workspaceRoot: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-20'],
        { cwd: workspaceRoot },
      );
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (err) {
      console.warn('[TemplateSubstitution] Failed to read git log:', err);
      return [];
    }
  }

  /**
   * Reads `package.json` in the workspace root and returns a deduplicated,
   * sorted list of dependency names (dependencies + devDependencies).
   * Falls back to an empty array on any error.
   */
  private async _getTechStack(workspaceRoot: string): Promise<string[]> {
    try {
      const pkgPath = join(workspaceRoot, 'package.json');
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const deps = Object.keys(pkg.dependencies ?? {});
      const devDeps = Object.keys(pkg.devDependencies ?? {});

      // Deduplicate and sort for stable output
      const all = Array.from(new Set([...deps, ...devDeps])).sort();
      return all;
    } catch (err) {
      console.warn('[TemplateSubstitution] Failed to read package.json:', err);
      return [];
    }
  }

  /**
   * Queries the GitHub REST API for the number of open issues.
   * Returns 0 on any network or API error.
   *
   * The request fetches a single item with `per_page=1` and reads the total
   * count from the response body length as a proxy.  Because the REST API does
   * not expose a dedicated issue count endpoint we fall back to reading the
   * full open-issues array length from a lightweight query.
   */
  private async _getIssueCount(
    owner: string,
    repo: string,
    githubToken: string,
  ): Promise<number> {
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=1`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'stoked-projects-agent',
        },
      });

      if (!response.ok) {
        console.warn(
          `[TemplateSubstitution] GitHub API returned ${response.status} for issue count — using 0`,
        );
        return 0;
      }

      // The `Link` header contains the last page number which encodes total count.
      // Pattern: <...?page=N>; rel="last"
      const linkHeader = response.headers.get('link') ?? '';
      const lastPageMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (lastPageMatch) {
        return parseInt(lastPageMatch[1], 10);
      }

      // No Link header means all results fit on a single page — count body items.
      const items = (await response.json()) as unknown[];
      return Array.isArray(items) ? items.length : 0;
    } catch (err) {
      console.warn('[TemplateSubstitution] Failed to fetch issue count:', err);
      return 0;
    }
  }
}
