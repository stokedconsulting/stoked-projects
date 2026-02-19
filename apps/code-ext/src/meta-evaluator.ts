import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Lock file management ───────────────────────────────────────────────────

const LOCK_FILENAME = ".meta-eval.lock";

interface LockInfo {
  pid: number;
  startedAt: string;
  hostname: string;
}

function getLockPath(metaDir: string): string {
  return path.join(metaDir, LOCK_FILENAME);
}

/**
 * Check if a PID is still alive.
 */
function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't kill — just checks existence
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to acquire the lock. Returns true if we got it, false if another
 * live process holds it.
 */
function acquireLock(metaDir: string): boolean {
  const lockPath = getLockPath(metaDir);

  // Check for existing lock
  if (fs.existsSync(lockPath)) {
    try {
      const raw = fs.readFileSync(lockPath, "utf-8");
      const info: LockInfo = JSON.parse(raw);

      if (info.hostname === os.hostname() && isPidAlive(info.pid)) {
        emit(`Lock held by PID ${info.pid} (started ${info.startedAt}) — skipping`);
        return false;
      }

      // Stale lock (PID dead or different host) — clean it up
      emit(`Removing stale lock (PID ${info.pid}, host ${info.hostname}, started ${info.startedAt})`);
    } catch {
      // Corrupt lock file — remove it
      emit("Removing corrupt lock file");
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Race condition — another process may have already removed it
    }
  }

  // Write our lock
  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
  };

  try {
    fs.writeFileSync(lockPath, JSON.stringify(info, null, 2), {
      flag: "wx", // exclusive create — fails if file already exists
    });
    return true;
  } catch {
    // Another process beat us to it
    emit("Lost lock race — another process acquired it first");
    return false;
  }
}

function releaseLock(metaDir: string): void {
  const lockPath = getLockPath(metaDir);
  try {
    // Only remove if it's still ours
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf-8");
      const info: LockInfo = JSON.parse(raw);
      if (info.pid === process.pid && info.hostname === os.hostname()) {
        fs.unlinkSync(lockPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

// ─── Workspace package definitions ──────────────────────────────────────────

interface WorkspacePackage {
  /** Relative path from workspace root (e.g. "apps/code-ext") */
  relativePath: string;
  /** Human-readable name */
  name: string;
  /** Tech stack for richer prompts */
  stack: string;
  /** Priority: critical | medium | low */
  priority: string;
}

const WORKSPACE_PACKAGES: WorkspacePackage[] = [
  {
    relativePath: "apps/code-ext",
    name: "VSCode Extension",
    stack: "TypeScript/Webpack/WebSocket/GraphQL",
    priority: "critical",
  },
  {
    relativePath: "apps/menu-bar",
    name: "Menu Bar App",
    stack: "scaffold",
    priority: "low",
  },
  {
    relativePath: "apps/osx-desktop-widget",
    name: "macOS Widget",
    stack: "Swift/SwiftUI/WidgetKit",
    priority: "medium",
  },
  {
    relativePath: "apps/slack-app",
    name: "Slack App",
    stack: "scaffold",
    priority: "medium",
  },
  {
    relativePath: "packages/api",
    name: "NestJS API",
    stack: "TypeScript/NestJS/Jest",
    priority: "critical",
  },
  {
    relativePath: "packages/mcp-server",
    name: "MCP Server",
    stack: "TypeScript/MCP SDK/Jest",
    priority: "critical",
  },
];

// ─── Constants ──────────────────────────────────────────────────────────────

const THROTTLE_KEY = "metaEval.lastRunTimestamp";
const THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours
const TEMP_DIR = "/tmp/stoked-projects-meta";

// ─── Core logic ─────────────────────────────────────────────────────────────

/** Module-level output channel, set via runMetaEvaluation */
let log: vscode.OutputChannel | undefined;

function emit(msg: string): void {
  const line = `[Meta Eval] ${msg}`;
  if (log) {
    log.appendLine(line);
  }
  console.log(line);
}

/**
 * Run meta evaluation: check for missing CP_OVERVIEW.md and CP_TEST.md files
 * in ~/.stoked-projects/meta/ and dispatch Claude tasks to generate them.
 *
 * This is a fire-and-forget function — it logs errors internally and never
 * throws to the caller.
 */
export async function runMetaEvaluation(
  context: vscode.ExtensionContext,
  outputChannel?: vscode.OutputChannel
): Promise<void> {
  log = outputChannel;

  emit("Starting meta evaluation...");

  // ── Throttle check ──────────────────────────────────────────────────
  const lastRun = context.globalState.get<number>(THROTTLE_KEY, 0);
  const elapsed = Date.now() - lastRun;
  const elapsedHrs = (elapsed / (1000 * 60 * 60)).toFixed(1);
  if (elapsed < THROTTLE_MS) {
    emit(`Skipping — last run was ${elapsedHrs}h ago (throttle: 24h)`);
    return;
  }
  emit(lastRun === 0
    ? "No previous run recorded — will proceed"
    : `Last run was ${elapsedHrs}h ago — throttle passed`);

  // ── Workspace detection ─────────────────────────────────────────────
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    emit("No workspace folder open — skipping");
    return;
  }
  const workspaceRoot = folders[0].uri.fsPath;
  emit(`Workspace root: ${workspaceRoot}`);

  // ── Ensure directories ──────────────────────────────────────────────
  const homeDir = os.homedir();
  const metaDir = path.join(homeDir, ".stoked-projects", "meta");
  emit(`Ensuring meta dir: ${metaDir}`);
  fs.mkdirSync(metaDir, { recursive: true });
  emit(`Ensuring temp dir: ${TEMP_DIR}`);
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // ── Acquire lock ────────────────────────────────────────────────────
  emit("Acquiring lock...");
  if (!acquireLock(metaDir)) {
    emit("Could not acquire lock — another process is running. Aborting.");
    return;
  }
  emit("Lock acquired (PID " + process.pid + ")");

  try {
    await runMetaEvaluationInner(context, workspaceRoot, metaDir);
  } catch (error) {
    emit(`ERROR in meta evaluation: ${error}`);
  } finally {
    releaseLock(metaDir);
    emit("Lock released");
  }
}

async function runMetaEvaluationInner(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  metaDir: string
): Promise<void> {
  let dispatched = 0;

  // ── Check 1: CP_OVERVIEW.md ─────────────────────────────────────────
  const overviewPath = path.join(metaDir, "CP_OVERVIEW.md");
  if (!fs.existsSync(overviewPath)) {
    emit(`CP_OVERVIEW.md missing at ${overviewPath} — dispatching generation task`);
    const prompt = buildOverviewPrompt(workspaceRoot);
    dispatchClaudeTask("Meta: Overview", workspaceRoot, prompt);
    dispatched++;
  } else {
    const stat = fs.statSync(overviewPath);
    emit(`CP_OVERVIEW.md exists (${(stat.size / 1024).toFixed(1)} KB, modified ${stat.mtime.toISOString()})`);
  }

  // ── Check 2: Root CP_TEST.md ────────────────────────────────────────
  const testTemplatePath = path.join(
    os.homedir(),
    ".stoked-projects",
    "test.md"
  );
  const hasTestTemplate = fs.existsSync(testTemplatePath);
  emit(`Test template (${testTemplatePath}): ${hasTestTemplate ? "found" : "not found"}`);

  const rootTestPath = path.join(metaDir, "CP_TEST.md");
  if (!fs.existsSync(rootTestPath)) {
    emit(`CP_TEST.md (root) missing at ${rootTestPath} — dispatching generation task`);
    const prompt = buildTestPrompt(
      workspaceRoot,
      "monorepo root",
      workspaceRoot,
      "Monorepo",
      "pnpm/TypeScript/Husky",
      "critical",
      hasTestTemplate,
      testTemplatePath
    );
    dispatchClaudeTask("Meta: Test (root)", workspaceRoot, prompt);
    dispatched++;
  } else {
    const stat = fs.statSync(rootTestPath);
    emit(`CP_TEST.md (root) exists (${(stat.size / 1024).toFixed(1)} KB, modified ${stat.mtime.toISOString()})`);
  }

  // ── Check 3: Per-package CP_TEST.md ─────────────────────────────────
  for (const pkg of WORKSPACE_PACKAGES) {
    const pkgAbsPath = path.join(workspaceRoot, pkg.relativePath);

    // Only check packages that actually exist on disk
    if (!fs.existsSync(pkgAbsPath)) {
      emit(`Package "${pkg.relativePath}" not found on disk — skipping`);
      continue;
    }

    // Ensure subdirectory in meta
    const pkgMetaDir = path.join(metaDir, pkg.relativePath);
    fs.mkdirSync(pkgMetaDir, { recursive: true });

    const pkgTestPath = path.join(pkgMetaDir, "CP_TEST.md");
    if (!fs.existsSync(pkgTestPath)) {
      emit(`CP_TEST.md (${pkg.relativePath}) missing at ${pkgTestPath} — dispatching generation task`);
      const prompt = buildTestPrompt(
        workspaceRoot,
        pkg.relativePath,
        pkgAbsPath,
        pkg.name,
        pkg.stack,
        pkg.priority,
        hasTestTemplate,
        testTemplatePath
      );
      dispatchClaudeTask(
        `Meta: Test (${pkg.relativePath})`,
        workspaceRoot,
        prompt
      );
      dispatched++;
    } else {
      const stat = fs.statSync(pkgTestPath);
      emit(`CP_TEST.md (${pkg.relativePath}) exists (${(stat.size / 1024).toFixed(1)} KB, modified ${stat.mtime.toISOString()})`);
    }
  }

  // ── Update throttle timestamp ───────────────────────────────────────
  await context.globalState.update(THROTTLE_KEY, Date.now());
  emit("Throttle timestamp updated");

  // ── Summary ─────────────────────────────────────────────────────────
  if (dispatched > 0) {
    emit(`Dispatched ${dispatched} Claude task(s) in background terminals`);
    vscode.window.showInformationMessage(
      `Stoked Projects: Dispatched ${dispatched} meta evaluation task(s) in background terminals.`
    );
  } else {
    emit("All meta files present — nothing to do");
  }
}

// ─── Prompt builders ────────────────────────────────────────────────────────

function buildOverviewPrompt(workspaceRoot: string): string {
  const pkgList = WORKSPACE_PACKAGES.map(
    (p) => `- ${p.relativePath} (${p.name}) — ${p.stack} [${p.priority}]`
  ).join("\n");

  return `You are analyzing a monorepo at: ${workspaceRoot}

Generate TWO files:

1. **~/.stoked-projects/meta/CP_OVERVIEW.md** — A comprehensive overview of the codebase:
   - Repository purpose and architecture
   - Package dependency graph
   - Key technologies and patterns
   - Development workflow and build system
   - Entry points and critical paths

2. **~/.stoked-projects/meta/CP_RECOMMENDATIONS.md** — Actionable recommendations:
   - Code quality improvements
   - Architecture suggestions
   - Missing tests or documentation
   - Security considerations
   - Performance opportunities

Workspace packages:
${pkgList}

Read the CLAUDE.md, package.json files, and key source files to understand the codebase.
Write both files with clear markdown formatting. Be specific and reference actual file paths.`;
}

function buildTestPrompt(
  workspaceRoot: string,
  label: string,
  packagePath: string,
  packageName: string,
  stack: string,
  priority: string,
  hasTemplate: boolean,
  templatePath: string
): string {
  const outputDir =
    label === "monorepo root"
      ? "~/.stoked-projects/meta"
      : `~/.stoked-projects/meta/${label}`;

  let templateInstructions = "";
  if (hasTemplate) {
    templateInstructions = `\nUse the testing strategy template at ${templatePath} as a structural guide. Adapt its sections to this specific package.`;
  }

  return `You are analyzing the "${packageName}" package (${stack}, priority: ${priority}) located at: ${packagePath}
Part of a monorepo at: ${workspaceRoot}

Generate **${outputDir}/CP_TEST.md** — A testing strategy and implementation plan specific to this package:
- What should be tested (critical paths, edge cases, integration points)
- Recommended test framework and tooling for the stack
- Test file organization and naming conventions
- Mock/stub strategy for external dependencies
- Coverage targets appropriate for the priority level
- Specific test cases to implement first${templateInstructions}

Read the package's source files, existing tests (if any), and configuration to provide concrete, actionable recommendations.
Write the file with clear markdown formatting. Reference actual file paths and function names.`;
}

// ─── Task dispatching ───────────────────────────────────────────────────────

function dispatchClaudeTask(
  taskName: string,
  cwd: string,
  prompt: string
): void {
  try {
    // Write prompt to temp file to avoid shell escaping issues
    const tempFile = path.join(
      TEMP_DIR,
      `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
    );
    emit(`Writing prompt to temp file: ${tempFile} (${prompt.length} chars)`);
    fs.writeFileSync(tempFile, prompt, "utf-8");

    // Verify the temp file was written
    if (!fs.existsSync(tempFile)) {
      emit(`ERROR: Temp file was not created: ${tempFile}`);
      return;
    }

    emit(`Creating terminal "${taskName}" (cwd: ${cwd}, hidden: false)`);
    const terminal = vscode.window.createTerminal({
      name: taskName,
      cwd,
      hideFromUser: false, // Visible so user can see Claude output
    });

    const cmd = `claude --dangerously-skip-permissions -p "$(cat '${tempFile}')" && rm -f '${tempFile}'`;
    emit(`Sending command to terminal: ${cmd.substring(0, 120)}...`);
    terminal.sendText(cmd);

    emit(`Dispatched: ${taskName}`);
  } catch (error) {
    emit(`ERROR dispatching ${taskName}: ${error}`);
  }
}
