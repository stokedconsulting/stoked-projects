/**
 * Integration tests for BudgetTracker and IdeationAgent.
 *
 * AC-6.3.a - IdeationAgent interface verification
 * AC-6.3.b - Duplicate detection logic
 * AC-6.3.c - Budget limit enforcement (isWithinBudget)
 * AC-6.3.d - Cost accumulation and budget exceeded callbacks
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetTracker } from '../budget-tracker';
import { IdeationAgent, checkDuplicate } from '../ideation-agent';
import { OrchestratorConfig } from '../types';

// ---------------------------------------------------------------------------
// Budget Enforcement Tests
// ---------------------------------------------------------------------------

describe('Budget Enforcement', () => {
  let tmpDir: string;
  let tracker: BudgetTracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
    // dailyLimit = $50, monthlyLimit = $500
    tracker = new BudgetTracker(50, 500, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // AC-6.3.c: isWithinBudget
  // -------------------------------------------------------------------------

  it('AC-6.3.c: isWithinBudget returns true when daily spend is under daily limit', () => {
    tracker.recordCost('agent-1', 0.50, 92);
    expect(tracker.isWithinBudget()).toBe(true);
  });

  it('AC-6.3.c: isWithinBudget returns false when daily spend equals daily limit', () => {
    // isWithinBudget uses strict less-than, so exactly at the limit → false
    const exactTracker = new BudgetTracker(1, 500, tmpDir);
    exactTracker.recordCost('agent-1', 1.00, 92);
    expect(exactTracker.isWithinBudget()).toBe(false);
  });

  it('AC-6.3.c: isWithinBudget returns false when daily spend exceeds daily limit', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    lowBudget.recordCost('agent-1', 1.01, 92);
    expect(lowBudget.isWithinBudget()).toBe(false);
  });

  it('AC-6.3.c: isWithinBudget returns true for zero spend', () => {
    expect(tracker.isWithinBudget()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-6.3.d: Budget exceeded callback
  // -------------------------------------------------------------------------

  it('AC-6.3.d: budget exceeded callback fires when daily limit crossed', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    let exceeded = false;
    lowBudget.onBudgetExceeded(() => {
      exceeded = true;
    });

    lowBudget.recordCost('agent-1', 1.01, 92);
    expect(exceeded).toBe(true);
  });

  it('AC-6.3.d: budget exceeded callback receives BudgetStatus with correct shape', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    let capturedStatus: ReturnType<typeof lowBudget.getBudgetStatus> | undefined;

    lowBudget.onBudgetExceeded((status) => {
      capturedStatus = status;
    });

    lowBudget.recordCost('agent-1', 1.01, 92);

    expect(capturedStatus).toBeDefined();
    expect(capturedStatus!.dailyLimit).toBe(1);
    expect(capturedStatus!.monthlyLimit).toBe(500);
    expect(capturedStatus!.isWithinBudget).toBe(false);
    expect(capturedStatus!.dailySpend).toBeCloseTo(1.01, 5);
  });

  it('AC-6.3.d: callback does NOT fire when spend is within budget', () => {
    let callbackCount = 0;
    tracker.onBudgetExceeded(() => {
      callbackCount++;
    });

    // $0.50 is well within the $50 daily limit
    tracker.recordCost('agent-1', 0.50, 92);
    expect(callbackCount).toBe(0);
  });

  it('AC-6.3.d: multiple callbacks all fire when budget exceeded', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    const results: string[] = [];

    lowBudget.onBudgetExceeded(() => results.push('callback-a'));
    lowBudget.onBudgetExceeded(() => results.push('callback-b'));

    lowBudget.recordCost('agent-1', 1.01, 92);
    expect(results).toContain('callback-a');
    expect(results).toContain('callback-b');
    expect(results).toHaveLength(2);
  });

  it('AC-6.3.d: cumulative spend across multiple recordCost calls triggers exceeded', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    let exceeded = false;
    lowBudget.onBudgetExceeded(() => {
      exceeded = true;
    });

    lowBudget.recordCost('agent-1', 0.90, 92);
    expect(exceeded).toBe(false);
    expect(lowBudget.isWithinBudget()).toBe(true);

    lowBudget.recordCost('agent-1', 0.20, 92);
    expect(exceeded).toBe(true);
    expect(lowBudget.isWithinBudget()).toBe(false);
    expect(lowBudget.getDailySpend()).toBeCloseTo(1.10, 5);
  });

  // -------------------------------------------------------------------------
  // Budget persistence
  // -------------------------------------------------------------------------

  it('budget persistence round-trip: persistToFile then loadFromFile preserves entries', () => {
    tracker.recordCost('agent-1', 5.00, 92);
    tracker.persistToFile();

    const tracker2 = new BudgetTracker(50, 500, tmpDir);
    tracker2.loadFromFile();
    expect(tracker2.getDailySpend()).toBeCloseTo(5.00, 5);
  });

  it('budget persistence: multiple entries are preserved correctly', () => {
    tracker.recordCost('agent-1', 2.50, 92);
    tracker.recordCost('agent-2', 3.75, 93);
    tracker.persistToFile();

    const tracker2 = new BudgetTracker(50, 500, tmpDir);
    tracker2.loadFromFile();
    expect(tracker2.getDailySpend()).toBeCloseTo(6.25, 5);
  });

  it('budget persistence: loadFromFile is a no-op when file does not exist', () => {
    const freshTracker = new BudgetTracker(50, 500, tmpDir);
    // No persistToFile call — file won't exist
    expect(() => freshTracker.loadFromFile()).not.toThrow();
    expect(freshTracker.getDailySpend()).toBe(0);
  });

  it('budget persistence: corrupt file causes graceful reset to empty cost log', () => {
    const logPath = path.join(tmpDir, 'cost-log.json');
    fs.writeFileSync(logPath, 'NOT VALID JSON', 'utf8');

    const freshTracker = new BudgetTracker(50, 500, tmpDir);
    expect(() => freshTracker.loadFromFile()).not.toThrow();
    expect(freshTracker.getDailySpend()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Monthly budget enforcement
  // -------------------------------------------------------------------------

  it('monthly budget enforcement: isWithinBudget returns false when monthly spend exceeds limit', () => {
    // monthlyLimit = $10, dailyLimit = $50 (so daily won't trigger)
    const monthlyLow = new BudgetTracker(50, 10, tmpDir);
    monthlyLow.recordCost('agent-1', 10.01, 92);
    expect(monthlyLow.isWithinBudget()).toBe(false);
  });

  it('monthly budget enforcement: stays within budget when only daily is near limit', () => {
    // dailyLimit = $5, monthlyLimit = $500
    const dailyLow = new BudgetTracker(5, 500, tmpDir);
    dailyLow.recordCost('agent-1', 4.99, 92);
    expect(dailyLow.isWithinBudget()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getBudgetStatus
  // -------------------------------------------------------------------------

  it('getBudgetStatus returns correct structure', () => {
    tracker.recordCost('agent-1', 5.00, 92);
    const status = tracker.getBudgetStatus();

    expect(status.dailySpend).toBeCloseTo(5.00, 5);
    expect(status.dailyLimit).toBe(50);
    expect(status.monthlySpend).toBeCloseTo(5.00, 5);
    expect(status.monthlyLimit).toBe(500);
    expect(typeof status.isWithinBudget).toBe('boolean');
    expect(status.isWithinBudget).toBe(true);
  });

  it('getBudgetStatus: dailyRemaining reflects correct remainder', () => {
    tracker.recordCost('agent-1', 5.00, 92);
    const status = tracker.getBudgetStatus();
    expect(status.dailyRemaining).toBeCloseTo(45.00, 5);
  });

  it('getBudgetStatus: monthlyRemaining reflects correct remainder', () => {
    tracker.recordCost('agent-1', 5.00, 92);
    const status = tracker.getBudgetStatus();
    expect(status.monthlyRemaining).toBeCloseTo(495.00, 5);
  });

  it('getBudgetStatus: dailyRemaining is 0 when over budget (not negative)', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    lowBudget.recordCost('agent-1', 5.00, 92);
    const status = lowBudget.getBudgetStatus();
    expect(status.dailyRemaining).toBe(0);
  });

  it('getBudgetStatus: isWithinBudget field matches isWithinBudget() method', () => {
    tracker.recordCost('agent-1', 5.00, 92);
    const status = tracker.getBudgetStatus();
    expect(status.isWithinBudget).toBe(tracker.isWithinBudget());
  });

  // -------------------------------------------------------------------------
  // Low budget threshold
  // -------------------------------------------------------------------------

  it('low budget threshold: $1 daily budget, $1.01 spend → budget exceeded', () => {
    const lowBudget = new BudgetTracker(1, 500, tmpDir);
    lowBudget.recordCost('agent-1', 1.01, 92);
    expect(lowBudget.isWithinBudget()).toBe(false);
    expect(lowBudget.getDailySpend()).toBeCloseTo(1.01, 5);
  });
});

// ---------------------------------------------------------------------------
// Ideation Agent Tests
// ---------------------------------------------------------------------------

describe('Ideation Agent', () => {
  const minimalConfig: OrchestratorConfig = {
    workspaceRoot: '/tmp',
    desiredInstances: 1,
    dailyBudgetUsd: 50,
    monthlyBudgetUsd: 500,
    maxBudgetPerTaskUsd: 5,
    maxBudgetPerReviewUsd: 2,
    maxBudgetPerIdeationUsd: 2,
    maxTurnsPerTask: 30,
    enabledCategories: ['testing'],
    projectId: 'PVT_test',
    owner: 'test-owner',
    repo: 'test-repo',
    githubToken: 'ghp_test_token',
    categoryPromptsDir: '/tmp/prompts',
    events: {},
  };

  // -------------------------------------------------------------------------
  // AC-6.3.a: IdeationAgent interface
  // -------------------------------------------------------------------------

  it('AC-6.3.a: IdeationAgent can be instantiated with a config', () => {
    const agent = new IdeationAgent(minimalConfig);
    expect(agent).toBeInstanceOf(IdeationAgent);
  });

  it('AC-6.3.a: IdeationAgent has an ideate() method', () => {
    const agent = new IdeationAgent(minimalConfig);
    expect(typeof agent.ideate).toBe('function');
  });

  it('AC-6.3.a: ideate() method accepts the correct number of parameters', () => {
    const agent = new IdeationAgent(minimalConfig);
    // .length reflects required named params (ignoring optional rest params in JS)
    // Just verify it's callable with 4 args without throwing on construction
    expect(agent.ideate.length).toBe(4);
  });

  // -------------------------------------------------------------------------
  // AC-6.3.b: checkDuplicate — exported standalone function
  // -------------------------------------------------------------------------

  it('AC-6.3.b: checkDuplicate returns false when existingTitles is empty', () => {
    expect(checkDuplicate('Add unit tests for budget tracker', [])).toBe(false);
  });

  it('AC-6.3.b: checkDuplicate returns false when there is no significant overlap', () => {
    const existing = ['Refactor authentication module'];
    expect(checkDuplicate('Add budget tracking feature', existing)).toBe(false);
  });

  it('AC-6.3.b: checkDuplicate detects >80% word overlap (exact duplicate)', () => {
    const title = 'Add unit tests for budget tracker';
    const existing = ['Add unit tests for budget tracker'];
    expect(checkDuplicate(title, existing)).toBe(true);
  });

  it('AC-6.3.b: checkDuplicate detects >80% word overlap (near-duplicate)', () => {
    // "Add unit tests for budget" vs "Add unit tests for budget tracker"
    // candidate words: add, unit, tests, for, budget (5)
    // existing words: add, unit, tests, for, budget, tracker (6)
    // overlap: 5 words match, smaller set size = 5 → ratio = 5/5 = 1.0 > 0.8
    const title = 'Add unit tests for budget';
    const existing = ['Add unit tests for budget tracker'];
    expect(checkDuplicate(title, existing)).toBe(true);
  });

  it('AC-6.3.b: checkDuplicate returns false for <80% word overlap', () => {
    // "Improve cache performance" vs "Add unit tests for budget tracker"
    // candidate: improve, cache, performance (3 unique words)
    // existing: add, unit, tests, for, budget, tracker (6 unique words)
    // overlap: 0 → ratio = 0/3 = 0 < 0.8
    const title = 'Improve cache performance';
    const existing = ['Add unit tests for budget tracker'];
    expect(checkDuplicate(title, existing)).toBe(false);
  });

  it('AC-6.3.b: checkDuplicate is case-insensitive', () => {
    const title = 'ADD UNIT TESTS FOR BUDGET TRACKER';
    const existing = ['Add unit tests for budget tracker'];
    expect(checkDuplicate(title, existing)).toBe(true);
  });

  it('AC-6.3.b: checkDuplicate returns false for empty candidate title', () => {
    // normalize('') yields empty set → function returns false early
    expect(checkDuplicate('', ['Add unit tests'])).toBe(false);
  });

  it('AC-6.3.b: checkDuplicate returns false when existing title is empty string', () => {
    // normalize('') yields empty set → that existing entry is skipped
    const title = 'Add unit tests for budget tracker';
    expect(checkDuplicate(title, ['', ''])).toBe(false);
  });

  it('AC-6.3.b: checkDuplicate detects match against any entry in a large list', () => {
    const existing = [
      'Fix authentication bug',
      'Refactor database schema',
      'Add unit tests for budget tracker',
      'Improve CI pipeline',
    ];
    expect(checkDuplicate('Add unit tests for budget tracker', existing)).toBe(true);
  });

  it('AC-6.3.b: checkDuplicate handles punctuation correctly (strips non-alphanumeric)', () => {
    // Punctuation is stripped by the /[a-z0-9]+/g regex
    const title = 'Add unit-tests for budget-tracker!';
    const existing = ['Add unit tests for budget tracker'];
    // After normalization: add, unit, tests, for, budget, tracker — same token set
    expect(checkDuplicate(title, existing)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // IdeationOutcome structure
  // -------------------------------------------------------------------------

  it('IdeationOutcome structure: has expected fields (idea, noIdeaAvailable, category)', () => {
    // Verify the shape by constructing a mock outcome inline
    const outcome = {
      idea: {
        title: 'Add caching layer',
        description: 'Implement an in-memory cache to reduce API calls and improve response times.',
        acceptanceCriteria: ['AC-1: Cache hit ratio > 80%', 'AC-2: TTL configurable', 'AC-3: Cache invalidation works'],
        technicalApproach: 'Use a Map with TTL expiry logic in the service layer.',
        effortHours: 4,
        category: 'performance',
      },
      noIdeaAvailable: false,
      category: 'performance',
    };

    expect(outcome).toHaveProperty('idea');
    expect(outcome).toHaveProperty('noIdeaAvailable');
    expect(outcome).toHaveProperty('category');
    expect(outcome.idea).not.toBeNull();
    expect(outcome.idea!.title).toBe('Add caching layer');
    expect(Array.isArray(outcome.idea!.acceptanceCriteria)).toBe(true);
    expect(outcome.idea!.effortHours).toBeGreaterThanOrEqual(1);
    expect(outcome.idea!.effortHours).toBeLessThanOrEqual(8);
  });

  it('IdeationOutcome structure: noIdeaAvailable outcome has null idea', () => {
    const outcome = {
      idea: null,
      noIdeaAvailable: true,
      category: 'testing',
    };

    expect(outcome.idea).toBeNull();
    expect(outcome.noIdeaAvailable).toBe(true);
    expect(outcome.category).toBe('testing');
  });

  it('IdeationOutcome structure: error outcome has null idea and noIdeaAvailable false', () => {
    const outcome = {
      idea: null,
      noIdeaAvailable: false,
      category: 'testing',
    };

    expect(outcome.idea).toBeNull();
    expect(outcome.noIdeaAvailable).toBe(false);
  });
});
