# Product Requirements Document (Sequential)

## 0. Source Context
**Derived From:** Feature Brief  
**Feature Name:**  
**PRD Owner:**  
**Last Updated:**  

### Feature Brief Summary
Short summary pulled directly from the Feature Brief.

---

## 1. Objectives & Constraints
### Objectives
- Objective 1
- Objective 2

### Constraints
- Constraint 1
- Constraint 2

---

## 1.5 Required Toolchain

> List every tool, runtime, SDK, or system dependency that must be installed before implementation can begin. If the project uses only standard Node.js/TypeScript, this section can state "Standard Node.js toolchain (no additional requirements)."

| Tool | Min Version | Install Command | Verify Command |
|------|------------|-----------------|----------------|
| node | 18+ | `nvm install 18` | `node --version` |
| _example: wasm-pack_ | _0.12+_ | _`curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf \| sh`_ | _`wasm-pack --version`_ |

---

## 2. Execution Phases

> Phases below are ordered and sequential.
> A phase cannot begin until all acceptance criteria of the previous phase are met.

---

## Phase 1: <Phase Name>
**Purpose:** Why this phase must exist before others.

### 1.1 Work Item
Describe the smallest meaningful unit of work.

**Implementation Details**
- Systems affected
- Inputs / outputs
- Core logic
- Failure modes

**Acceptance Criteria**

_Structural (code exists and is correct):_
- AC-1.1.a: Condition → expected outcome
- AC-1.1.b: Error case behaves predictably

_Executable (verified by running a command):_
- AC-1.1.c: `<build/test command>` exits 0 and produces expected output

**Acceptance Tests**
- Test-1.1.a: Unit test passes for valid input
- Test-1.1.b: Integration test fails correctly on invalid input

**Verification Commands**
```bash
# Commands that MUST succeed for this work item to be considered done
# Example: cargo test --lib module_name
# Example: npm run test -- --testPathPattern=feature
```

---

### 1.2 Work Item
Next dependent step.

**Implementation Details**
- Dependencies on 1.1
- Data created or consumed
- Side effects

**Acceptance Criteria**
- AC-1.2.a: Data produced by 1.1 is consumed correctly
- AC-1.2.b: State transitions are valid

**Acceptance Tests**
- Test-1.2.a: Contract test validates interface
- Test-1.2.b: Regression test passes

---

## Phase 2: <Phase Name>
**Purpose:** Why this phase cannot start until Phase 1 completes.

### 2.1 Work Item
Describe the next sequential capability.

**Implementation Details**
- New behaviors introduced
- Integration points
- Backwards compatibility considerations

**Acceptance Criteria**
- AC-2.1.a: End-to-end flow succeeds
- AC-2.1.b: No regression from Phase 1

**Acceptance Tests**
- Test-2.1.a: E2E test passes
- Test-2.1.b: Regression suite passes

---

### 2.2 Work Item
(Optional — include only if required)

**Implementation Details**
- Edge cases
- Performance considerations

**Acceptance Criteria**
- AC-2.2.a: Edge case handled correctly
- AC-2.2.b: Performance meets defined threshold

**Acceptance Tests**
- Test-2.2.a: Stress test passes
- Test-2.2.b: Timeout behavior verified

---

## Phase N: <Phase Name>
(Repeat as needed — number of phases is unconstrained)

---

## 3. Completion Criteria
The project is considered complete when:
- All phase acceptance criteria pass
- All acceptance tests are green (verified by executing test commands, not just reading code)
- All Verification Commands from every work item exit 0
- Full project build succeeds (`<primary build command>`)
- No open P0 or P1 issues remain

---

## 4. Rollout & Validation
### Rollout Strategy
- Feature flags
- Progressive exposure

### Post-Launch Validation
- Metrics to monitor
- Rollback triggers

---

## 5. Open Questions
- Question 1
- Question 2

---
