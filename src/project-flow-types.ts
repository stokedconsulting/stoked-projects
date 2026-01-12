/**
 * TypeScript interfaces and types for the extension-driven /project flow
 */

/**
 * Input type detection
 */
export type InputType = 'file' | 'markup' | 'text';

export interface FilePathDetection {
    isFilePath: boolean;
    resolvedPath?: string;
    exists?: boolean;
    extension?: string;
}

export interface TypeaheadResult {
    path: string;
    type: 'file' | 'directory';
    extension?: string;
    score: number; // For ranking preferred extensions
}

export interface ExtractedInput {
    type: InputType;
    content: string;
    metadata?: {
        filePath?: string;
        fileType?: string;
    };
}

/**
 * Flow state management
 */
export type FlowPhase = 'input' | 'design' | 'structure' | 'creation' | 'complete';

export interface DesignIteration {
    prompt: string;
    result: string;
    timestamp: Date;
}

export interface DesignIterationState {
    iterations: DesignIteration[];
    currentResult: string;
    userPreferences: {
        skipProductReview: boolean;
    };
}

export interface ProjectFlowSession {
    sessionId: string;
    startedAt: Date;
    currentPhase: FlowPhase;
    input: ExtractedInput;
    designIterations: DesignIterationState;
    structureIterations?: DesignIterationState;
    finalConfig?: ProjectCreationConfig;
}

/**
 * GitHub project creation
 */
export interface IssueDefinition {
    title: string;
    body: string;
    labels: string[];
}

/**
 * Represents a task that failed during project creation
 */
export interface FailedTask {
    task: IssueDefinition;
    error: string;
}

export interface ProjectCreationConfig {
    isPublic: boolean;
    repoOwner: string;
    repoName: string;
    projectTitle: string;
    epic: IssueDefinition;
    tasks: IssueDefinition[];
}

export interface ProjectCreationResult {
    projectNum: number;
    projectUrl: string;
    epicUrl: string;
    taskUrls: string[];
    /** Tasks that failed to create (project was partially successful) */
    failedTasks?: FailedTask[];
}

/**
 * User preferences
 */
export interface ProjectFlowPreferences {
    skipProductReview: boolean;
    defaultVisibility: 'private' | 'public';
    lastUsedRepo?: {
        owner: string;
        name: string;
    };
}

/**
 * Webview message types
 */
export interface ShowInputDialogMessage {
    type: 'showInputDialog';
}

export interface InputSubmittedMessage {
    type: 'inputSubmitted';
    input: string;
    detection: FilePathDetection;
}

export interface TypeaheadRequestMessage {
    type: 'typeaheadRequest';
    input: string;
}

export interface TypeaheadResponseMessage {
    type: 'typeaheadResponse';
    results: TypeaheadResult[];
}

export interface ShowDesignReviewMessage {
    type: 'showDesignReview';
    result: string;
    iteration: number;
}

export interface DesignFeedbackMessage {
    type: 'designFeedback';
    feedback: string;
    skipReview: boolean;
}

export interface DesignAcceptedMessage {
    type: 'designAccepted';
    skipReview: boolean;
}

export interface ShowProjectApprovalMessage {
    type: 'showProjectApproval';
    config: ProjectCreationConfig;
}

export interface ProjectApprovedMessage {
    type: 'projectApproved';
    isPublic: boolean;
}

export interface ProjectCreationProgressMessage {
    type: 'projectCreationProgress';
    step: string;
    current: number;
    total: number;
}

export interface ProjectCreatedMessage {
    type: 'projectCreated';
    result: ProjectCreationResult;
}

export interface FlowErrorMessage {
    type: 'flowError';
    error: string;
    recoverable: boolean;
    action?: string;
}

export type ProjectFlowMessage =
    | ShowInputDialogMessage
    | InputSubmittedMessage
    | TypeaheadRequestMessage
    | TypeaheadResponseMessage
    | ShowDesignReviewMessage
    | DesignFeedbackMessage
    | DesignAcceptedMessage
    | ShowProjectApprovalMessage
    | ProjectApprovedMessage
    | ProjectCreationProgressMessage
    | ProjectCreatedMessage
    | FlowErrorMessage;
