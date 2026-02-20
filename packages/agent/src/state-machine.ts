/**
 * Finite state machine governing agent lifecycle transitions.
 *
 * ZERO vscode imports — pure TypeScript with no external dependencies.
 */

import { AgentState, AgentEvent } from './types';

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Maps each state to the set of events it accepts and the resulting next state.
 */
const TRANSITIONS: Partial<Record<AgentState, Partial<Record<AgentEvent, AgentState>>>> = {
  [AgentState.Idle]: {
    QUEUE_HAS_WORK: AgentState.Claiming,
    QUEUE_EMPTY_IDEATE: AgentState.Ideating,
    PAUSE: AgentState.Paused,
    STOP: AgentState.Stopped,
  },
  [AgentState.Claiming]: {
    CLAIM_SUCCESS: AgentState.Working,
    CLAIM_FAILED: AgentState.Idle,
    STOP: AgentState.Stopped,
  },
  [AgentState.Working]: {
    EXECUTION_COMPLETE: AgentState.Reviewing,
    EXECUTION_ERROR: AgentState.Error,
    PAUSE: AgentState.Paused,
    STOP: AgentState.Stopped,
  },
  [AgentState.Reviewing]: {
    REVIEW_APPROVED: AgentState.Idle,
    REVIEW_REJECTED: AgentState.Working,
    REVIEW_ERROR: AgentState.Error,
    STOP: AgentState.Stopped,
  },
  [AgentState.Ideating]: {
    IDEA_GENERATED: AgentState.CreatingProject,
    NO_IDEA: AgentState.Idle,
    IDEATION_ERROR: AgentState.Error,
    STOP: AgentState.Stopped,
  },
  [AgentState.CreatingProject]: {
    PROJECT_CREATED: AgentState.Idle,
    CREATION_ERROR: AgentState.Error,
    STOP: AgentState.Stopped,
  },
  [AgentState.Error]: {
    ERROR_ACKNOWLEDGED: AgentState.Cooldown,
  },
  [AgentState.Cooldown]: {
    COOLDOWN_COMPLETE: AgentState.Idle,
  },
  [AgentState.Paused]: {
    RESUME: AgentState.Idle,
    STOP: AgentState.Stopped,
  },
  // AgentState.Stopped is terminal — no outgoing transitions
};

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when an event is dispatched that has no valid transition from the
 * current state.
 */
export class InvalidTransitionError extends Error {
  constructor(currentState: AgentState, event: AgentEvent) {
    super(
      `Invalid transition: cannot handle event '${event}' in state '${currentState}'`,
    );
    this.name = 'InvalidTransitionError';
  }
}

// ---------------------------------------------------------------------------
// State machine class
// ---------------------------------------------------------------------------

/**
 * Finite state machine that governs agent behavior.
 *
 * Usage:
 * ```ts
 * const fsm = new AgentStateMachine();
 * fsm.onTransition((from, to, event) => console.log(from, '->', to, 'via', event));
 * fsm.transition('QUEUE_HAS_WORK'); // Idle -> Claiming
 * ```
 */
export class AgentStateMachine {
  /** The state the machine is currently in. */
  public get currentState(): AgentState {
    return this._currentState;
  }

  private _currentState: AgentState = AgentState.Idle;
  private _listeners: Array<
    (from: AgentState, to: AgentState, event: AgentEvent) => void
  > = [];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Attempt to apply `event` to the current state.
   *
   * @returns The new `AgentState` after the transition.
   * @throws {InvalidTransitionError} When the event is not valid in the
   *   current state.
   */
  transition(event: AgentEvent): AgentState {
    const nextState = this._resolve(event);
    if (nextState === undefined) {
      throw new InvalidTransitionError(this._currentState, event);
    }

    const from = this._currentState;
    this._currentState = nextState;
    this._notify(from, nextState, event);
    return nextState;
  }

  /**
   * Returns `true` if `event` would produce a valid transition from the
   * current state. Does NOT modify state.
   */
  canTransition(event: AgentEvent): boolean {
    return this._resolve(event) !== undefined;
  }

  /**
   * Resets the machine back to the `Idle` state without firing any observers.
   */
  reset(): void {
    this._currentState = AgentState.Idle;
  }

  /**
   * Registers an observer that is called after every successful transition.
   *
   * @param callback Receives `(from, to, event)`.
   */
  onTransition(
    callback: (from: AgentState, to: AgentState, event: AgentEvent) => void,
  ): void {
    this._listeners.push(callback);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _resolve(event: AgentEvent): AgentState | undefined {
    const stateTransitions = TRANSITIONS[this._currentState];
    if (!stateTransitions) {
      return undefined;
    }
    return stateTransitions[event];
  }

  private _notify(from: AgentState, to: AgentState, event: AgentEvent): void {
    for (const listener of this._listeners) {
      listener(from, to, event);
    }
  }
}
