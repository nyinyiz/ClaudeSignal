# ClaudeSignal Agent Workflow

How the coding agent builds, reviews, and publishes features — step by step.

## Overview

ClaudeSignal uses **opencode** as its coding agent, with a structured workflow that enforces quality at every stage. The process is designed so that every feature goes through a repeatable pipeline: **Plan → Implement → Verify → Review → Ship**.

---

## 1. Project Configuration

Before any coding starts, the project has guardrails in place:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Project context — architecture, commands, conventions, known issues |
| `.opencode/rules/git-workflow.md` | Branch naming, commit format, test requirements |
| `.opencode/rules/security.md` | Security checklist — no secrets, no telemetry, local-only |
| `.opencode/rules/testing.md` | TDD workflow, test structure, known test caveats |
| `.opencode/rules/coding-style.md` | Rust idioms, error handling, logging, file organization |

These files are loaded automatically by opencode at session start. The agent reads them before writing any code.

---

## 2. The Workflow (Step by Step)

### Step 1: Brainstorm & Plan

Before touching code, the agent explores the codebase and creates a plan.

```
User: "Add a budget alert system"
Agent: reads AGENTS.md, explores src/, reads existing tests
Agent: writes plan in localDocs/ or in conversation
Agent: asks clarifying questions if needed
```

**Skills used:** `brainstorming`, `writing-plans`, `understand`

### Step 2: Create a Branch

Per git-workflow rules, every task gets its own branch:

```bash
git checkout -b agent/<short-task-name>
# Example: git checkout -b agent/budget-alerts
```

**Rules enforced:**
- Never commit to `main` or `master`
- Always create a branch before editing
- Branch name format: `agent/<task-name>`

### Step 3: Write Tests First (TDD)

The agent writes tests before implementation when practical.

```
tests/server_routes.rs  ← add config_route_returns_defaults test
src/config.rs            ← implementation follows
```

**Skills used:** `test-driven-development`, `tdd-workflow`

**Testing convention:**
- `tests/server_routes.rs` — HTTP API route tests
- `tests/status_behavior.rs` — session status transitions
- `tests/usage_history_parsing.rs` — JSONL transcript scanning
- `tests/websocket_behavior.rs` — WebSocket broadcast

### Step 4: Implement

The agent writes code following existing patterns:
- Rust: `thiserror` + `anyhow` for errors, `tracing` for logging
- Frontend: vanilla JS, no build step, files embedded via `include_str!`
- Follow existing module patterns — don't introduce new frameworks

### Step 5: Run the Verification Gate

Before committing, the agent runs the full gate:

```bash
cargo build && cargo test && cargo clippy
```

| Check | Command | What it catches |
|-------|---------|-----------------|
| Build | `cargo build` | Compilation errors |
| Tests | `cargo test` | Logic errors, regressions |
| Lint | `cargo clippy` | Code quality, dead code |

**Known caveat:** 7 `usage_history_parsing` tests fail because they scan real transcripts. This is a documented baseline — not a regression signal.

**Skills used:** `verification-loop`, `verification-before-completion`

### Step 6: Code Review

The agent runs a dedicated code review using the `code-reviewer` agent:

```
Task: code-reviewer agent
Reviews: diff, new files, test coverage
Reports: severity-ranked issues (HIGH/MEDIUM/LOW)
```

**Issues are fixed before merge.** The agent does not proceed to PR with HIGH issues unresolved.

**Skills used:** `code-reviewer`, `receiving-code-review`

### Step 7: Security Review

For changes that touch user input, API endpoints, or data handling:

```
Task: security-reviewer agent
Checks: secrets, XSS, injection, error handling
Reports: findings with severity and fix suggestions
```

**Skills used:** `security-review`, `ghost-scan-secrets`

### Step 8: Commit & Push

Conventional commit format:

```bash
git add <files>
git commit -m "feat: add budget alert system with config-driven thresholds"
git push -u origin agent/<branch-name>
```

**Commit message prefixes:**
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance
- `docs:` — documentation
- `refactor:` — code restructuring

### Step 9: Create Pull Request

```bash
GH_TOKEN=$GITHUB_TOKEN gh pr create \
  --base main \
  --head agent/<branch-name> \
  --title "feat: ..." \
  --body "## Summary ..."
```

The PR includes:
- Summary of changes
- Test results
- Files changed list
- Any known limitations

---

## 3. Skills Reference

The agent uses specialized skills at different stages:

| Stage | Skill | Purpose |
|-------|-------|---------|
| Planning | `brainstorming` | Explore intent before coding |
| Planning | `writing-plans` | Create implementation plans |
| Planning | `understand` | Map codebase architecture |
| Implementation | `test-driven-development` | Write tests first |
| Implementation | `coding-standards` | Follow project conventions |
| Verification | `verification-loop` | Build → Test → Lint → Security |
| Review | `code-reviewer` | Automated code review |
| Review | `security-review` | Security vulnerability scan |
| Review | `receiving-code-review` | Process review feedback |
| Shipping | `finishing-a-development-branch` | Decide merge strategy |
| Shipping | `verification-before-completion` | Final gate before PR |

---

## 4. File Organization

```
ClaudeSignal/
├── AGENTS.md                    # Project context (loaded by agent)
├── .opencode/
│   ├── rules/
│   │   ├── git-workflow.md      # Branch/commit/test rules
│   │   ├── security.md          # Security checklist
│   │   ├── testing.md           # TDD workflow, test structure
│   │   └── coding-style.md      # Rust/frontend conventions
│   └── skills/
│       └── claude-signal-dev/   # Build/test/serve skill
├── src/
│   ├── main.rs, cli.rs          # CLI entry point
│   ├── server.rs, routes.rs     # Axum server + HTTP routes
│   ├── alerts.rs                # Alert engine (budget/rate-limit)
│   ├── config.rs                # TOML configuration
│   ├── status.rs, status_store.rs  # Session state
│   ├── usage.rs                 # Live status-line normalization
│   ├── usage_history.rs         # JSONL transcript scanning
│   ├── db.rs                    # SQLite persistence
│   └── websocket.rs             # WebSocket handler
├── web/
│   ├── index.html, app.js       # Dashboard frontend
│   ├── usage.html, usage.js     # Usage analytics page
│   └── styles.css, usage-styles.css
├── tests/
│   ├── server_routes.rs         # HTTP API tests
│   ├── status_behavior.rs       # Session state tests
│   ├── usage_history_parsing.rs # JSONL parsing tests
│   └── websocket_behavior.rs    # WebSocket tests
└── localDocs/
    └── improvement-suggestions.md  # Design backlog
```

---

## 5. How to Add a New Feature

### Quick Guide

1. **Create branch:** `git checkout -b agent/<feature-name>`
2. **Write the test** in `tests/` (follow existing patterns)
3. **Implement** in `src/` (follow existing module patterns)
4. **Run gate:** `cargo build && cargo test && cargo clippy`
5. **Code review:** ask the agent to run `code-reviewer`
6. **Fix issues** if any
7. **Commit:** `git commit -m "feat: <description>"`
8. **Push:** `git push -u origin agent/<feature-name>`
9. **PR:** create pull request with summary

### What the Agent Checks Automatically

- [ ] No hardcoded secrets (security rules)
- [ ] No telemetry or outbound calls (security rules)
- [ ] SQL injection prevention via parameterized queries
- [ ] XSS prevention via escaped HTML output
- [ ] Error messages don't leak sensitive data
- [ ] Tests pass (except documented baselines)
- [ ] Clippy warnings resolved
- [ ] Conventional commit format
- [ ] Branch is not `main` or `master`

---

## 6. Example: Building the Budget Alert System

This is how the `agent/improvement-suggestions` branch was built:

```
1. User: "fix and improve improvement-suggestions.md"
2. Agent: read backlog, verified shipped items via git log
3. User: "create new branch and do the High impact work first"
4. Agent: git checkout -b agent/improvement-suggestions
5. Agent: explored codebase (server.rs, routes.rs, status.rs, usage_history.rs)
6. Agent: implemented config.rs + alerts.rs + frontend changes
7. Agent: ran cargo build && cargo test && cargo clippy
8. Agent: ran code-reviewer agent → found 2 HIGH issues (CSS class mismatch, API.md corruption)
9. Agent: fixed all HIGH and MEDIUM issues
10. Agent: committed, pushed, created PR #2
```

**Result:** PR #2 with config file, budget & alerts, notifications, efficiency metrics — all tests passing.

---

## 7. Key Principles

1. **Local-first** — no hosted backend, no telemetry, no uploads
2. **Quality gates** — build + test + lint before every commit
3. **Review before merge** — code-reviewer catches issues the author misses
4. **Documented baselines** — known test failures are documented, not chased
5. **Conventional commits** — every commit message follows a prefix format
6. **Isolated branches** — each task gets its own branch, never commit to main
7. **Skills as guardrails** — specialized agents enforce standards at each stage
