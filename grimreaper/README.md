# SaaS GrimReaper — Foundation

> **Ghost License & Shadow IT Offboarding Agent**

This directory contains the foundational backend orchestrator, risk/savings engine, approval state machine, audit logger, and Webcmd CLI wrapper for **SaaS GrimReaper**.

---

## 🏗️ Architecture

```text
User / Admin
   │
   ▼
SaaS GrimReaper Orchestrator
   ├── 1. Webcmd CLI Wrapper (Subprocess Browser Engine)
   ├── 2. Core Data Models (Normalized Seat Structure)
   ├── 3. Risk Engine (Deterministic Inactivity Assessment)
   ├── 4. Savings Calculator (Monthly & Annual Potential Waste)
   ├── 5. Approval State Machine (Strict Execution Guardrails)
   └── 6. Audit Logger (Sanitized Event Logging)
```

---

## 🔌 How GrimReaper Talks to Webcmd

GrimReaper communicates with Webcmd as a **standalone external application** by executing `webcmd` CLI commands via subprocess calls with structured `-f json` formatting.

### Supported CLI Wrapper Operations (`grimreaper/src/webcmd-cli.ts`):

1. **`doctor()`**: Checks local browser daemon and environment health (`webcmd doctor -f json`).
2. **`createSession(profile, sessionName)`**: Creates an isolated browser workspace (`webcmd --profile <p> session create <name> -f json`).
3. **`listSessions(profile)`**: Retrieves active browser sessions for a profile (`webcmd --profile <p> session list -f json`).
4. **`closeSession(profile, sessionId)`**: Closes an active browser workspace (`webcmd --profile <p> session close <id> -f json`).
5. **`snapshot(profile, sessionId, options)`**: Captures accessibility tree page state (`webcmd --profile <p> --session <id> browser snapshot --snapshot-mode act -f json`).
6. **`browserRun(profile, sessionId, script)`**: Executes sandboxed QuickJS Playwright-style scripts (`webcmd --profile <p> --session <id> browser run --stdin -f json`).

### Safety Guarantees in Wrapper:
* **Output Capture:** Captures `stdout`, `stderr`, `exitCode`, and duration.
* **Secret Sanitization:** Automatically redacts tokens, bearer keys, passwords, and cookies from log outputs.
* **Auth Handoff Detection:** Detects exit code `77` (`AuthRequiredError`) or `SESSION_PAUSED_FOR_HUMAN_HANDOFF` messages.
* **Bounded Retries:** Retries transient errors (timeouts or daemon connect issues) up to 2 times, while strictly failing fast on auth or argument errors.

---

## 🔒 Approval State Machine & Security Guardrail

Candidate seats follow an explicit lifecycle:

```text
DISCOVERED ──► FLAGGED ──► PENDING_APPROVAL ──► APPROVED ──► EXECUTED
   │             │               │                 │
   └─────────────┴───────────────┴─────────────────┴───────► REJECTED
```

### 🛡️ Strict Execution Guardrail
The execution boundary function (`executeApprovedOffboarding` / `executeOffboardingGuardrail`) enforces that **only candidates in the `APPROVED` state can ever reach execution logic**.

Attempting to run offboarding on a seat in `DISCOVERED`, `FLAGGED`, `PENDING_APPROVAL`, or `REJECTED` state will immediately throw `UnauthorizedExecutionError` and prevent execution.

---

## 📚 System Architecture & Documentation

* **System Architecture Document:** [`docs/SaaS GrimReaper System Architecture.md`](file:///c:/webcmd/grimreaper/docs/SaaS%20GrimReaper%20System%20Architecture.md)
* **Terms and Conditions Policy:** [`docs/SaaS_GrimReaper_Terms_and_Conditions_Policy.md`](file:///c:/webcmd/grimreaper/docs/SaaS_GrimReaper_Terms_and_Conditions_Policy.md)
* **Member 3 Python Reference Engine:** [`engine/reference/`](file:///c:/webcmd/grimreaper/engine/reference/)

---

## 🧪 How to Run Tests

GrimReaper unit tests run using Node.js's native test runner without third-party dependencies:

```bash
node --test --experimental-strip-types grimreaper/tests/grimreaper.test.ts grimreaper/tests/github-adapter.test.ts grimreaper/tests/orchestrator-github.test.ts grimreaper/tests/slack-adapter.test.ts grimreaper/tests/server-ui-integration.test.ts grimreaper/tests/offboarding-execution.test.ts
```

### Test Coverage (60 / 60 Passed):
* ✅ Inactivity calculation & policy recommendation (`KEEP` vs `REVIEW`)
* ✅ Future timestamp sanitization (`NO_DATA` rule 7)
* ✅ Exempt user handling (exempt users are never flagged)
* ✅ Unpaid / free seat handling (unpaid seats do not incur cost waste)
* ✅ Potential monthly and annual savings calculation
* ✅ Approval required before execution (throws `UnauthorizedExecutionError` if unapproved)
* ✅ Rejected & `NO_DATA` candidates cannot be executed
* ✅ GitHub and Slack read-only browser audits via Webcmd CLI
* ✅ Safe offboarding execution & DOM post-verification
* ✅ Webcmd CLI wrapper timeout handling, secret sanitization, and auth detection
* ✅ Dashboard UI static serving and API integration

---

## ⚠️ Current Scope & Boundaries

* **Browser-First Operations:** Uses Webcmd CLI browser automation for GitHub and Slack audits.
* **Safe Offboarding Execution:** Executes member removal only after explicit human approval in the backend Approval State Machine.
* **NO_DATA Safeguard:** Missing or unverified activity data is never inferred as inactivity.
