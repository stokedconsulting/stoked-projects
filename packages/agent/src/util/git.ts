/**
 * Async wrappers around the git CLI.
 *
 * ZERO vscode imports — pure Node.js with child_process and util.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

/**
 * Executes git with the given arguments in the given working directory.
 *
 * @param args  Arguments to pass to git (e.g. ['rev-parse', '--abbrev-ref', 'HEAD'])
 * @param cwd   Working directory for the git command
 * @returns     Trimmed stdout from the command
 * @throws      Error with stderr/message on non-zero exit
 */
export async function gitExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/**
 * Returns the name of the currently checked-out branch.
 *
 * @param cwd  Repository root (or any subdirectory within it)
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
  return gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/**
 * Returns an array of recent commit summaries (one-line format).
 *
 * @param cwd    Repository root (or any subdirectory within it)
 * @param count  Maximum number of commits to return (default: 20)
 */
export async function getRecentCommits(cwd: string, count = 20): Promise<string[]> {
  const output = await gitExec(
    ['log', `--max-count=${count}`, '--oneline', '--no-decorate'],
    cwd,
  );
  if (!output) {
    return [];
  }
  return output.split('\n').filter((line) => line.length > 0);
}

/**
 * Returns the fetch URL for the `origin` remote.
 *
 * @param cwd  Repository root (or any subdirectory within it)
 */
export async function getRemoteUrl(cwd: string): Promise<string> {
  return gitExec(['remote', 'get-url', 'origin'], cwd);
}
