# ClaudeSignal — Agent Workflow

> **Version:** 4.0  
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

**General questions:**
- Does this preserve module boundaries?
- Does this introduce unnecessary coupling?
- Is business logic duplicated?
- Does this introduce unnecessary dependencies?
- Does this create future migration problems?
- Is the abstraction appropriate?
- Is the implementation consistent with existing architecture?

**ClaudeSignal-specific questions:**
- Does this change touch `routes.rs`? → Consider if it should be a new module
- Does this add a new `ServerEvent` variant? → Check `ServerEvent` enum in `websocket.rs` and frontend handler in `app.js`
- Does this modify `AppState`? → Check all consumers of `AppState`
- Does this add a new API endpoint? → Must be in `build_router()` in `routes.rs`, documented in `API.md`, tested in `tests/server_routes.rs`
- Does this change `Config` structs? → Check `config.rs`, `Config::load()`, and all config consumers
- Does this modify `usage_history.rs`? → Check `tests/usage_history_parsing.rs` for existing test patterns
- Does this change frontend files? → Remember `include_str!` embedding; requires `cargo build` + server restart
- Does this touch `ScanCache`? → Check mtime-based invalidation logic

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

## Test Strategy Selection

Choose a test strategy before implementing. The strategy depends on change type and risk.

| Change Type | Strategy | Why |
|-------------|----------|-----|
| New feature | **TDD** | Write tests first to define behavior |
| Bug fix | **Characterization** | Write test that reproduces bug, then fix |
| Refactor (no behavior change) | **Test-after** | Existing tests validate; add edge cases after |
| Config change | **Integration** | Test config → behavior end-to-end |
| UI tweak | **Visual / manual** | Automated tests fragile; verify visually |
| API addition | **TDD + Integration** | Test contract and integration with callers |

### Strategy Decision Flowchart

```
Is behavior changing?
├── YES → Is it a new feature?
│         ├── YES → TDD
│         └── NO (bug fix) → Characterization test first
└── NO (refactor/style)
    ├── Existing tests pass? → Test-after (add edge cases)
    └── No existing tests → Write tests first for critical paths
```

### Strategy in Task Plan

```yaml
task:
  id: add-efficiency-metrics
  test_strategy: tdd
  test_plan:
    - write unit test for efficiency calculation
    - write integration test for /api/efficiency endpoint
    - verify frontend renders metrics
```

---

## Rollback & Recovery

When verification fails after 3 repair attempts:

```
REPAIR 1 → VERIFY → FAIL
REPAIR 2 → VERIFY → FAIL
REPAIR 3 → VERIFY → FAIL
    ↓
STOP — Do not attempt repair 4
    ↓
┌─────────────────────────────┐
│ RECOVERY STRATEGY           │
├─────────────────────────────┤
│ 1. Revert unsafe changes    │
│ 2. Generate failure report  │
│ 3. Request human help       │
└─────────────────────────────┘
```

### Recovery Options

| Scenario | Action |
|----------|--------|
| All tests fail after 3 repairs | `git stash` changes, report to human |
| Build broken after 3 repairs | Revert to last passing commit |
| Partial success (some tests pass) | Keep passing changes, revert failing ones |
| Security issue found | Stop immediately, revert, flag as HIGH risk |

### Failure Report Format

```yaml
task: <task-id>
status: STOPPED
repair_attempts: 3
verification_history:
  - attempt: 1
    build: pass
    tests: FAIL (3 failures)
  - attempt: 2
    build: pass
    tests: FAIL (1 failure)
  - attempt: 3
    build: pass
    tests: FAIL (1 failure)
remaining_issues:
  - test: test_name
    error: "description"
    file: src/file.rs:42
recovery_action: git stash
next_step: human_intervention
```

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

## Example Workflow

A real task following this workflow end-to-end.

### User Request

> "Add daily cost reset at midnight"

### Step 1 — Understand

```
Goal: Daily cost counter resets at midnight UTC
Scope: alerts.rs, config.rs, routes.rs
Constraints: Must not break existing alert logic
```

### Step 2 — Plan + Acceptance Criteria

```yaml
task:
  id: daily-cost-reset
  title: Reset daily cost counter at midnight
  risk: medium
  acceptance_criteria:
    - daily_cost resets to 0 at midnight UTC
    - alert_manager resets threshold state
    - existing alerts continue working
    - no duplicate alerts after reset
  affected_areas:
    - src/alerts.rs
    - src/config.rs
  regression_surface:
    - AlertManager state
    - daily cost calculation
    - /api/usage endpoint
  test_strategy: tdd
```

### Step 3 — Implement (TDD)

1. Write test: `test_daily_cost_resets_at_midnight`
2. Run test → FAIL (RED)
3. Implement reset logic
4. Run test → PASS (GREEN)
5. Refactor if needed

### Step 4 — Verify

```bash
cargo build && cargo test && cargo clippy
```

Result: all pass.

### Step 5 — Reviews

Run in parallel:
- Code review: readability, error handling
- Security review: no new attack surface
- Architecture review: does reset logic belong in AlertManager?
- Requirements check: all 4 acceptance criteria met

### Step 6 — Commit + PR

```bash
git checkout -b agent/daily-cost-reset
git commit -m "feat: add daily cost reset at midnight"
git push --set-upstream origin agent/daily-cost-reset
gh pr create ...
```

### Artifacts Produced

```yaml
task:
  id: daily-cost-reset
  risk: medium
  acceptance_criteria: [4 items]

verification:
  build: pass
  tests: pass
  clippy: pass
  acceptance:
    passed: true
    criteria_met: [4/4]
  repair_attempts: 0
  regression:
    passed: true

review:
  code: pass
  security: pass
  architecture: pass
  requirements: pass
  findings:
    high: 0
    medium: 0
    low: 1
```

---

## Agent Observability

Every task produces metrics. These metrics answer: **Is AI actually improving engineering productivity?**

### Metrics to Track

| Metric | How | Why |
|--------|-----|-----|
| **Task duration** | Timestamp at start → commit | How long does a task take? |
| **Tokens used** | Sum input + output tokens from session | Cost of the task |
| **Estimated cost** | Tokens × model pricing | Dollar cost of AI assistance |
| **Repair attempts** | Count in verification history | Code quality signal |
| **Human intervention** | Was STOP triggered? | Agent reliability |
| **Review findings** | Count by severity (high/medium/low) | Code review quality |
| **First-pass success** | Did verification pass on first try? | Agent competence |
| **PR outcome** | Merged / changes requested / closed | Delivery success |

### Task Metrics Artifact

Add to the task plan:

```yaml
task:
  id: daily-cost-reset
  start_time: "2026-08-17T14:00:00Z"
  model: opencode/big-pickle
```

Add to the verification report:

```yaml
metrics:
  duration_minutes: 12
  repair_attempts: 0
  first_pass_success: true
  human_intervention: false
  tokens:
    input: 15000
    output: 8000
  estimated_cost_usd: 0.04
```

Add to the review report:

```yaml
metrics:
  review_findings:
    high: 0
    medium: 1
    low: 2
  pr_outcome: merged
```

### Aggregated Metrics (per session)

After multiple tasks, aggregate:

```yaml
session_summary:
  tasks_completed: 5
  total_duration_minutes: 45
  total_tokens: 120000
  total_estimated_cost_usd: 0.32
  first_pass_success_rate: "80%"
  avg_repair_attempts: 0.4
  human_intervention_rate: "20%"
  pr_merge_rate: "100%"
```

This data answers the review's key questions:
```
How much AI are we using?        → tokens + cost
How successful are the tasks?    → first-pass success + PR outcomes
How many repairs are required?   → repair attempts
How often does human intervene?  → human intervention rate
How many defects are caught?     → review findings
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
| 3.0 | 2026-08-17 | Added: test strategy selection, rollback/recovery strategy, project-specific architecture review, practical example workflow |
| 4.0 | 2026-08-17 | Added: agent observability — task metrics, token/cost tracking, first-pass success, PR outcomes, aggregated session summary |

Full review: `localDocs/AGENT-WORKFLOW-REVIEW.md`
