# ClaudeSignal — Agent Workflow

> **Version:** 2.0  
> **Status:** Active  
> **Last updated:** 2026-08-17

This document defines how AI coding agents participate in ClaudeSignal development. Every agent session follows this workflow. No exceptions.

---

## Principles

1. **AI-generated code goes through engineering processes, not around them.**
2. The agent provides **evidence** that the implementation works — not claims.
3. Every task has **acceptance criteria** before implementation begins.
4. Failures are **explicit states** with recovery limits, not silent loops.
5. Risk determines authority — low risk is automatic, high risk requires human approval.

---

## Workflow Overview

```
User Request
     ↓
┌─────────────┐
│  UNDERSTAND  │  Clarify intent, scope, constraints
└──────┬──────┘
       ↓
┌─────────────┐
│    PLAN      │  Break into steps + acceptance criteria
└──────┬──────┘
       ↓
┌─────────────┐
│    RISK      │  Assess: LOW / MEDIUM / HIGH
└──────┬──────┘
       ↓
       ├── HIGH ──────→ AWAIT HUMAN APPROVAL → IMPLEMENT
       ├── MEDIUM ────→ IMPLEMENT (report after)
       └── LOW ───────→ IMPLEMENT
                           ↓
                      ┌─────────────┐
                      │   VERIFY     │  cargo build && cargo test && cargo clippy
                      └──────┬──────┘
                             ↓
                        ┌────┴────┐
                      PASS      FAIL
                        │         │
                        │      ┌─────────────┐
                        │      │   REPAIR     │  max 3 attempts
                        │      └──────┬──────┘
                        │             ↓
                        │         VERIFY again
                        │             ↓
                        │         PASS or STOP (human)
                        │
                   ┌────┴─────────────────────┐
                   │    PARALLEL REVIEWS       │
                   │                           │
                   │  ┌─────────────────────┐  │
                   │  │ Code Review         │  │
                   │  │ Security Review     │  │
                   │  │ Architecture Review │  │
                   │  │ Requirements Check  │  │
                   │  └─────────────────────┘  │
                   └────────────┬──────────────┘
                                ↓
                         ┌─────────────┐
                         │  FINAL GATE │  All reviews pass? Acceptance met?
                         └──────┬──────┘
                                ↓
                         ┌─────────────┐
                         │ COMMIT / PR │  Conventional commits
                         └──────┬──────┘
                                ↓
                         ┌─────────────┐
                         │ HUMAN MERGE │
                         └─────────────┘
```

---

## Risk Levels

| Level | Examples | Agent Behavior |
|-------|----------|----------------|
| **LOW** | Docs, tests, small refactors, UI tweaks, bug fixes | Proceed automatically |
| **MEDIUM** | New features, API additions, new dependencies | Implement, then report |
| **HIGH** | DB migrations, security changes, CI/CD, secrets, data deletion, breaking API changes | **Stop. Await human approval.** |

When uncertain, escalate. Never guess on HIGH risk.

---

## Acceptance Criteria

Every task starts with testable acceptance criteria. The agent writes these **before** implementing.

Example:

```yaml
task: Add budget alert at 80%
acceptance_criteria:
  - alert fires when daily cost reaches 80% of budget
  - alert fires only once per threshold crossing
  - alert resets at midnight
  - WebSocket delivers alert to dashboard
  - macOS notification fires if enabled in config
```

The final verification **must check each criterion explicitly**.

---

## Failure & Recovery

When verification fails:

```
VERIFY → FAIL → DIAGNOSE → REPAIR → VERIFY
```

Rules:
- **Max 3 repair attempts** per verification failure cycle.
- After 3 failures: **STOP**. Generate a failure report. Request human intervention.
- Never silently skip a failing test.
- Never modify tests to make them pass — fix the implementation.

Failure report format:

```yaml
verification:
  build: pass
  tests: FAIL (2 failures)
  clippy: pass
repair_attempts: 3
status: STOPPED
failure_report:
  - test: fixture_basic_session_parses_correctly
    error: "expected 3 turns, got 0"
  - test: fixture_cache_tokens_are_aggregated
    error: "cache_read_tokens mismatch"
next_step: human_intervention
```

---

## Quality Gates

Every task must pass before moving to review:

```bash
cargo build && cargo test && cargo clippy
```

| Gate | Purpose |
|------|---------|
| `cargo build` | Compilation correctness |
| `cargo test` | Behavioral correctness |
| `cargo clippy` | Code quality, potential issues |

If any gate fails → enter failure/recovery loop.

---

## Reviews

After verification passes, run parallel reviews:

### Code Review
- Readability, naming, function size
- Error handling (no unwraps in non-test code)
- Follows existing module patterns
- No dead code

### Security Review
- No hardcoded secrets
- Input validation
- SQL injection prevention (parameterized queries)
- XSS prevention
- Error messages don't leak sensitive data
- No outbound network calls

### Architecture Review (for medium/large changes)
- Preserves module boundaries
- No unnecessary coupling
- No business logic duplication
- Abstraction is appropriate
- Consistent with existing architecture

### Requirements Check
- Every acceptance criterion is met
- No scope creep
- No missing edge cases

---

## Regression Analysis

Before implementation, identify the **regression surface** — what existing behavior could be affected.

```yaml
regression_surface:
  api:
    - /api/config
    - /api/usage/history
  backend:
    - AlertManager
    - usage calculation
  frontend:
    - alert toast
    - usage dashboard
  websocket:
    - ServerEvent::Alert
```

Then ensure tests cover the affected areas.

---

## Git Workflow

1. Branch: `agent/<short-task-name>`
2. Never commit directly to `main`
3. Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
4. Run `cargo build && cargo test && cargo clippy` before committing
5. Create PR with summary body
6. Human merges

---

## Workflow Artifacts

Every task produces:

### Task Plan (before implementation)
```yaml
task:
  id: <short-name>
  title: <description>
risk: low | medium | high
acceptance_criteria:
  - <criterion 1>
  - <criterion 2>
affected_areas:
  - src/<file>.rs
  - web/<file>.js
test_strategy: tdd | test-after | integration | characterization
```

### Verification Report (after implementation)
```yaml
verification:
  build: pass | fail
  tests: pass | fail
  clippy: pass | fail
acceptance:
  passed: true | false
  criteria_met: <list>
repair_attempts: 0
regression:
  passed: true | false
```

### Review Report (after reviews)
```yaml
review:
  code: pass | changes_requested
  security: pass | changes_requested
  architecture: pass | skip | changes_requested
  requirements: pass | fail
findings:
  high: 0
  medium: 0
  low: 0
```

---

## Commands

```bash
cargo build                                            # Build
cargo test                                             # Run all tests
cargo clippy                                           # Lint
cargo run -- --port 3004 serve                         # Run dashboard
cargo run -- --port 3004 simulate                      # Run with demo data
```

---

## What This Workflow Does NOT Do

- No telemetry, analytics, or outbound network calls
- No automated releases — human controls merging and shipping
- No agent authority over HIGH-risk changes without human approval
- No unlimited repair loops — max 3 attempts, then stop

---

## Evolution

This workflow is versioned and improves over time.

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-16 | Initial workflow: plan → implement → verify → review → ship |
| 2.0 | 2026-08-17 | Added: acceptance criteria, failure/recovery, risk levels, architecture review, regression analysis, parallel reviews, workflow artifacts |

Full review: `localDocs/AGENT-WORKFLOW-REVIEW.md`
