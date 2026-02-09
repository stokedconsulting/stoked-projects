/**
 * Complete VSCode Extension Integration Example
 *
 * This example demonstrates full integration of the State Tracking API
 * into a VSCode extension, including:
 * - Session lifecycle management
 * - Heartbeat maintenance
 * - Task tracking
 * - Error recovery
 * - Machine registration
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';
import { StateTrackingApiClient, SessionStatus, TaskStatus } from '../src/client';

// ==================== GLOBAL STATE ====================

let apiClient: StateTrackingApiClient | null = null;
let currentSessionId: string | null = null;
let currentMachineId: string | null = null;
let sessionHeartbeatInterval: NodeJS.Timeout | null = null;
let machineHeartbeatInterval: NodeJS.Timeout | null = null;
let extensionContext: vscode.ExtensionContext;

// ==================== EXTENSION LIFECYCLE ====================

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Extension activating...');
  extensionContext = context;

  // Initialize state tracking if enabled
  const config = vscode.workspace.getConfiguration('stateTracking');
  const enabled = config.get<boolean>('enabled', true);

  if (!enabled) {
    console.log('State tracking is disabled');
    return;
  }

  try {
    await initializeStateTracking(context);
    registerCommands(context);
    console.log('Extension activated successfully');
  } catch (error) {
    console.error('Failed to initialize state tracking:', error);
    vscode.window.showErrorMessage(
      'State tracking initialization failed. Extension will continue without tracking.'
    );
  }
}

/**
 * Extension deactivation cleanup
 */
export async function deactivate() {
  console.log('Extension deactivating...');

  // Stop heartbeats
  stopHeartbeats();

  // Complete session
  if (currentSessionId && apiClient) {
    try {
      await apiClient.updateSession(currentSessionId, {
        status: SessionStatus.COMPLETED,
      });
      console.log('Session completed:', currentSessionId);
    } catch (error) {
      console.error('Failed to complete session:', error);
    }
  }

  console.log('Extension deactivated');
}

// ==================== INITIALIZATION ====================

/**
 * Initialize state tracking system
 */
async function initializeStateTracking(context: vscode.ExtensionContext) {
  // Get configuration
  const config = vscode.workspace.getConfiguration('stateTracking');
  const apiUrl = config.get<string>('apiUrl') || process.env.STATE_TRACKING_API_URL;
  const apiKey = process.env.STATE_TRACKING_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error('API URL or API Key not configured');
  }

  // Initialize API client
  apiClient = new StateTrackingApiClient({
    baseUrl: apiUrl,
    apiKey: apiKey,
    timeout: 10000,
  });

  // Test connection
  console.log('Testing API connection...');
  const health = await apiClient.checkHealth();
  console.log('API health check:', health);

  // Register machine
  currentMachineId = await ensureMachineRegistered(context);
  console.log('Machine ID:', currentMachineId);

  // Start machine heartbeat
  startMachineHeartbeat();

  // Create session
  await createNewSession();

  // Start session heartbeat
  startSessionHeartbeat();
}

/**
 * Ensure machine is registered with the API
 */
async function ensureMachineRegistered(context: vscode.ExtensionContext): Promise<string> {
  const machineId = await getMachineId(context);

  if (!apiClient) {
    throw new Error('API client not initialized');
  }

  try {
    // Check if machine exists
    await apiClient.getMachine(machineId);
    console.log('Machine already registered:', machineId);
  } catch (error) {
    // Machine doesn't exist, register it
    console.log('Registering new machine:', machineId);

    await apiClient.createMachine({
      machine_id: machineId,
      hostname: os.hostname(),
      docker_slots: [1, 2, 3, 4], // Configure based on your Docker setup
      metadata: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        total_memory: os.totalmem(),
        node_version: process.version,
        registered_at: new Date().toISOString(),
      },
    });

    console.log('Machine registered successfully');
  }

  return machineId;
}

/**
 * Get or generate stable machine ID
 */
async function getMachineId(context: vscode.ExtensionContext): Promise<string> {
  // Try to get existing machine ID
  let machineId = context.globalState.get<string>('machineId');

  if (!machineId) {
    // Generate new machine ID based on hostname and network interfaces
    const hostname = os.hostname();
    const networkInterfaces = os.networkInterfaces();

    // Get MAC addresses
    const macAddresses = Object.values(networkInterfaces)
      .flat()
      .filter((iface: any) => iface?.mac && iface.mac !== '00:00:00:00:00:00')
      .map((iface: any) => iface.mac);

    // Create stable hash
    const uniqueString = `${hostname}-${macAddresses.join('-')}`;
    machineId = crypto.createHash('sha256').update(uniqueString).digest('hex').substring(0, 16);

    // Store for future use
    await context.globalState.update('machineId', machineId);
    console.log('Generated new machine ID:', machineId);
  }

  return machineId;
}

// ==================== SESSION MANAGEMENT ====================

/**
 * Create a new session
 */
async function createNewSession() {
  if (!apiClient || !currentMachineId) {
    throw new Error('API client or machine not initialized');
  }

  try {
    const session = await apiClient.createSession({
      project_id: getCurrentProjectId(),
      machine_id: currentMachineId,
      metadata: {
        vscode_version: vscode.version,
        workspace_name: vscode.workspace.name,
        workspace_path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        user: process.env.USER || process.env.USERNAME,
        started_at_local: new Date().toISOString(),
        git_branch: await getCurrentGitBranch(),
      },
    });

    currentSessionId = session.session_id;
    await extensionContext.globalState.update('currentSessionId', currentSessionId);

    console.log('Session created:', currentSessionId);
    vscode.window.showInformationMessage(`Session started: ${currentSessionId}`);
  } catch (error) {
    console.error('Failed to create session:', error);
    throw error;
  }
}

/**
 * Get current project ID (GitHub project number or workspace name)
 */
function getCurrentProjectId(): string {
  // Try to get from workspace settings
  const config = vscode.workspace.getConfiguration('stateTracking');
  let projectId = config.get<string>('projectId');

  if (!projectId) {
    // Fall back to workspace name
    projectId = vscode.workspace.name || 'default-project';
  }

  return projectId;
}

/**
 * Get current git branch
 */
async function getCurrentGitBranch(): Promise<string | undefined> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension?.getAPI(1);

    if (api?.repositories?.length > 0) {
      const repo = api.repositories[0];
      return repo.state.HEAD?.name;
    }
  } catch (error) {
    console.error('Failed to get git branch:', error);
  }

  return undefined;
}

// ==================== HEARTBEAT MANAGEMENT ====================

/**
 * Start session heartbeat
 */
function startSessionHeartbeat() {
  if (sessionHeartbeatInterval) {
    clearInterval(sessionHeartbeatInterval);
  }

  sessionHeartbeatInterval = setInterval(async () => {
    if (!currentSessionId || !apiClient) return;

    try {
      const response = await apiClient.updateSessionHeartbeat(currentSessionId);
      console.log('Session heartbeat:', response.message);
    } catch (error) {
      console.error('Session heartbeat failed:', error);
      await attemptSessionRecovery();
    }
  }, 60000); // Every 60 seconds

  console.log('Session heartbeat started');
}

/**
 * Start machine heartbeat
 */
function startMachineHeartbeat() {
  if (machineHeartbeatInterval) {
    clearInterval(machineHeartbeatInterval);
  }

  machineHeartbeatInterval = setInterval(async () => {
    if (!currentMachineId || !apiClient) return;

    try {
      await apiClient.updateMachineHeartbeat(currentMachineId);
      console.log('Machine heartbeat sent');
    } catch (error) {
      console.error('Machine heartbeat failed:', error);
    }
  }, 60000); // Every 60 seconds

  console.log('Machine heartbeat started');
}

/**
 * Stop all heartbeats
 */
function stopHeartbeats() {
  if (sessionHeartbeatInterval) {
    clearInterval(sessionHeartbeatInterval);
    sessionHeartbeatInterval = null;
  }

  if (machineHeartbeatInterval) {
    clearInterval(machineHeartbeatInterval);
    machineHeartbeatInterval = null;
  }

  console.log('Heartbeats stopped');
}

// ==================== ERROR RECOVERY ====================

/**
 * Attempt to recover a stalled or failed session
 */
async function attemptSessionRecovery() {
  if (!currentSessionId || !apiClient) return;

  try {
    console.log('Attempting session recovery...');

    // Check session health
    const health = await apiClient.getSessionHealth(currentSessionId);

    if (health.is_stale) {
      console.log(`Session is stale (${health.seconds_since_heartbeat}s since heartbeat)`);

      // Mark as stalled
      await apiClient.markSessionStalled(currentSessionId, {
        reason: 'Heartbeat failed, attempting automatic recovery',
      });

      // Attempt recovery
      const recovered = await apiClient.recoverSession(currentSessionId);
      console.log('Session recovered:', recovered.session_id);

      vscode.window.showInformationMessage('Session recovered successfully');
    }
  } catch (error) {
    console.error('Session recovery failed:', error);

    // Create new session if recovery fails
    vscode.window.showWarningMessage(
      'Session recovery failed. Creating new session...'
    );

    try {
      stopHeartbeats();
      await createNewSession();
      startSessionHeartbeat();
    } catch (createError) {
      console.error('Failed to create new session:', createError);
      vscode.window.showErrorMessage('Failed to create new session');
    }
  }
}

// ==================== TASK TRACKING ====================

/**
 * Execute a tracked task
 */
async function executeTrackedTask(
  taskName: string,
  githubIssueId: string | undefined,
  workFunction: () => Promise<void>
): Promise<void> {
  if (!currentSessionId || !apiClient) {
    console.warn('No active session, executing without tracking');
    await workFunction();
    return;
  }

  let taskId: string | undefined;

  try {
    // Create task
    const task = await apiClient.createTask({
      session_id: currentSessionId,
      project_id: getCurrentProjectId(),
      task_name: taskName,
      github_issue_id: githubIssueId,
    });

    taskId = task.task_id;
    console.log('Task created:', taskId, '-', taskName);

    // Start task
    await apiClient.startTask(taskId);
    console.log('Task started:', taskName);

    // Execute work
    await workFunction();

    // Complete task
    await apiClient.completeTask(taskId);
    console.log('Task completed:', taskName);
  } catch (error) {
    console.error('Task execution failed:', error);

    // Mark task as failed
    if (taskId && apiClient) {
      try {
        await apiClient.failTask(taskId, {
          error_message: error instanceof Error ? error.message : String(error),
        });
        console.log('Task marked as failed:', taskName);
      } catch (failError) {
        console.error('Failed to mark task as failed:', failError);
      }
    }

    throw error;
  }
}

/**
 * Show task progress for current session
 */
async function showTaskProgress() {
  if (!currentSessionId || !apiClient) {
    vscode.window.showWarningMessage('No active session');
    return;
  }

  try {
    const progress = await apiClient.getSessionTaskProgress(currentSessionId);

    const message =
      `Task Progress:\n` +
      `Total: ${progress.total_tasks}\n` +
      `Completed: ${progress.completed}\n` +
      `In Progress: ${progress.in_progress}\n` +
      `Pending: ${progress.pending}\n` +
      `Failed: ${progress.failed}\n` +
      `Blocked: ${progress.blocked}`;

    vscode.window.showInformationMessage(message);

    // Log task details
    console.log('Task Progress:', progress);
  } catch (error) {
    console.error('Failed to get task progress:', error);
    vscode.window.showErrorMessage('Failed to retrieve task progress');
  }
}

// ==================== COMMANDS ====================

/**
 * Register VSCode commands
 */
function registerCommands(context: vscode.ExtensionContext) {
  // Command: Show session info
  context.subscriptions.push(
    vscode.commands.registerCommand('stateTracking.showSessionInfo', async () => {
      if (!currentSessionId || !apiClient) {
        vscode.window.showWarningMessage('No active session');
        return;
      }

      try {
        const session = await apiClient.getSession(currentSessionId);
        const health = await apiClient.getSessionHealth(currentSessionId);

        const info =
          `Session: ${session.session_id}\n` +
          `Project: ${session.project_id}\n` +
          `Machine: ${session.machine_id}\n` +
          `Status: ${session.status}\n` +
          `Started: ${new Date(session.started_at).toLocaleString()}\n` +
          `Last Heartbeat: ${new Date(session.last_heartbeat).toLocaleString()}\n` +
          `Health: ${health.is_stale ? 'STALE' : 'OK'}`;

        vscode.window.showInformationMessage(info);
      } catch (error) {
        console.error('Failed to get session info:', error);
        vscode.window.showErrorMessage('Failed to retrieve session info');
      }
    })
  );

  // Command: Show task progress
  context.subscriptions.push(
    vscode.commands.registerCommand('stateTracking.showTaskProgress', showTaskProgress)
  );

  // Command: Execute example task
  context.subscriptions.push(
    vscode.commands.registerCommand('stateTracking.executeExampleTask', async () => {
      await executeTrackedTask(
        'Example Task',
        undefined,
        async () => {
          // Simulate work
          await new Promise(resolve => setTimeout(resolve, 2000));
          console.log('Example task work completed');
        }
      );

      vscode.window.showInformationMessage('Example task completed!');
    })
  );

  // Command: Check session health
  context.subscriptions.push(
    vscode.commands.registerCommand('stateTracking.checkHealth', async () => {
      if (!currentSessionId || !apiClient) {
        vscode.window.showWarningMessage('No active session');
        return;
      }

      try {
        const health = await apiClient.getSessionHealth(currentSessionId);

        const message =
          `Session Health:\n` +
          `Status: ${health.is_stale ? 'STALE' : 'OK'}\n` +
          `Seconds since heartbeat: ${health.seconds_since_heartbeat}\n` +
          `Recommendations: ${health.recommendations.join(', ') || 'None'}`;

        vscode.window.showInformationMessage(message);
      } catch (error) {
        console.error('Failed to check health:', error);
        vscode.window.showErrorMessage('Failed to check session health');
      }
    })
  );

  // Command: Recover session
  context.subscriptions.push(
    vscode.commands.registerCommand('stateTracking.recoverSession', async () => {
      await attemptSessionRecovery();
    })
  );

  console.log('Commands registered');
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Safe API call wrapper with error handling
 */
async function safeApiCall<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) {
      console.error('API call failed:', error.message);
    }
    return fallback;
  }
}

// ==================== EXAMPLE USAGE IN PROJECT WORKFLOW ====================

/**
 * Example: Track a GitHub Project workflow
 */
async function executeProjectWorkflow(projectId: string, issues: string[]) {
  console.log('Starting project workflow...');

  // Create tasks for each GitHub issue
  for (const issueId of issues) {
    await executeTrackedTask(
      `Process GitHub Issue #${issueId}`,
      issueId,
      async () => {
        // Your actual work here
        console.log(`Processing issue ${issueId}...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    );
  }

  console.log('Project workflow completed');
}

/**
 * Example: Handle VSCode workspace events with tracking
 */
function setupWorkspaceTracking(context: vscode.ExtensionContext) {
  // Track file saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await executeTrackedTask(
        `Save file: ${document.fileName}`,
        undefined,
        async () => {
          console.log('File saved:', document.fileName);
        }
      );
    })
  );

  // Track configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('stateTracking')) {
        console.log('State tracking configuration changed');
        // Reload configuration if needed
      }
    })
  );
}
