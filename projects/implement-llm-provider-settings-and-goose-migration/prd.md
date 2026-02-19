# Product Requirements Document: LLM Provider Settings and Goose Migration

## 0. Source Context

**Derived From:** Product Feature Brief (PFB)
**Source Document:** `./projects/implement-llm-provider-settings-and-goose-migration/pfb.md`
**Feature Name:** LLM Provider Settings and Goose Migration
**PRD Owner:** Development Team
**Last Updated:** 2026-01-26
**Status:** Draft - Ready for Implementation

### Feature Brief Summary

Add dual LLM provider support (Claude Code and Goose) to the VSCode extension through a settings UI accessible via a gear icon. Migrate all 5 custom slash commands (`/project-create`, `/project-start`, `/review-item`, `/review-phase`, `/review-project`) from Claude's `.md` format to Goose's YAML-based recipe format while maintaining 100% backward compatibility and feature parity. This enables users to leverage Goose's open-source, extensible AI agent capabilities while preserving existing Claude Code workflows. The implementation must ensure session isolation (no mid-session provider switching), per-workspace settings persistence via VSCode's `workspaceState` API, and graceful error handling for missing provider installations.

---

## 1. Objectives & Constraints

### Objectives

1. **Provider Choice**: Enable users to select between Claude Code and Goose as their LLM provider through an intuitive settings UI
2. **Feature Parity**: Maintain 100% functional equivalence across both providers for all custom commands
3. **Backward Compatibility**: Ensure zero disruption to existing Claude Code users who don't actively switch providers
4. **Command Migration**: Successfully migrate all 5 custom slash commands to Goose's recipe format with validated functionality
5. **User Experience**: Provide clear provider installation guidance, error messaging, and seamless provider switching (with session restart)
6. **Code Quality**: Implement clean provider abstraction layer for maintainable, testable code
7. **Testing Coverage**: Achieve 100% test pass rate for both providers across all integration tests

### Constraints

1. **Session Isolation**: Provider switching requires session restart; mid-session switching is explicitly prohibited to prevent state corruption
2. **Settings Persistence**: Provider preference must persist per-workspace using VSCode's `workspaceState` API (not global settings)
3. **VSCode Version**: Must support VSCode 1.96.0+ (current minimum version requirement)
4. **Backward Compatibility**: Existing users must experience zero breaking changes unless they actively switch providers
5. **Recipe Stability**: Goose recipe format must remain compatible across minor version updates (major version changes require migration)
6. **No Breaking Changes**: All existing integration tests must pass with both providers before release
7. **Error Handling**: Extension must never crash due to provider unavailability; graceful degradation required
8. **Build System**: Changes must work with existing webpack build pipeline without introducing new bundling complexity
9. **Storage Limitations**: Settings storage must respect VSCode workspace storage size limits (typically 1MB per workspace)

---

## 2. Execution Phases

> **Note**: Phases below are ordered and sequential. A phase cannot begin until all acceptance criteria of the previous phase are met. Each phase builds foundational capabilities required by subsequent phases.

---

## Phase 1: Provider Abstraction Layer & Settings UI

**Purpose:** Establish the foundational infrastructure for supporting multiple LLM providers before integrating specific providers or migrating commands. This phase creates the architectural separation between provider-specific logic and extension core logic, enabling all future provider integrations. The settings UI provides the user interface for provider selection.

### 1.1 Create Provider Interface & Abstract Base Class

Define the contract that all LLM providers must implement and create an abstract base class with shared logic.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/providers/llm-provider.interface.ts`
- **Interface Definition**:
  ```typescript
  export interface ILLMProvider {
    readonly name: 'claudeCode' | 'goose';
    readonly displayName: string;

    // Lifecycle methods
    initialize(): Promise<boolean>;
    isInstalled(): Promise<boolean>;
    getVersion(): Promise<string | null>;

    // Command execution
    executeCommand(command: string, args: Record<string, any>): Promise<CommandResponse>;

    // Installation guidance
    getInstallationInstructions(): string;
    getInstallationUrl(): string;
  }

  export interface CommandResponse {
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number;
  }
  ```
- **Abstract Base Class**: Create `LLMProviderBase` in same file with:
  - Shared validation logic
  - Common error handling patterns
  - Response normalization utilities
- **Systems Affected**: All command invocation code in `projects-view-provider.ts`, future provider implementations
- **Error Handling**: Interface methods return typed responses with success flags; no exceptions thrown from interface methods

**Acceptance Criteria**

- AC-1.1.a: Interface `ILLMProvider` defined with all required methods → TypeScript compilation succeeds without errors
- AC-1.1.b: Abstract base class `LLMProviderBase` implements shared utilities → Code reuse for future provider implementations
- AC-1.1.c: Interface includes version detection method → Extension can verify provider compatibility
- AC-1.1.d: Interface documentation specifies error handling contract → Developers understand exception vs. error response patterns

**Acceptance Tests**

- Test-1.1.a: TypeScript compiler validates interface completeness → No compilation errors
- Test-1.1.b: Abstract base class unit tests verify shared utility methods → 100% code coverage on base class
- Test-1.1.c: Mock provider implementation can extend base class → Proof of extensibility pattern
- Test-1.1.d: Interface contract documented with JSDoc → Auto-generated documentation includes all methods

---

### 1.2 Implement Provider Registry & Factory Pattern

Create centralized provider registration and instantiation system.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/providers/provider-registry.ts`
- **Registry Pattern**:
  - Singleton registry maintaining map of provider name → provider class
  - Factory method: `getProvider(name: string): ILLMProvider | null`
  - Auto-registration on module import (via static initializers)
- **Provider Lifecycle**:
  - Lazy initialization (providers not instantiated until selected)
  - Cached instances per workspace (avoid repeated initialization)
  - Cleanup on workspace close
- **Integration Point**: Modify `ProjectsViewProvider` constructor to inject registry
- **Dependencies**: Requires Phase 1.1 completion (interface definition)
- **Storage**: Use VSCode `ExtensionContext.workspaceState` for provider preference
- **Default Behavior**: If no preference stored, default to `'claudeCode'`

**Acceptance Criteria**

- AC-1.2.a: Registry singleton initializes on extension activation → Single instance accessible throughout extension lifetime
- AC-1.2.b: Factory method `getProvider('claudeCode')` returns valid provider instance → Non-null provider object with all interface methods
- AC-1.2.c: Unregistered provider name returns `null` without exception → Graceful handling of invalid provider names
- AC-1.2.d: Provider instances cached per workspace → Same instance returned for repeated calls within workspace
- AC-1.2.e: Workspace preference persists across VSCode restarts → Provider selection restored from `workspaceState`

**Acceptance Tests**

- Test-1.2.a: Unit test verifies singleton pattern → Only one registry instance exists
- Test-1.2.b: Integration test retrieves registered providers → Factory returns non-null instances for 'claudeCode' and 'goose'
- Test-1.2.c: Error test validates null return for invalid provider → No exceptions thrown
- Test-1.2.d: Cache test confirms instance reuse → Object identity equality for repeated `getProvider()` calls
- Test-1.2.e: State persistence test validates workspace storage → Provider preference survives extension reload

---

### 1.3 Design & Implement Settings UI Components

Create user interface for provider selection with gear icon trigger.

**Implementation Details**

- **Toolbar Integration** (file: `/apps/code-ext/media/main.js`):
  - Add gear icon (⚙️) to `createToolbar()` function
  - Position: Rightmost button after existing action buttons (refresh, add project, filter)
  - Event handler: Opens modal settings panel
- **Settings Panel** (file: `/apps/code-ext/media/main.js`):
  - Modal overlay with semi-transparent backdrop
  - Panel content:
    - Title: "Extension Settings"
    - Dropdown: "LLM Provider" (options: "Claude Code", "Goose")
    - Provider status indicator (installed/not installed with version)
    - Installation instructions link (if not installed)
    - Save button, Cancel button
  - State management: Use `vscode.getState()` / `vscode.setState()` for persistence
- **CSS Styling** (file: `/apps/code-ext/media/style.css`):
  - Modal overlay: `.settings-modal`, `.settings-backdrop`
  - Panel container: `.settings-panel`
  - Form controls: `.settings-dropdown`, `.settings-button`
  - Status indicators: `.provider-status.installed`, `.provider-status.not-installed`
- **Message Flow**:
  - Frontend → Extension: `{ type: 'updateProvider', provider: 'goose' }`
  - Extension → Frontend: `{ type: 'providerUpdated', provider: 'goose', requiresReload: true }`
- **Keyboard Accessibility**: ESC key closes modal, Tab navigation for controls

**Acceptance Criteria**

- AC-1.3.a: Gear icon visible in toolbar → Icon appears next to existing toolbar buttons
- AC-1.3.b: Clicking gear icon opens settings modal → Modal displays within 200ms with correct content
- AC-1.3.c: Dropdown shows current provider selection → Active provider pre-selected in dropdown
- AC-1.3.d: Provider status indicator shows installation state → "Installed (v1.2.3)" or "Not Installed" badge
- AC-1.3.e: Save button triggers provider update message → `postMessage` sent to extension with new provider
- AC-1.3.f: Cancel button closes modal without changes → No provider update message sent
- AC-1.3.g: ESC key closes modal → Same behavior as Cancel button
- AC-1.3.h: Modal backdrop click closes modal → Settings panel dismissed

**Acceptance Tests**

- Test-1.3.a: UI test verifies gear icon renders → Element with class `.toolbar-settings-icon` exists
- Test-1.3.b: Interaction test measures modal open time → Modal visible within 200ms of click
- Test-1.3.c: State test validates dropdown selection → Active provider matches `state.llmProvider`
- Test-1.3.d: Visual test captures status indicator states → Screenshots for installed/not-installed states
- Test-1.3.e: Message test verifies postMessage call → Mock `vscode.postMessage` receives correct payload
- Test-1.3.f: Event test validates Cancel behavior → Modal closes without state change
- Test-1.3.g: Keyboard test validates ESC key → Event listener responds to keydown event
- Test-1.3.h: Click test validates backdrop dismiss → Event propagation handled correctly

---

### 1.4 Implement Provider Preference Storage & Validation

Create backend logic for persisting and validating provider selections.

**Implementation Details**

- **File**: Modify `/apps/code-ext/src/projects-view-provider.ts`
- **Storage Schema** (stored in `workspaceState`):
  ```typescript
  interface ProviderSettings {
    provider: 'claudeCode' | 'goose';
    lastUpdated: string; // ISO 8601 timestamp
    version: string; // Settings schema version (e.g., "1.0.0")
  }
  ```
- **Key Format**: `'llmProvider.settings'`
- **Message Handler**: Add case for `'updateProvider'` in webview message listener
- **Validation Logic**:
  1. Check provider is registered in registry
  2. Verify provider installation via `isInstalled()`
  3. If not installed, return error with installation instructions
  4. If installed, update `workspaceState`
  5. Send confirmation message to webview with `requiresReload: true`
- **Error Responses**:
  - Provider not found: `{ type: 'error', message: 'Invalid provider', details: '...' }`
  - Provider not installed: `{ type: 'providerNotInstalled', provider: 'goose', instructions: '...', url: '...' }`
- **Initialization**: Load provider preference in `ProjectsViewProvider` constructor
- **Default Behavior**: If no settings found, initialize with `{ provider: 'claudeCode', version: '1.0.0', lastUpdated: new Date().toISOString() }`

**Acceptance Criteria**

- AC-1.4.a: Provider selection saved to `workspaceState` → Settings retrievable via `context.workspaceState.get('llmProvider.settings')`
- AC-1.4.b: Invalid provider name rejected → Error message sent to webview
- AC-1.4.c: Not-installed provider selection triggers installation instructions → Webview displays error with installation link
- AC-1.4.d: Successful provider change returns confirmation → Webview receives `providerUpdated` message
- AC-1.4.e: Settings schema version included in storage → Future migration capability preserved
- AC-1.4.f: Default provider set on first activation → New workspace defaults to 'claudeCode'
- AC-1.4.g: Settings restored on extension reload → Provider preference survives VSCode restart

**Acceptance Tests**

- Test-1.4.a: Storage test validates workspaceState write → Mock workspaceState confirms `update()` called
- Test-1.4.b: Validation test rejects invalid provider → Error response returned for unknown provider name
- Test-1.4.c: Installation test validates error flow → Mock `isInstalled()` returns false, error message generated
- Test-1.4.d: Success test validates confirmation message → `providerUpdated` message sent to webview
- Test-1.4.e: Schema test validates version field → Stored settings include version string
- Test-1.4.f: Default test validates initial state → First-time activation sets 'claudeCode'
- Test-1.4.g: Persistence test validates reload behavior → Settings survive extension deactivation/reactivation

---

### 1.5 Add Session Restart Enforcement

Ensure provider changes trigger session restart, preventing mid-session provider switching.

**Implementation Details**

- **File**: Modify `/apps/code-ext/src/projects-view-provider.ts`
- **Provider Change Detection**:
  - Compare new provider selection with currently active provider
  - If different, set `requiresReload: true` in response message
- **Webview Handler** (file: `/apps/code-ext/media/main.js`):
  - Display modal: "Provider changed. Please reload the VSCode window to apply changes."
  - Buttons: "Reload Now" (calls `vscode.postMessage({ type: 'reloadWindow' })`) and "Reload Later"
- **Extension Handler**:
  - Add message case for `'reloadWindow'`
  - Execute: `vscode.commands.executeCommand('workbench.action.reloadWindow')`
- **In-Progress Session Protection**:
  - Check for active Claude/Goose sessions (via `.claude-sessions/` directory)
  - If active session detected, show warning: "Active LLM session detected. Changing providers will terminate this session. Continue?"
  - Confirmation required before provider change applied
- **State Cleanup**:
  - Clear cached provider instance on provider change
  - Reset session monitoring state
  - Clear orchestration WebSocket connections

**Acceptance Criteria**

- AC-1.5.a: Provider change sets `requiresReload: true` → Response message includes reload flag
- AC-1.5.b: Webview displays reload prompt → Modal appears with "Reload Now" button
- AC-1.5.c: "Reload Now" button triggers window reload → VSCode window reloads within 500ms
- AC-1.5.d: Active session detection prevents silent provider change → Warning modal displayed when session active
- AC-1.5.e: User confirmation required for mid-session provider change → Provider not updated without explicit confirmation
- AC-1.5.f: Provider instance cache cleared on change → Next command execution uses new provider
- AC-1.5.g: "Reload Later" allows deferring reload → User can continue working, reload applied on next window activation

**Acceptance Tests**

- Test-1.5.a: Response test validates reload flag → Mock response includes `requiresReload: true`
- Test-1.5.b: UI test verifies reload modal → Element with class `.reload-modal` rendered
- Test-1.5.c: Command test validates reload execution → Mock `executeCommand` called with `workbench.action.reloadWindow`
- Test-1.5.d: Session detection test validates warning → Mock active session file triggers warning modal
- Test-1.5.e: Confirmation test validates two-step process → Provider update requires user confirmation
- Test-1.5.f: Cache test validates instance cleanup → Provider registry returns new instance after change
- Test-1.5.g: Deferred reload test validates persistence → Settings saved even without immediate reload

---

## Phase 2: Claude Code Provider Implementation

**Purpose:** Implement the Claude Code provider as the reference implementation, wrapping existing command invocation logic into the new provider abstraction. This phase maintains 100% backward compatibility while establishing the provider pattern that Goose will follow. Existing Claude Code functionality is preserved without modification to user-facing behavior.

### 2.1 Implement Claude Code Provider Class

Create concrete implementation of `ILLMProvider` for Claude Code.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/providers/claude-code-provider.ts`
- **Class Definition**:
  ```typescript
  export class ClaudeCodeProvider extends LLMProviderBase implements ILLMProvider {
    readonly name = 'claudeCode';
    readonly displayName = 'Claude Code';

    async isInstalled(): Promise<boolean> {
      // Check for `claude` CLI in PATH
      // Execute: `which claude` (macOS/Linux) or `where claude` (Windows)
    }

    async getVersion(): Promise<string | null> {
      // Execute: `claude --version`
      // Parse version string from output
    }

    async executeCommand(command: string, args: Record<string, any>): Promise<CommandResponse> {
      // Translate command name to Claude slash command
      // Build command line: `claude /{command} {args}`
      // Execute via child_process.execAsync
      // Parse output and return normalized response
    }

    getInstallationInstructions(): string {
      return 'Install Claude Code from: https://claude.ai/download';
    }

    getInstallationUrl(): string {
      return 'https://claude.ai/download';
    }
  }
  ```
- **Command Mapping**:
  - `'project-create'` → `claude /project-create`
  - `'project-start'` → `claude /project-start`
  - `'review-item'` → `claude /review-item`
  - `'review-phase'` → `claude /review-phase`
  - `'review-project'` → `claude /review-project`
- **Argument Serialization**: Convert args object to CLI flags (e.g., `{ issueNumber: 5, phase: 1 }` → `--issue-number 5 --phase 1`)
- **Output Parsing**: Capture stdout/stderr, detect success/failure via exit code
- **Error Handling**: Wrap all `exec()` calls in try-catch, return error responses for command failures

**Acceptance Criteria**

- AC-2.1.a: `isInstalled()` returns `true` when Claude CLI present → Installation check succeeds on development machine
- AC-2.1.b: `getVersion()` returns valid version string → Version number extracted from CLI output (e.g., "1.2.3")
- AC-2.1.c: `executeCommand('project-start', {})` invokes `claude /project-start` → CLI command executed successfully
- AC-2.1.d: Command output captured in response → `CommandResponse.output` contains stdout
- AC-2.1.e: Command errors captured in response → `CommandResponse.error` contains stderr for failed commands
- AC-2.1.f: Exit code included in response → `CommandResponse.exitCode` matches CLI process exit code
- AC-2.1.g: Installation instructions accurate → URL points to valid Claude download page

**Acceptance Tests**

- Test-2.1.a: Installation test mocks `which claude` → Success/failure based on mock return
- Test-2.1.b: Version test validates parsing → Mock `claude --version` output returns expected version
- Test-2.1.c: Command test validates CLI invocation → Mock `execAsync` receives correct command string
- Test-2.1.d: Output test validates stdout capture → Mock command output appears in response
- Test-2.1.e: Error test validates stderr capture → Mock error output appears in response
- Test-2.1.f: Exit code test validates status code → Mock exit code propagated to response
- Test-2.1.g: URL test validates installation link → URL accessible and returns 200 status

---

### 2.2 Register Claude Code Provider in Registry

Connect Claude Code provider to registry and set as default.

**Implementation Details**

- **File**: Modify `/apps/code-ext/src/providers/provider-registry.ts`
- **Registration**:
  ```typescript
  import { ClaudeCodeProvider } from './claude-code-provider';

  // In ProviderRegistry class
  constructor() {
    this.register(new ClaudeCodeProvider());
  }
  ```
- **Default Provider Logic**:
  - If `workspaceState.get('llmProvider.settings')` is `undefined`, initialize with:
    ```typescript
    { provider: 'claudeCode', version: '1.0.0', lastUpdated: new Date().toISOString() }
    ```
- **Validation**: Add registration validation (prevent duplicate provider names)
- **Logging**: Log provider registration to extension output channel

**Acceptance Criteria**

- AC-2.2.a: Claude Code provider registered on extension activation → Registry contains 'claudeCode' key
- AC-2.2.b: `getProvider('claudeCode')` returns `ClaudeCodeProvider` instance → Non-null provider of correct type
- AC-2.2.c: Default provider set to 'claudeCode' for new workspaces → First-time workspace defaults to Claude Code
- AC-2.2.d: Duplicate registration prevented → Second registration of 'claudeCode' throws error or logs warning
- AC-2.2.e: Registration logged to output channel → Log entry visible in "Stoked Projects" output

**Acceptance Tests**

- Test-2.2.a: Registry test validates provider presence → Registry map contains 'claudeCode' entry
- Test-2.2.b: Factory test validates instance type → `getProvider('claudeCode')` returns `ClaudeCodeProvider` instance
- Test-2.2.c: Default test validates new workspace behavior → Mock clean workspace state results in 'claudeCode' provider
- Test-2.2.d: Duplicate test validates registration guard → Second `register()` call with same name fails gracefully
- Test-2.2.e: Logging test validates output channel message → Mock output channel receives registration log

---

### 2.3 Refactor Command Invocation to Use Provider Abstraction

Replace direct Claude CLI calls with provider-mediated execution.

**Implementation Details**

- **Files**: Modify `/apps/code-ext/src/projects-view-provider.ts`
- **Current State**: Extension directly calls Claude commands via:
  ```typescript
  // Example from existing code
  await execAsync(`claude /project-start --project ${projectNumber}`);
  ```
- **New Pattern**:
  ```typescript
  const provider = this.getActiveProvider(); // Retrieve from registry
  const response = await provider.executeCommand('project-start', { project: projectNumber });
  if (!response.success) {
    this.showError(response.error);
  }
  ```
- **Command Locations to Refactor**:
  1. Project creation flow (search for `claude /project-create`)
  2. Project start flow (search for `claude /project-start`)
  3. Review item flow (search for `claude /review-item`)
  4. Review phase flow (search for `claude /review-phase`)
  5. Review project flow (search for `claude /review-project`)
- **Provider Injection**: Add `getActiveProvider()` method to `ProjectsViewProvider`:
  ```typescript
  private getActiveProvider(): ILLMProvider {
    const settings = this._context.workspaceState.get<ProviderSettings>('llmProvider.settings');
    const providerName = settings?.provider || 'claudeCode';
    const provider = ProviderRegistry.getInstance().getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    return provider;
  }
  ```
- **Error Handling**: Wrap all provider calls in try-catch, display errors via webview `postMessage`

**Acceptance Criteria**

- AC-2.3.a: All direct `claude` CLI calls removed → Grep for `claude /` returns zero matches in `projects-view-provider.ts`
- AC-2.3.b: Provider abstraction used for all commands → All command invocations use `provider.executeCommand()`
- AC-2.3.c: `getActiveProvider()` retrieves correct provider → Returns Claude Code provider when 'claudeCode' selected
- AC-2.3.d: Command execution success cases work identically → Existing workflows produce same results
- AC-2.3.e: Command execution error cases handled gracefully → Error messages displayed in webview
- AC-2.3.f: Provider not found error handled → Extension doesn't crash when provider missing

**Acceptance Tests**

- Test-2.3.a: Code scan validates CLI removal → Static analysis finds no direct CLI calls
- Test-2.3.b: Pattern test validates abstraction usage → All command invocations follow provider pattern
- Test-2.3.c: Provider test validates retrieval → Mock settings return correct provider instance
- Test-2.3.d: Integration test validates success flow → End-to-end test with Claude provider succeeds
- Test-2.3.e: Error test validates failure flow → Mock command failure displays error in webview
- Test-2.3.f: Exception test validates missing provider → Missing provider throws expected error

---

### 2.4 Add Backward Compatibility Testing Suite

Validate that refactored code maintains 100% feature parity with pre-refactor implementation.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/test/providers/claude-code-backward-compat.test.ts`
- **Test Scenarios**:
  1. **Command Invocation**: All 5 commands execute with same arguments as before
  2. **Output Format**: Command responses match expected format
  3. **Error Handling**: Error cases produce identical error messages
  4. **Session Management**: Claude monitor integration still functions
  5. **Cache Behavior**: Command results cached correctly
  6. **Workspace State**: Settings don't interfere with existing workspace state
- **Test Data**: Use recorded command outputs from pre-refactor implementation as fixtures
- **Regression Detection**: Compare refactored execution results with baseline fixtures
- **CI Integration**: Add test suite to CI pipeline, must pass before merge

**Acceptance Criteria**

- AC-2.4.a: All 5 command integration tests pass → Test suite returns zero failures
- AC-2.4.b: Command output matches baseline fixtures → Output diff is empty
- AC-2.4.c: Error cases produce identical messages → Error strings match pre-refactor versions
- AC-2.4.d: Session monitoring still functions → Claude monitor detects command completion
- AC-2.4.e: Cache hit/miss behavior unchanged → Cache statistics match baseline
- AC-2.4.f: No workspace state corruption → Existing settings preserved after refactor

**Acceptance Tests**

- Test-2.4.a: Integration test suite validates all commands → All tests green
- Test-2.4.b: Fixture comparison test validates output → Diff tool reports zero differences
- Test-2.4.c: Error test validates message strings → String equality assertions pass
- Test-2.4.d: Monitor test validates session detection → Mock session file triggers monitor callback
- Test-2.4.e: Cache test validates storage behavior → Cache hit rate matches baseline
- Test-2.4.f: State test validates workspace integrity → Pre-existing settings unchanged

---

## Phase 3: Goose Provider Implementation & Recipe Migration

**Purpose:** Implement Goose provider and migrate all 5 custom Claude commands to Goose's YAML-based recipe format. This phase introduces the second provider option and ensures feature parity between Claude Code and Goose. Recipe conversion must preserve functionality while adapting to Goose's declarative workflow syntax.

### 3.1 Research Goose Recipe Format & CLI Interface

Understand Goose's recipe structure, config.yaml format, and CLI invocation patterns.

**Implementation Details**

- **Documentation Review**:
  - [Goose Configuration Files Documentation](https://block.github.io/goose/docs/guides/config-files/)
  - [Goose GitHub Repository](https://github.com/block/goose) - examples and recipe templates
  - [Building AI Agents with Goose](https://www.docker.com/blog/building-ai-agents-with-goose-and-docker/)
- **Key Concepts to Document**:
  1. **Recipe Structure**: YAML format with stages, prompts, tools
  2. **Config.yaml**: Custom command registration and recipe mapping
  3. **CLI Invocation**: `goose run <recipe-name>` vs. `goose /<custom-command>`
  4. **Tool Integration**: How recipes call external tools (GitHub CLI, etc.)
  5. **Variable Passing**: How arguments pass from CLI to recipe
  6. **Output Handling**: How recipes return results/status
- **Test Installation**:
  - Install Goose locally: `brew install goose` (macOS) or download from GitHub releases
  - Create test recipe to validate understanding
  - Test custom command registration in `~/.config/goose/config.yaml`
- **Deliverable**: Create `/docs/goose-recipe-guide.md` documenting findings

**Acceptance Criteria**

- AC-3.1.a: Goose recipe format documented → Guide includes YAML structure examples
- AC-3.1.b: Config.yaml command registration documented → Guide shows custom command syntax
- AC-3.1.c: CLI invocation patterns documented → Guide covers `goose run` and custom commands
- AC-3.1.d: Test recipe successfully executes → Simple "hello world" recipe runs without errors
- AC-3.1.e: Custom command registration validated → Test custom command accessible via `goose /test-command`
- AC-3.1.f: Argument passing mechanism understood → Test recipe receives and processes input arguments

**Acceptance Tests**

- Test-3.1.a: Documentation review validates completeness → Guide includes all required sections
- Test-3.1.b: Config test validates command registration → Mock config.yaml parses successfully
- Test-3.1.c: CLI test validates invocation patterns → Test commands execute via both `run` and custom command syntax
- Test-3.1.d: Recipe test validates execution → Test recipe completes with exit code 0
- Test-3.1.e: Custom command test validates registration → `goose /test-command` invokes test recipe
- Test-3.1.f: Argument test validates parameter passing → Test recipe logs received arguments

---

### 3.2 Convert Claude Commands to Goose Recipe Format

Migrate all 5 custom commands from Claude `.md` format to Goose YAML recipes.

**Implementation Details**

- **File Structure**:
  - Create `/apps/code-ext/commands/goose/recipes/` directory
  - One recipe file per command:
    1. `project-create.yaml`
    2. `project-start.yaml`
    3. `review-item.yaml`
    4. `review-phase.yaml`
    5. `review-project.yaml`
- **Recipe Template Structure**:
  ```yaml
  name: project-create
  description: Create new GitHub project from problem description
  version: 1.0.0

  stages:
    - name: preprocess-description
      prompt: |
        [Extract prompt content from /project-create.md]
      tools:
        - github-cli
        - file-system

    - name: generate-pfb
      prompt: |
        [Extract prompt content from /project-create.md]
      dependencies:
        - preprocess-description

    - name: generate-prd
      prompt: |
        [Extract prompt content from /project-create.md]
      dependencies:
        - generate-pfb

    - name: create-github-project
      prompt: |
        [Extract prompt content from /project-create.md]
      dependencies:
        - generate-prd
      tools:
        - github-cli

  inputs:
    - name: problem_description
      type: string
      required: true
      description: Path to problem description file or inline description

  outputs:
    - name: project_number
      type: number
      description: GitHub project number
    - name: project_url
      type: string
      description: GitHub project URL
  ```
- **Conversion Strategy**:
  1. Extract sequential phases from Claude `.md` command
  2. Convert to Goose stages with dependencies
  3. Map tool invocations (e.g., `gh project create`) to Goose tool calls
  4. Define input/output schema for each recipe
  5. Preserve all prompt engineering from original commands
- **Files to Convert**:
  - Source: `/apps/code-ext/commands/*.md` (Claude format)
  - Destination: `/apps/code-ext/commands/goose/recipes/*.yaml` (Goose format)

**Acceptance Criteria**

- AC-3.2.a: All 5 recipes created in Goose format → Files exist in `goose/recipes/` directory
- AC-3.2.b: Recipe structure follows Goose conventions → YAML validates against Goose schema
- AC-3.2.c: All stages from Claude commands preserved → No functionality lost in conversion
- AC-3.2.d: Stage dependencies correctly specified → Execution order matches Claude sequential flow
- AC-3.2.e: Input/output schemas defined → All required parameters documented
- AC-3.2.f: Prompt content preserved → Identical prompt engineering maintained

**Acceptance Tests**

- Test-3.2.a: File existence test validates all recipes → 5 YAML files present
- Test-3.2.b: Schema validation test validates YAML structure → `yamllint` passes for all recipes
- Test-3.2.c: Stage coverage test validates completeness → All Claude phases mapped to Goose stages
- Test-3.2.d: Dependency test validates execution order → Topological sort of stages matches Claude sequence
- Test-3.2.e: Schema test validates input/output definitions → Required fields present in all recipes
- Test-3.2.f: Diff test validates prompt content → Prompt text matches Claude original (ignoring whitespace)

---

### 3.3 Create Goose config.yaml Template with Custom Commands

Generate config.yaml template that registers all 5 custom commands.

**Implementation Details**

- **File**: Create `/apps/code-ext/commands/goose/config.yaml.template`
- **Template Structure**:
  ```yaml
  # Goose Configuration for Stoked Projects Extension
  # Installation: Copy to ~/.config/goose/config.yaml (or merge with existing config)

  custom_commands:
    - name: project-create
      recipe: /path/to/recipes/project-create.yaml
      description: "Create new GitHub project from problem description"
      aliases:
        - pc

    - name: project-start
      recipe: /path/to/recipes/project-start.yaml
      description: "Start execution of existing GitHub project"
      aliases:
        - ps

    - name: review-item
      recipe: /path/to/recipes/review-item.yaml
      description: "Review single project work item"
      aliases:
        - ri

    - name: review-phase
      recipe: /path/to/recipes/review-phase.yaml
      description: "Review all items in project phase"
      aliases:
        - rp

    - name: review-project
      recipe: /path/to/recipes/review-project.yaml
      description: "Review entire project with executive summary"
      aliases:
        - rpr

  settings:
    default_model: claude-sonnet-4-5  # Use Claude by default
    github_integration: true
    mcp_enabled: true
  ```
- **Path Placeholder**: Template uses `{EXTENSION_PATH}` placeholder, replaced during installation
- **Installation Script**: Create `/apps/code-ext/commands/goose/install.sh`:
  ```bash
  #!/bin/bash
  # Install Goose recipes and config for Stoked Projects extension

  GOOSE_DIR="$HOME/.config/goose"
  RECIPE_DIR="$GOOSE_DIR/recipes/stoked-projects"

  # Create directories
  mkdir -p "$RECIPE_DIR"

  # Copy recipes
  cp recipes/*.yaml "$RECIPE_DIR/"

  # Merge config.yaml (or create if missing)
  # Logic to merge/append to existing config without overwriting
  ```
- **Windows Support**: Create equivalent `install.ps1` for Windows

**Acceptance Criteria**

- AC-3.3.a: config.yaml.template includes all 5 commands → All custom commands registered
- AC-3.3.b: Recipe paths use placeholder → Template contains `{EXTENSION_PATH}` variable
- AC-3.3.c: Command aliases provided → Shortcuts (e.g., `pc`, `ps`) defined
- AC-3.3.d: Install script creates correct directory structure → `~/.config/goose/recipes/stoked-projects/` exists
- AC-3.3.e: Install script copies all recipes → 5 YAML files present in destination
- AC-3.3.f: Install script merges config without overwriting → Existing user config preserved

**Acceptance Tests**

- Test-3.3.a: Template test validates command count → 5 custom_commands entries present
- Test-3.3.b: Placeholder test validates variable usage → Template contains `{EXTENSION_PATH}` string
- Test-3.3.c: Alias test validates shortcut definitions → All commands have at least one alias
- Test-3.3.d: Directory test validates install script → Script creates expected directory structure
- Test-3.3.e: Copy test validates recipe installation → Script copies all 5 recipes to destination
- Test-3.3.f: Merge test validates config preservation → Script doesn't overwrite existing config keys

---

### 3.4 Implement Goose Provider Class

Create concrete implementation of `ILLMProvider` for Goose.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/providers/goose-provider.ts`
- **Class Definition**:
  ```typescript
  export class GooseProvider extends LLMProviderBase implements ILLMProvider {
    readonly name = 'goose';
    readonly displayName = 'Goose';

    async isInstalled(): Promise<boolean> {
      // Check for `goose` CLI in PATH
      // Execute: `which goose` (macOS/Linux) or `where goose` (Windows)
    }

    async getVersion(): Promise<string | null> {
      // Execute: `goose --version`
      // Parse version string from output
    }

    async initialize(): Promise<boolean> {
      // Check if recipes installed in ~/.config/goose/recipes/stoked-projects/
      // Validate config.yaml contains custom command registrations
      // Return false if setup incomplete (trigger installation wizard)
    }

    async executeCommand(command: string, args: Record<string, any>): Promise<CommandResponse> {
      // Translate command name to Goose custom command
      // Build command line: `goose /{command}` with args as environment variables
      // Execute via child_process.execAsync
      // Parse YAML output (if structured) or raw output
      // Return normalized response
    }

    getInstallationInstructions(): string {
      return 'Install Goose via Homebrew: brew install goose\nThen run extension command: "Install Goose Recipes"';
    }

    getInstallationUrl(): string {
      return 'https://github.com/block/goose#installation';
    }
  }
  ```
- **Command Mapping**:
  - `'project-create'` → `goose /project-create` (requires custom command registration)
  - `'project-start'` → `goose /project-start`
  - `'review-item'` → `goose /review-item`
  - `'review-phase'` → `goose /review-phase`
  - `'review-project'` → `goose /review-project`
- **Argument Passing**: Goose recipes receive args via environment variables or stdin (JSON format)
- **Output Parsing**: Parse structured YAML output from recipes, fallback to raw text
- **Recipe Installation Detection**: Check for presence of recipe files in `~/.config/goose/recipes/stoked-projects/`

**Acceptance Criteria**

- AC-3.4.a: `isInstalled()` returns `true` when Goose CLI present → Installation check succeeds
- AC-3.4.b: `getVersion()` returns valid version string → Version extracted from CLI output
- AC-3.4.c: `initialize()` validates recipe installation → Returns `false` if recipes missing
- AC-3.4.d: `executeCommand('project-start', {})` invokes `goose /project-start` → Custom command executed
- AC-3.4.e: Recipe output parsed correctly → Structured YAML output converted to `CommandResponse`
- AC-3.4.f: Environment variable args passed to recipes → Recipes receive input parameters
- AC-3.4.g: Installation instructions include recipe setup → Instructions mention "Install Goose Recipes" command

**Acceptance Tests**

- Test-3.4.a: Installation test validates CLI presence → Mock `which goose` returns success
- Test-3.4.b: Version test validates parsing → Mock `goose --version` output parsed correctly
- Test-3.4.c: Initialization test validates recipe check → Mock missing recipes returns `false`
- Test-3.4.d: Command test validates custom command invocation → Mock `execAsync` receives `goose /project-start`
- Test-3.4.e: Output test validates YAML parsing → Mock structured output converted to response object
- Test-3.4.f: Argument test validates environment variable passing → Mock recipe execution receives env vars
- Test-3.4.g: Instructions test validates setup guidance → Instructions include recipe installation step

---

### 3.5 Register Goose Provider & Add Installation Command

Connect Goose provider to registry and create recipe installation command.

**Implementation Details**

- **File**: Modify `/apps/code-ext/src/providers/provider-registry.ts`
- **Registration**:
  ```typescript
  import { GooseProvider } from './goose-provider';

  // In ProviderRegistry class constructor
  constructor() {
    this.register(new ClaudeCodeProvider());
    this.register(new GooseProvider());
  }
  ```
- **VSCode Command**: Add to `extension.ts`:
  ```typescript
  vscode.commands.registerCommand('claudeProjects.installGooseRecipes', async () => {
    // Check if Goose installed
    // If not, show installation instructions
    // If installed, run install.sh script
    // Show progress notification
    // Verify installation success
    // Show completion message with next steps
  });
  ```
- **Command Palette Entry**: Add to `package.json`:
  ```json
  {
    "command": "claudeProjects.installGooseRecipes",
    "title": "Stoked Projects: Install Goose Recipes",
    "category": "Stoked Projects"
  }
  ```
- **Installation Flow**:
  1. Detect OS (macOS/Linux/Windows)
  2. Execute appropriate install script (`install.sh` or `install.ps1`)
  3. Verify recipe files copied successfully
  4. Check config.yaml merged correctly
  5. Display success message with command list
- **Error Handling**: Handle cases where Goose not installed, permission issues, config conflicts

**Acceptance Criteria**

- AC-3.5.a: Goose provider registered in registry → Registry contains 'goose' key
- AC-3.5.b: `getProvider('goose')` returns `GooseProvider` instance → Non-null provider of correct type
- AC-3.5.c: Install command available in command palette → Command appears in Command Palette search
- AC-3.5.d: Install command executes install script → Script runs without errors
- AC-3.5.e: Install command verifies success → Post-install validation confirms recipes present
- AC-3.5.f: Install command handles missing Goose gracefully → Error message shown if CLI not found
- AC-3.5.g: Install command shows progress notification → User sees progress during installation

**Acceptance Tests**

- Test-3.5.a: Registry test validates Goose presence → Registry map contains 'goose' entry
- Test-3.5.b: Factory test validates instance type → `getProvider('goose')` returns `GooseProvider` instance
- Test-3.5.c: Command test validates palette registration → Mock Command Palette shows install command
- Test-3.5.d: Script test validates execution → Mock script execution succeeds
- Test-3.5.e: Verification test validates post-install check → Mock file system check confirms recipes present
- Test-3.5.f: Error test validates missing CLI handling → Mock missing Goose shows error message
- Test-3.5.g: Progress test validates notification → Mock progress notification displayed during install

---

## Phase 4: Integration Testing & Feature Parity Validation

**Purpose:** Comprehensively test both providers to ensure 100% feature parity and validate that all acceptance criteria from previous phases are met. This phase includes automated testing, manual testing scenarios, and performance benchmarking to catch regressions before release.

### 4.1 Create Dual-Provider Test Suite

Build automated test suite that validates identical behavior across both providers.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/test/providers/dual-provider.test.ts`
- **Test Framework**: Use VSCode extension test framework with Mocha/Chai
- **Test Structure**:
  ```typescript
  describe('Dual Provider Test Suite', () => {
    const providers = ['claudeCode', 'goose'];

    providers.forEach(providerName => {
      describe(`Provider: ${providerName}`, () => {
        let provider: ILLMProvider;

        beforeEach(() => {
          provider = ProviderRegistry.getInstance().getProvider(providerName);
        });

        it('should execute project-create command', async () => {
          const response = await provider.executeCommand('project-create', { description: 'test' });
          assert.isTrue(response.success);
          assert.isDefined(response.output);
        });

        // Repeat for all 5 commands
      });
    });
  });
  ```
- **Test Cases**:
  1. **Command Execution**: All 5 commands execute successfully
  2. **Argument Handling**: Commands accept and process arguments correctly
  3. **Output Format**: Responses follow `CommandResponse` interface
  4. **Error Handling**: Failed commands return error responses, not exceptions
  5. **Session Isolation**: Provider changes require restart
  6. **Settings Persistence**: Provider preference survives restarts
  7. **Installation Detection**: `isInstalled()` accurate for both providers
  8. **Version Detection**: `getVersion()` returns valid versions
- **Mock Strategy**: Mock CLI execution to avoid external dependencies, use fixture data
- **Diff Validation**: Compare Claude and Goose outputs for same inputs, verify semantic equivalence

**Acceptance Criteria**

- AC-4.1.a: Test suite runs against both providers → All tests execute for 'claudeCode' and 'goose'
- AC-4.1.b: All 5 commands tested for both providers → 10 total command execution tests (5 × 2)
- AC-4.1.c: Argument handling tests pass → Commands correctly process input arguments
- AC-4.1.d: Output format tests pass → Responses match `CommandResponse` interface
- AC-4.1.e: Error handling tests pass → Failed commands return errors, not throw exceptions
- AC-4.1.f: Session isolation tests pass → Provider change requires restart
- AC-4.1.g: Settings persistence tests pass → Provider preference survives extension reload
- AC-4.1.h: Installation detection tests pass → `isInstalled()` accurate for both providers

**Acceptance Tests**

- Test-4.1.a: Suite test validates provider iteration → Both providers tested
- Test-4.1.b: Coverage test validates command count → 10 command tests present
- Test-4.1.c: Argument test validates parameter passing → Mock args reach command execution
- Test-4.1.d: Interface test validates response structure → Response objects match interface
- Test-4.1.e: Exception test validates error handling → No unhandled exceptions thrown
- Test-4.1.f: Isolation test validates restart requirement → Provider change blocked mid-session
- Test-4.1.g: Persistence test validates storage → Mock workspace state confirms persistence
- Test-4.1.h: Detection test validates installation check → Mock CLI presence check accurate

---

### 4.2 Manual Testing Scenarios & Test Plan

Define comprehensive manual testing scenarios to validate real-world usage.

**Implementation Details**

- **File**: Create `/docs/testing/manual-test-plan.md`
- **Test Environment Setup**:
  1. Clean VSCode workspace (no existing provider settings)
  2. Both Claude Code and Goose installed locally
  3. GitHub authentication configured
  4. Test repository with existing GitHub Projects
- **Test Scenarios**:

  **Scenario 1: First-Time User (Default Claude Code)**
  1. Install extension
  2. Open test workspace
  3. Verify default provider is Claude Code
  4. Execute `/project-start` command
  5. Verify command executes successfully
  6. Verify results match expected output

  **Scenario 2: Switch to Goose Provider**
  1. Click settings gear icon
  2. Select "Goose" from dropdown
  3. Click Save
  4. Verify reload prompt appears
  5. Click "Reload Now"
  6. Verify extension reloads
  7. Verify provider changed to Goose
  8. Execute `/project-start` command
  9. Verify command executes via Goose
  10. Compare output with Claude Code version

  **Scenario 3: Goose Not Installed**
  1. Uninstall Goose CLI
  2. Switch provider to Goose via settings
  3. Verify error message appears with installation instructions
  4. Verify link to installation guide clickable
  5. Verify provider not changed

  **Scenario 4: Recipe Installation**
  1. Open Command Palette
  2. Run "Stoked Projects: Install Goose Recipes"
  3. Verify progress notification appears
  4. Verify success message shows installed commands
  5. Verify recipes present in `~/.config/goose/recipes/stoked-projects/`
  6. Verify config.yaml updated with custom commands

  **Scenario 5: Mid-Session Provider Change Blocked**
  1. Start Claude Code session with `/project-start`
  2. While session running, open settings
  3. Attempt to switch to Goose
  4. Verify warning message about active session
  5. Confirm change
  6. Verify session terminated
  7. Verify reload prompt appears

  **Scenario 6: All Commands Feature Parity**
  - For each command (`/project-create`, `/project-start`, `/review-item`, `/review-phase`, `/review-project`):
    1. Execute with Claude Code provider
    2. Record output and execution time
    3. Switch to Goose provider
    4. Execute same command with identical arguments
    5. Record output and execution time
    6. Compare outputs for functional equivalence
    7. Verify both produce correct results

  **Scenario 7: Settings Persistence**
  1. Set provider to Goose
  2. Reload window
  3. Close VSCode
  4. Reopen workspace
  5. Verify provider still set to Goose
  6. Switch to different workspace
  7. Verify provider resets to default (Claude Code)

- **Pass/Fail Criteria**: Each scenario must pass 100% of steps
- **Bug Tracking**: Document any failures with reproduction steps, expected vs. actual behavior

**Acceptance Criteria**

- AC-4.2.a: Test plan document created → File exists with all scenarios documented
- AC-4.2.b: All 7 scenarios executable → Test environment setup instructions complete
- AC-4.2.c: Pass/fail criteria defined → Each scenario has clear success conditions
- AC-4.2.d: Test execution completed → All scenarios tested by QA team
- AC-4.2.e: Zero P0 bugs found → No critical failures blocking release
- AC-4.2.f: Feature parity validated → Both providers produce equivalent results
- AC-4.2.g: Performance acceptable → Command execution time within 10% variance between providers

**Acceptance Tests**

- Test-4.2.a: Document test validates completeness → All required sections present
- Test-4.2.b: Setup test validates environment → Test environment reproducible
- Test-4.2.c: Criteria test validates clarity → Pass/fail conditions unambiguous
- Test-4.2.d: Execution test validates coverage → All scenarios tested manually
- Test-4.2.e: Bug test validates quality → Zero P0 bugs in bug tracker
- Test-4.2.f: Parity test validates equivalence → Output comparison shows functional equivalence
- Test-4.2.g: Performance test validates speed → Execution time variance < 10%

---

### 4.3 Recipe Functional Validation

Validate each Goose recipe produces correct results matching Claude command behavior.

**Implementation Details**

- **File**: Create `/apps/code-ext/src/test/recipes/recipe-validation.test.ts`
- **Validation Strategy**:
  1. **Isolated Recipe Testing**: Test each recipe independently with mock inputs
  2. **Baseline Comparison**: Compare Goose recipe outputs with Claude command outputs (fixtures)
  3. **Edge Case Testing**: Test boundary conditions, invalid inputs, error cases
  4. **Integration Testing**: Test recipes with real GitHub API calls (integration test environment)
- **Test Data**: Create fixture files for each command in `/apps/code-ext/src/test/fixtures/`:
  - `project-create-input.json` - Sample problem descriptions
  - `project-create-output-claude.json` - Expected Claude output
  - `project-create-output-goose.json` - Expected Goose output (should match Claude semantically)
  - Repeat for all 5 commands
- **Validation Checks**:
  1. **Output Structure**: Goose recipes return required fields (project number, URLs, etc.)
  2. **Data Accuracy**: GitHub entities created correctly (projects, issues, etc.)
  3. **Error Messages**: Recipe errors include actionable information
  4. **Side Effects**: No unintended GitHub entities created/modified
  5. **Idempotency**: Re-running recipes with same input produces consistent results
- **GitHub API Mocking**: Use `nock` or similar to mock GitHub GraphQL API responses
- **CI Integration**: Run recipe validation in CI pipeline before merge

**Acceptance Criteria**

- AC-4.3.a: All 5 recipes tested in isolation → Individual recipe tests pass
- AC-4.3.b: Recipe outputs match Claude baseline → Semantic equivalence validated
- AC-4.3.c: Edge cases handled correctly → Invalid inputs return errors, not crashes
- AC-4.3.d: Integration tests pass with real GitHub API → Recipes create correct GitHub entities
- AC-4.3.e: Error messages actionable → Recipe failures include troubleshooting information
- AC-4.3.f: No side effects detected → Only expected GitHub entities created
- AC-4.3.g: Idempotency validated → Re-running recipes produces consistent results

**Acceptance Tests**

- Test-4.3.a: Isolation test validates individual recipes → Each recipe test passes independently
- Test-4.3.b: Baseline test validates output equivalence → Diff tool shows semantic match with Claude
- Test-4.3.c: Edge case test validates error handling → Invalid inputs handled gracefully
- Test-4.3.d: Integration test validates GitHub operations → Mock GitHub API returns expected responses
- Test-4.3.e: Error message test validates content → Error strings include actionable steps
- Test-4.3.f: Side effect test validates GitHub state → Only expected entities present after test
- Test-4.3.g: Idempotency test validates consistency → Multiple runs produce identical results

---

### 4.4 Performance & Stability Testing

Benchmark provider performance and validate system stability under various conditions.

**Implementation Details**

- **Performance Benchmarks**:
  1. **Command Execution Time**: Measure average execution time for each command with both providers
  2. **Provider Switch Time**: Measure time from settings save to reload completion
  3. **Extension Activation Time**: Measure time to activate extension with provider initialization
  4. **Memory Usage**: Monitor extension memory footprint with both providers
  5. **CPU Usage**: Monitor CPU usage during command execution
- **Stability Tests**:
  1. **Rapid Provider Switching**: Switch providers repeatedly, verify no memory leaks
  2. **Concurrent Command Execution**: Run multiple commands simultaneously (should queue)
  3. **Network Failure Handling**: Simulate network errors during GitHub API calls
  4. **Provider Crash Recovery**: Kill provider process mid-execution, verify extension recovers
  5. **Long-Running Sessions**: Run 10+ consecutive commands, verify no performance degradation
- **Test Tools**:
  - VSCode extension profiler for memory/CPU monitoring
  - Custom performance harness to measure execution times
  - Network throttling via Charles Proxy or similar
- **Acceptance Thresholds**:
  - Command execution time: < 30 seconds for simple commands, < 5 minutes for complex commands
  - Provider switch time: < 2 seconds (reload excluded)
  - Extension activation time: < 500ms
  - Memory usage: < 100MB baseline, < 200MB during command execution
  - CPU usage: < 10% idle, < 50% during command execution
  - No memory leaks: Memory returns to baseline after command completion

**Acceptance Criteria**

- AC-4.4.a: Command execution times within thresholds → All commands complete within acceptable time
- AC-4.4.b: Provider switch completes within 2 seconds → Settings save to confirmation < 2s
- AC-4.4.c: Extension activation within 500ms → Extension ready after activation < 500ms
- AC-4.4.d: Memory usage within limits → Baseline < 100MB, execution < 200MB
- AC-4.4.e: No memory leaks detected → Memory returns to baseline after commands
- AC-4.4.f: CPU usage within limits → Idle < 10%, execution < 50%
- AC-4.4.g: Stability tests pass → No crashes during stress testing

**Acceptance Tests**

- Test-4.4.a: Performance test measures execution time → Benchmark results within thresholds
- Test-4.4.b: Switch test measures provider change time → Timer confirms < 2s completion
- Test-4.4.c: Activation test measures startup time → Profiler confirms < 500ms activation
- Test-4.4.d: Memory test measures footprint → Profiler confirms memory usage within limits
- Test-4.4.e: Leak test validates memory cleanup → Memory returns to baseline after GC
- Test-4.4.f: CPU test measures processor usage → Profiler confirms CPU usage within limits
- Test-4.4.g: Stability test validates crash recovery → Extension recovers from all failure scenarios

---

## Phase 5: Documentation, Polish & Release

**Purpose:** Finalize documentation, polish user experience, and prepare for release. This phase ensures users can successfully adopt the feature, understand provider differences, and troubleshoot common issues. All release artifacts must be production-ready before merge.

### 5.1 Create User-Facing Documentation

Write comprehensive documentation for end users covering provider setup, usage, and troubleshooting.

**Implementation Details**

- **File**: Update `/apps/code-ext/README.md` with new sections:

  **Section 1: LLM Provider Support**
  ```markdown
  ## LLM Provider Support

  This extension supports two LLM providers:

  - **Claude Code** (Default): Anthropic's official CLI for Claude
  - **Goose**: Open-source AI agent supporting multiple LLMs

  ### Choosing a Provider

  1. Click the settings gear icon (⚙️) in the extension toolbar
  2. Select your preferred provider from the dropdown
  3. Click "Save" and reload the VSCode window

  ### Provider Comparison

  | Feature | Claude Code | Goose |
  |---------|-------------|-------|
  | Installation | Download from claude.ai | `brew install goose` |
  | LLM Support | Claude models only | Claude, GPT-4, local models |
  | Open Source | No | Yes (Linux Foundation) |
  | Custom Extensions | Limited | Highly extensible |
  | Recipe Support | .md commands | YAML recipes |
  ```

  **Section 2: Installation Instructions**
  ```markdown
  ## Installation

  ### Claude Code (Default)

  1. Download from: https://claude.ai/download
  2. Install the CLI
  3. Authenticate: `claude auth`

  ### Goose

  1. Install via Homebrew: `brew install goose`
  2. Install extension recipes:
     - Open Command Palette (Cmd+Shift+P)
     - Run "Stoked Projects: Install Goose Recipes"
  3. Verify installation: `goose --version`
  ```

  **Section 3: Troubleshooting**
  ```markdown
  ## Troubleshooting

  ### "Provider not installed" error

  - **Claude Code**: Install from https://claude.ai/download
  - **Goose**: Run `brew install goose`

  ### Goose recipes not found

  Run the installation command:
  1. Open Command Palette (Cmd+Shift+P)
  2. Run "Stoked Projects: Install Goose Recipes"
  3. Verify recipes in ~/.config/goose/recipes/stoked-projects/

  ### Commands not working after provider switch

  Reload the VSCode window:
  - Command Palette → "Developer: Reload Window"
  - Or click "Reload Now" in the notification
  ```

- **Additional Files**:
  - Create `/docs/provider-migration-guide.md`: Step-by-step guide for switching providers
  - Create `/docs/goose-setup-guide.md`: Detailed Goose installation and configuration
  - Update `/CHANGELOG.md`: Document new provider support feature

**Acceptance Criteria**

- AC-5.1.a: README updated with provider documentation → All sections present and accurate
- AC-5.1.b: Provider comparison table complete → Feature parity clearly documented
- AC-5.1.c: Installation instructions validated → Instructions tested by non-developer
- AC-5.1.d: Troubleshooting covers common issues → Top 5 issues documented with solutions
- AC-5.1.e: Migration guide provides step-by-step process → Guide tested by external user
- AC-5.1.f: Goose setup guide covers recipe installation → All setup steps documented
- AC-5.1.g: CHANGELOG documents feature → Release notes include provider support

**Acceptance Tests**

- Test-5.1.a: Documentation review validates completeness → All required sections present
- Test-5.1.b: Comparison test validates accuracy → Feature parity table matches implementation
- Test-5.1.c: Installation test follows guide → Non-developer successfully installs both providers
- Test-5.1.d: Troubleshooting test validates solutions → Common issues resolved by following guide
- Test-5.1.e: Migration test validates guide → External user successfully switches providers
- Test-5.1.f: Setup test validates Goose guide → User successfully installs recipes
- Test-5.1.g: Changelog test validates release notes → Version increment and feature documented

---

### 5.2 Implement Enhanced Error Messages & Installation Wizard

Improve user experience with actionable error messages and guided installation flow.

**Implementation Details**

- **Enhanced Error Messages** (file: `/apps/code-ext/src/providers/error-handler.ts`):
  ```typescript
  export class ProviderErrorHandler {
    static handleProviderNotInstalled(providerName: string): ErrorResponse {
      const provider = ProviderRegistry.getInstance().getProvider(providerName);
      return {
        title: `${provider.displayName} Not Installed`,
        message: provider.getInstallationInstructions(),
        actions: [
          { label: 'Open Installation Guide', url: provider.getInstallationUrl() },
          { label: 'Switch to Claude Code', command: 'switchProvider', args: { provider: 'claudeCode' } }
        ]
      };
    }

    static handleRecipesNotInstalled(): ErrorResponse {
      return {
        title: 'Goose Recipes Not Installed',
        message: 'The extension recipes for Goose are not installed. Install them now?',
        actions: [
          { label: 'Install Recipes', command: 'claudeProjects.installGooseRecipes' },
          { label: 'Manual Installation', url: 'https://docs/goose-setup-guide.md' }
        ]
      };
    }

    static handleCommandFailed(command: string, error: string): ErrorResponse {
      return {
        title: `Command Failed: ${command}`,
        message: error,
        actions: [
          { label: 'View Logs', command: 'claudeProjects.viewLogs' },
          { label: 'Report Issue', url: 'https://github.com/YOUR-REPO/issues/new' }
        ]
      };
    }
  }
  ```

- **Installation Wizard** (file: `/apps/code-ext/src/setup/installation-wizard.ts`):
  - Multi-step wizard UI for first-time Goose setup:
    1. Welcome screen explaining provider options
    2. Goose CLI installation check (with installation link if missing)
    3. Recipe installation step (one-click install)
    4. Config validation step (verify setup)
    5. Test command step (run simple test command)
    6. Completion screen with next steps
  - Triggered when user selects Goose but setup incomplete
  - Can be re-run via Command Palette: "Stoked Projects: Run Setup Wizard"

- **Webview Error Display** (file: `/apps/code-ext/media/main.js`):
  - Rich error modals with action buttons
  - Error styling: Red icon, bold title, detailed message, action buttons
  - Error persistence: Errors saved to state, re-displayed on reload

**Acceptance Criteria**

- AC-5.2.a: Enhanced error handler implemented → All error types have dedicated handlers
- AC-5.2.b: Error messages include actionable buttons → Errors display "Open Guide" or "Install" buttons
- AC-5.2.c: Installation wizard accessible via Command Palette → Command "Run Setup Wizard" available
- AC-5.2.d: Wizard guides through all setup steps → All 6 steps displayed in sequence
- AC-5.2.e: Wizard validates each step → User cannot proceed without completing step
- AC-5.2.f: Wizard test command succeeds → Test command executes and displays success
- AC-5.2.g: Error modal styling matches extension theme → Consistent visual design

**Acceptance Tests**

- Test-5.2.a: Error handler test validates all error types → All handlers return valid responses
- Test-5.2.b: Action button test validates button functionality → Buttons trigger correct actions
- Test-5.2.c: Command palette test validates wizard availability → Wizard command appears in palette
- Test-5.2.d: Wizard test validates step sequence → All 6 steps displayed in order
- Test-5.2.e: Validation test validates step completion → Incomplete steps block progression
- Test-5.2.f: Test command test validates execution → Mock test command succeeds
- Test-5.2.g: Styling test validates theme consistency → Visual review confirms design match

---

### 5.3 Add Telemetry & Analytics (Optional)

Implement optional usage analytics to understand provider adoption and feature usage.

**Implementation Details**

- **Telemetry Events**:
  1. `provider.selected`: User selects provider in settings (includes provider name)
  2. `provider.switched`: User switches from one provider to another
  3. `command.executed`: Command executed (includes command name, provider, success/failure)
  4. `recipes.installed`: Goose recipes installed via wizard/command
  5. `error.occurred`: Error encountered (includes error type, provider)
- **Privacy**:
  - All telemetry opt-in (disabled by default)
  - No PII collected (no file paths, repo names, user identifiers)
  - Configurable via VSCode setting: `claudeProjects.telemetry.enabled`
  - Respects VSCode global telemetry setting
- **Implementation** (file: `/apps/code-ext/src/telemetry/telemetry-client.ts`):
  ```typescript
  export class TelemetryClient {
    private enabled: boolean;

    constructor(context: vscode.ExtensionContext) {
      const config = vscode.workspace.getConfiguration('claudeProjects');
      this.enabled = config.get('telemetry.enabled', false) && vscode.env.isTelemetryEnabled;
    }

    track(event: string, properties?: Record<string, any>) {
      if (!this.enabled) return;

      // Send to analytics service (e.g., Application Insights, PostHog, etc.)
      // Anonymize all properties before sending
    }
  }
  ```
- **Dashboard**: (Out of scope for MVP) Create analytics dashboard to visualize provider adoption
- **Disclosure**: Add telemetry disclosure to README and settings UI

**Acceptance Criteria**

- AC-5.3.a: Telemetry opt-in setting available → Setting `claudeProjects.telemetry.enabled` in package.json
- AC-5.3.b: Telemetry respects VSCode global setting → Disabled if VSCode telemetry disabled
- AC-5.3.c: No PII collected → Code review confirms no sensitive data in events
- AC-5.3.d: All telemetry events implemented → 5 event types tracked
- AC-5.3.e: Telemetry disclosure in README → Privacy policy section added
- AC-5.3.f: Telemetry disabled by default → Default setting value is `false`

**Acceptance Tests**

- Test-5.3.a: Setting test validates configuration → Setting appears in VSCode settings
- Test-5.3.b: Global setting test validates override → VSCode telemetry disabled overrides extension setting
- Test-5.3.c: PII test validates data sanitization → Event properties contain no PII
- Test-5.3.d: Event test validates tracking → All 5 event types triggered during tests
- Test-5.3.e: Documentation test validates disclosure → Privacy policy section present in README
- Test-5.3.f: Default test validates opt-in → Setting defaults to `false`

---

### 5.4 Final Build, Packaging & Release Preparation

Prepare production build, create release artifacts, and finalize deployment.

**Implementation Details**

- **Build Process**:
  1. Run full test suite: `pnpm run test`
  2. Run linter: `pnpm run lint`
  3. Fix any TypeScript compilation errors
  4. Build extension: `pnpm run build`
  5. Package extension: `pnpm run package` (creates `.vsix` file)
- **Version Bump**:
  - Update version in `package.json` (semantic versioning: major.minor.patch)
  - Update `CHANGELOG.md` with release notes
  - Create git tag: `git tag v1.2.0`
- **Release Artifacts**:
  - Extension package: `stoked-projects-vscode-1.2.0.vsix`
  - Release notes: Extract from `CHANGELOG.md`
  - Installation guide: `docs/installation.md`
  - Migration guide: `docs/provider-migration-guide.md`
- **Pre-Release Validation**:
  - Install `.vsix` in clean VSCode instance
  - Test all 5 commands with both providers
  - Verify settings UI functional
  - Verify installation wizard functional
  - Test on macOS, Linux, Windows (if available)
- **Release Channels**:
  - VSCode Marketplace (primary)
  - GitHub Releases (backup)
  - Internal distribution (if applicable)
- **Deployment Steps**:
  1. Publish to VSCode Marketplace: `vsce publish`
  2. Create GitHub release with artifacts
  3. Update extension homepage/documentation site
  4. Announce release (blog post, Twitter, etc.)

**Acceptance Criteria**

- AC-5.4.a: All tests pass → Test suite returns zero failures
- AC-5.4.b: Linter passes → Zero linting errors
- AC-5.4.c: Build succeeds → TypeScript compilation completes without errors
- AC-5.4.d: Package created → `.vsix` file generated successfully
- AC-5.4.e: Version bumped → `package.json` and `CHANGELOG.md` updated
- AC-5.4.f: Release artifacts complete → All required files present
- AC-5.4.g: Pre-release validation passes → All manual tests succeed on `.vsix` install
- AC-5.4.h: Published to VSCode Marketplace → Extension available for download

**Acceptance Tests**

- Test-5.4.a: Test suite run validates pass → CI pipeline green
- Test-5.4.b: Linter run validates no errors → `pnpm run lint` exits with code 0
- Test-5.4.c: Build test validates compilation → `pnpm run build` exits with code 0
- Test-5.4.d: Package test validates `.vsix` creation → File exists and has correct structure
- Test-5.4.e: Version test validates updates → Version numbers match across all files
- Test-5.4.f: Artifact test validates completeness → All release files present
- Test-5.4.g: Validation test validates functionality → Manual test plan passes on `.vsix`
- Test-5.4.h: Publish test validates marketplace availability → Extension searchable on marketplace

---

### 5.5 Post-Release Monitoring & Support

Set up monitoring, support channels, and feedback collection for post-release phase.

**Implementation Details**

- **Monitoring**:
  - Monitor VSCode Marketplace reviews and ratings
  - Track GitHub issues tagged with `provider` or `goose`
  - Monitor telemetry dashboard (if implemented in 5.3)
  - Track download/install metrics from marketplace
- **Support Channels**:
  - GitHub Issues: Primary support channel
  - VSCode Marketplace Q&A: Monitor and respond
  - Discord/Slack community (if available): Answer questions
  - Email support (if applicable): Respond within 48 hours
- **Feedback Collection**:
  - Create GitHub Discussions category: "Provider Feedback"
  - Add feedback prompt in extension (one-time, dismissible):
    - "You're using Goose provider. Share your feedback?"
    - Links to feedback form or GitHub Discussions
  - Monitor community sentiment (social media, Reddit, HackerNews, etc.)
- **Bug Triage**:
  - Priority levels: P0 (critical/blocking), P1 (major), P2 (minor), P3 (enhancement)
  - P0 bugs: Fix within 24 hours, publish hotfix
  - P1 bugs: Fix within 1 week, include in patch release
  - P2/P3: Schedule for next minor release
- **Documentation Updates**:
  - Maintain FAQ based on common support questions
  - Update troubleshooting guide with new issues
  - Create video tutorials (optional, post-release)

**Acceptance Criteria**

- AC-5.5.a: Monitoring system in place → Team receives notifications for new issues/reviews
- AC-5.5.b: Support channels active → All channels monitored daily
- AC-5.5.c: Feedback mechanism live → Feedback form/discussions accessible
- AC-5.5.d: Bug triage process defined → Priority levels and SLAs documented
- AC-5.5.e: FAQ maintained → Top 10 questions documented with answers
- AC-5.5.f: Response time met → Support responses within 48 hours for 90% of queries

**Acceptance Tests**

- Test-5.5.a: Monitoring test validates notifications → Test issue triggers team alert
- Test-5.5.b: Channel test validates coverage → All support channels checked daily
- Test-5.5.c: Feedback test validates accessibility → Feedback form/link functional
- Test-5.5.d: Triage test validates process → Bug assigned priority within 24 hours
- Test-5.5.e: FAQ test validates coverage → FAQ answers top 10 questions
- Test-5.5.f: Response test validates SLA → 90% of queries answered within 48 hours

---

## 3. Completion Criteria

The project is considered complete when:

1. **All Phase Acceptance Criteria Pass**: Every acceptance criterion from Phases 1-5 validated and passing
2. **All Acceptance Tests Green**: Automated test suite returns zero failures for both providers
3. **Zero P0/P1 Bugs**: No critical or major bugs in bug tracker blocking release
4. **Documentation Complete**: All user-facing documentation written, reviewed, and published
5. **Manual Test Plan Passes**: All 7 manual testing scenarios pass 100% of steps
6. **Feature Parity Validated**: Both Claude Code and Goose providers produce functionally equivalent results for all 5 commands
7. **Performance Benchmarks Met**: All performance thresholds met (execution time, memory usage, CPU usage)
8. **Backward Compatibility Confirmed**: Existing Claude Code users experience zero breaking changes
9. **Release Artifacts Ready**: Extension packaged as `.vsix`, release notes finalized, marketplace listing updated
10. **Published to Marketplace**: Extension live on VSCode Marketplace and available for download

---

## 4. Rollout & Validation

### Rollout Strategy

**Phase 1: Internal Alpha (Week 1)**
- Distribute `.vsix` to development team
- Test on various machines (macOS, Linux, Windows)
- Collect feedback on settings UI, provider switching, error messages
- Fix critical bugs before beta

**Phase 2: Closed Beta (Week 2)**
- Invite 10-20 external users via GitHub Discussions
- Provide pre-release `.vsix` and installation instructions
- Collect structured feedback via survey
- Monitor telemetry data (if opt-in enabled)
- Fix P1 bugs before public release

**Phase 3: Public Release (Week 3)**
- Publish to VSCode Marketplace
- Announce on GitHub, social media, blog post
- Monitor marketplace reviews and GitHub issues
- Prepare hotfix pipeline for P0 bugs

**Phase 4: Gradual Adoption (Weeks 4-8)**
- Track provider adoption metrics (target: 50% trial rate within 30 days)
- Collect user feedback and feature requests
- Plan follow-up enhancements (additional providers, improved recipes, etc.)

### Feature Flags

- **Goose Provider Visibility**: Initially hidden behind `claudeProjects.experimental.gooseProvider` setting
- **Telemetry**: Opt-in only, disabled by default
- **Installation Wizard**: Enabled for all users (non-experimental)

### Post-Launch Validation

**Success Metrics (30 days post-release)**
- **Adoption Rate**: 50% of active users try Goose provider option
- **Zero Regression**: 100% test pass rate, no P0/P1 bugs
- **Feature Parity**: 90% equivalent functionality between providers (user-reported)
- **Provider Switch Time**: < 2 seconds average (telemetry data)
- **Support Volume**: < 10 provider-related support tickets per week
- **Marketplace Rating**: Maintain 4.5+ star rating

**Monitoring Dashboard**
- Daily active users (DAU) by provider
- Command execution success rate by provider
- Average command execution time by provider
- Error rate by error type
- Provider switch count per day
- Recipe installation success rate

**Rollback Triggers**
- Marketplace rating drops below 4.0 stars
- > 5 P0 bugs reported within 48 hours
- Provider execution success rate < 90%
- Extension activation failure rate > 5%
- Memory leak detected (memory usage > 500MB)

**Rollback Plan**
1. Revert to previous marketplace version
2. Publish hotfix disabling Goose provider (revert to Claude Code only)
3. Notify users via marketplace changelog
4. Fix issues in development branch
5. Re-release after validation

---

## 5. Open Questions

### Outstanding Questions

| Question | Impact | Owner | Target Resolution | Status |
|----------|--------|-------|------------------|--------|
| What version of Goose should we target for compatibility? | Medium | Development Team | Phase 3, Week 1 | Open |
| Should we maintain separate recipe repositories or fork Goose recipes? | Medium | Development Team | Phase 3, Week 1 | Open |
| How do we handle Goose config.yaml conflicts with user's existing config? | Low | Development Team | Phase 3, Week 2 | Open |
| Should settings gear icon have tooltip for first-time users? | Low | UX Team | Phase 1, Week 2 | Open |
| Do we need telemetry to track provider usage (opt-in)? | Low | Product Team | Phase 5, Week 1 | Open |
| Should we support provider-specific advanced settings in future releases? | Low | Product Team | Post-MVP | Open |
| What's the migration path if Goose recipe format changes significantly? | Medium | Development Team | Phase 3, Week 1 | Open |
| Should we create video tutorials for provider setup? | Low | Marketing Team | Post-Release | Open |
| Do we need a migration assistant wizard for Claude → Goose users? | Low | Product Team | Post-MVP | Open |
| Should installation wizard be skippable for advanced users? | Low | UX Team | Phase 5, Week 1 | Open |

### Resolved Questions

| Question | Answer | Decided By | Date |
|----------|--------|-----------|------|
| How should the extension handle switching providers mid-session? | Requires starting new session (cannot switch mid-session) | Product Team | 2026-01-26 |
| Should settings persist per workspace or globally? | Per workspace (stored in workspaceState) | Product Team | 2026-01-26 |
| What's the fallback behavior if Goose is selected but not installed? | Show error message with installation instructions | Product Team | 2026-01-26 |
| Should there be a migration assistant for existing Claude users? | Not in initial release (can be added later) | Product Team | 2026-01-26 |
| How should we handle provider-specific features that don't have equivalents? | Mark as unavailable with clear messaging | Product Team | 2026-01-26 |
| Should telemetry be opt-in or opt-out? | Opt-in only, disabled by default | Product Team | 2026-01-26 |
| What's the default provider for new workspaces? | Claude Code (maintains backward compatibility) | Product Team | 2026-01-26 |

---

**Document Version**: 1.0
**Status**: Draft - Ready for Implementation
**Total Estimated Duration**: 3-5 weeks (with parallel workstreams)
**Prerequisites**: VSCode 1.96.0+, Claude Code CLI, Goose CLI (for testing)
