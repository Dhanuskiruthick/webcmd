# SaaS GrimReaper
### Ghost License & Shadow IT Offboarding Agent

Companies lose money every month on SaaS seats that are no longer actively used. SaaS GrimReaper is a browser-based security and IT automation agent that investigates SaaS workspaces, identifies potentially abandoned paid seats, estimates potential savings, and safely guides approved offboarding through a human-in-the-loop workflow.

```text
Browser Evidence → Risk → Savings → Human Approval → Safe Action → Verification → Audit Trail
```

---

## 1. The Problem

Modern organizations face severe SaaS sprawl across developer tools, communication platforms, and productivity suites. Administrative offboarding is fraught with operational challenges:

- **Unused & Inactive Paid Seats:** Employees leave projects or change roles, while their paid licenses continue renewing indefinitely.
- **Repetitive Administrative Work:** IT administrators must manually log into multiple admin portals to cross-reference member directories against activity timestamps.
- **Risk of Accidental Removal:** Misidentifying active employees or automated service bots as "inactive" can cause production outages.
- **Lack of Auditability:** Manual administrative cleanup actions performed directly in browser consoles leave no centralized audit trail or rationale.

> **Key Question:** *How can we automate repetitive SaaS offboarding work without turning automation into uncontrolled deletion?*

---

## 2. Our Solution

SaaS GrimReaper acts as an **evidence-driven browser agent** that automates investigation while enforcing strict safety guardrails.

### Core Workflow:
1. **Audit SaaS Workspace:** Launches browser sessions to inspect platform administration member lists and activity data.
2. **Collect Normalized Evidence:** Maps disparate platform structures into a unified `SaaSSeat` model.
3. **Evaluate Risk:** Applies deterministic rules to evaluate user activity against inactivity thresholds.
4. **Calculate Potential Savings:** Computes monthly and annual potential spend waste for flagged candidates.
5. **Flag Candidates:** Marks inactive paid seats for administrative review.
6. **Require Human Approval:** Enforces explicit backend state machine approval before any offboarding action can occur.
7. **Execute Approved Offboarding:** Performs browser offboarding actions only for explicitly authorized candidates.
8. **Post-Verify Action:** Re-inspects workspace state to confirm removal or deactivation.
9. **Record Audit Trail:** Writes sanitized, append-only audit records for all actions and decisions.

> *"GrimReaper does not replace the administrator. It replaces repetitive browser work while keeping the administrator in control."*

---

## 3. Why This Is More Than a Dashboard

The HTML UI is strictly the interactive control surface for administrators. All intelligence, risk logic, savings calculations, state machine transitions, and safety enforcement occur within the backend engine.

### Backend Pipeline Components:
- **Webcmd Subprocess Wrapper (`src/webcmd-cli.ts`):** Manages browser profiles, isolated sessions, CLI execution, output sanitization, and authentication handoff detection.
- **Platform Adapters (`src/adapters/github.ts`, `src/adapters/slack.ts`):** Scrapes member directories, extracts activity timestamps, and maps raw DOM data into standard structures.
- **Deterministic Risk Engine (`src/risk-engine.ts`):** Evaluates seat inactivity against configurable policy thresholds and exempt statuses.
- **Savings Engine (`src/savings.ts`):** Calculates potential financial impact across flagged paid seats.
- **Approval State Machine (`src/approval.ts`):** Enforces state transitions (`DISCOVERED` $\rightarrow$ `FLAGGED` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` $\rightarrow$ `EXECUTED`).
- **Safe Demo Layer (`src/demo-data.ts`):** Supplies synthetic test identities and safe execution simulation when `DEMO_MODE=true`.
- **Append-Only Audit Logger (`src/audit-logger.ts`):** Persists sanitized logs of all evaluations, approvals, and executions.

---

## 4. Architecture

```text
User / Admin
   │
   ▼
GrimReaper Dashboard UI (HTML / Vanilla CSS / ES6 JS)
   │
   ▼
GrimReaper Orchestrator (src/orchestrator.ts)
   ├── Webcmd CLI → GitHub Adapter (Org People & Audit Log)
   ├── Webcmd CLI → Slack Adapter (Admin Member Directory)
   │
   ▼
Evidence Normalization (SaaSSeat Model)
   │
   ▼
Risk Engine (src/risk-engine.ts)
   │
   ▼
Savings Engine (src/savings.ts)
   │
   ▼
Human Approval Gate (src/approval.ts State Machine)
   │
   ▼
Safe Execution Layer (Simulated in DEMO_MODE / Webcmd Automation)
   │
   ▼
Post-Verification (DOM Re-inspection)
   │
   ▼
Audit Logger (src/audit-logger.ts Append-Only Log)
```

### Component Overview:
- **Orchestrator (`src/orchestrator.ts`):** Central coordinator handling audit dispatch, ingestion, risk evaluation, and execution guardrails.
- **Webcmd CLI Wrapper (`src/webcmd-cli.ts`):** Interacts with Webcmd CLI as a subprocess engine with JSON parsing and secret redaction.
- **Platform Adapters (`src/adapters/`):** Scrapes GitHub Org People/Audit Logs and Slack Admin Directories.
- **Risk & Savings Engines (`src/risk-engine.ts`, `src/savings.ts`):** Computes risk levels (`HIGH`, `MEDIUM`, `LOW`, `NONE`) and potential annual savings.
- **Approval State Machine (`src/approval.ts`):** Hard security guardrail blocking unauthorized execution.
- **Audit Logger (`src/audit-logger.ts`):** Centralized append-only audit trail logging.

---

## 5. Browser Agent / Webcmd Integration

GrimReaper interfaces with Webcmd CLI via a dedicated wrapper module (`src/webcmd-cli.ts`):

- **Isolated Sessions:** Creates dedicated browser sessions for each audit (`webcmd --profile <p> session create <name> -f json`).
- **DOM Inspection & Script Execution:** Runs sandboxed JavaScript scripts inside browser pages (`webcmd ... browser run --stdin -f json`).
- **Auth Handoff Detection:** Detects login redirects or exit code `77` (`AuthRequiredError`), setting `authRequired: true` to pause automation for human login when credentials are required.
- **Secret Redaction:** Automatically sanitizes tokens, passwords, bearer keys, and cookies from log outputs.
- **Bounded Timeout & Retry Handling:** Retries transient errors up to 2 times while failing fast on auth errors.

*Note: Autonomous self-learning or dynamic script repair is not implemented. GrimReaper relies on explicit DOM extraction logic inside platform adapters.*

---

## 6. Evidence-Driven Risk Engine

The Risk Engine (`src/risk-engine.ts`) deterministically evaluates SaaS seats against inactivity thresholds:

| Evidence Status | Risk Engine Decision | Risk Level |
| :--- | :--- | :--- |
| **Active paid user** ($< 90$ days inactive) | `KEEP` | `NONE` |
| **Paid user inactive $\ge 90$ days** | `REVIEW` | `MEDIUM` |
| **Paid user inactive $\ge 180$ days** | `REVIEW` | `HIGH` |
| **Free / Unpaid / Exempt user** | `KEEP` | `NONE` |
| **Missing activity timestamp** | `KEEP` | `NONE` (`NO_DATA`) |

> **IMPORTANT: `NO_DATA` is NOT `INACTIVE`.**

### Why This Matters:
A missing activity timestamp may indicate restricted profile settings, incomplete audit logs, or missing admin permissions—not necessarily user inactivity. To prevent accidental offboarding of active users or service bots, **GrimReaper fails safe: missing activity evidence is assigned `NO_DATA` and is NEVER flagged as inactive.**

---

## 7. Potential Savings

The Savings Engine (`src/savings.ts`) calculates estimated potential spend waste for flagged seats:

$$\text{Potential Annual Savings} = \text{Eligible Monthly Seat Cost} \times 12$$

### Key Principles:
- **Potential, Not Guaranteed:** Savings estimates represent *potential* waste from flagged paid seats. Actual billing reductions depend on enterprise contract terms, seat minimums, and billing cycles.
- **Eligibility First:** Savings calculations run *after* risk evaluation. Free seats ($0/mo), exempt users, and active users contribute $0 to potential savings.

---

## 8. Human-In-The-Loop Safety

GrimReaper strictly enforces a human-in-the-loop security model via a formal state machine (`src/approval.ts`):

```text
DISCOVERED ──► FLAGGED ──► PENDING_APPROVAL ──► APPROVED ──► EXECUTED
   │             │               │                 │
   └─────────────┴───────────────┴─────────────────┴───────► REJECTED
```

### Security Principles & Guardrails:
- **Zero Client Trust:** Frontend payload values like `approved=true` are **never** trusted by the backend.
- **Hard Execution Guardrail:** `executeOffboardingGuardrail` verifies backend candidate state. Attempting offboarding on any seat not in `APPROVED` state throws an `UnauthorizedExecutionError`.
- **`NO_DATA` Protection:** Seats with `NO_DATA` (missing activity timestamp) cannot be executed and return `UNSUPPORTED`.
- **Fail Closed:** Any execution failure or verification failure leaves candidate state unchanged or flags an execution error.
- **Post-Verification:** Every offboarding action re-inspects DOM state to verify successful removal or deactivation.

> *"Automate investigation. Keep authority with the human."*

---

## 9. Safe Demo Mode

For hackathon demonstrations, GrimReaper includes an isolated **Safe Demo Mode** (`DEMO_MODE=true`).

> *"For the hackathon live demonstration, GrimReaper supports an isolated DEMO_MODE that uses synthetic GitHub and Slack workspace records. This allows the complete decision and approval workflow to be demonstrated without touching real user accounts."*

### Demo Mode Characteristics:
- **Synthetic Identities:** Uses fake test records from `src/demo-data.ts` with `.test` domain email addresses (`arun.dev@example.test`, `rahul.old@example.test`, etc.).
- **Full Pipeline Processing:** Demo users pass through the **real** Risk Engine, Savings Engine, Approval State Machine, and Audit Logger.
- **Simulated Execution Safety:** `REAP` execution simulates offboarding and post-verification safely (`status: 'EXECUTED'`, `verified: true`) without calling real GitHub/Slack destructive actions.
- **UI Indicator:** Displays a prominent `"DEMO MODE — Simulated Workspace"` badge in the dashboard header.
- **Adapter Preservation:** Setting `DEMO_MODE=false` (or omitting the variable) preserves real Webcmd adapter behavior.

---

## 10. Platform Adapters (GitHub & Slack)

### GitHub Adapter (`src/adapters/github.ts`):
- **Audit:** Inspects GitHub Organization People pages and queries Org Owner Audit Logs (`actor:<username>`).
- **Fields Collected:** `username`, `display_name`, `role`, `two_factor_enabled`, `last_activity`, `paid_seat`, `monthly_cost`.
- **Execution:** Performs member removal via Webcmd browser automation when explicitly approved.
- **Verification:** Re-navigates to member directory to confirm member removal.

### Slack Adapter (`src/adapters/slack.ts`):
- **Audit:** Inspects Slack Workspace Admin Member Management directory (`/admin/users`).
- **Fields Collected:** `user_id`, `display_name`, `email`, `role`, `last_activity` (parsed relative/absolute timestamps), `paid_seat`, `monthly_cost`.
- **Execution:** Performs user deactivation via Webcmd browser automation.
- **Safeguard:** If workspace tier requires manual enterprise 2FA or owner authorization, returns `UNSUPPORTED` safely.

*Note: Field availability depends on workspace plan and admin permissions (e.g. GitHub hides email addresses on org people pages).*

---

## 11. Live Demo Flow (Hackathon Evaluation)

Follow these simple steps to evaluate GrimReaper during a live demonstration:

1. **Start Server in Demo Mode:**
   ```powershell
   $env:DEMO_MODE="true"
   node --experimental-strip-types src/server.ts
   ```
2. **Open Dashboard:** Navigate to [http://localhost:3000](http://localhost:3000/).
3. **Inspect UI Indicator:** Verify `"DEMO MODE — Simulated Workspace"` badge is displayed in the header.
4. **Audit GitHub:** Click **"Audit GitHub"**. Observe discovered candidates:
   - `arun.dev` / `maya.ops` $\rightarrow$ Active paid users (`KEEP`, $0 waste).
   - `rahul.old` (137d) / `sneha.intern` (182d) $\rightarrow$ Inactive paid users (`REVIEW`, flagged).
   - `bot-ci` $\rightarrow$ Missing timestamp (`NO_DATA` / `KEEP`).
   - `guest-user` (210d) $\rightarrow$ Guest free seat (`KEEP`, $0 waste).
5. **Audit Slack:** Click **"Audit Slack"**. Observe discovered candidates:
   - `alex` / `priya` $\rightarrow$ Active paid users (`KEEP`).
   - `karthik` (121d) / `old-intern` (164d) $\rightarrow$ Inactive paid users (`REVIEW`, flagged).
   - `integration-bot` $\rightarrow$ Missing timestamp (`NO_DATA` / `KEEP`).
6. **Review Risk & Savings:** Inspect computed risk levels (`HIGH`, `MEDIUM`, `NONE`) and potential savings ($42/mo GitHub, $16/mo Slack).
7. **Approve Candidate:** Click **"Approve"** on `rahul.old`. Observe state transition to `APPROVED`.
8. **Execute REAP:** Select `rahul.old`, type `REAP` into confirmation box, and click **"Approve Selected"**.
9. **Verify Execution & Audit Trail:** Observe simulated execution modal, updated status `EXECUTED`, and new record in GrimReaper Audit Log.
10. **Verify `NO_DATA` Safety:** Attempting execution on `bot-ci` or `integration-bot` is blocked (`UNSUPPORTED`).

---

## 12. Quick Start

### Prerequisites
- Node.js (v18+ recommended with ES Module support)

### Run Server in Demo Mode (Windows PowerShell)
```powershell
cd c:\webcmd\grimreaper
$env:DEMO_MODE="true"
node --experimental-strip-types src/server.ts
```

### Access Dashboard
Open [http://localhost:3000](http://localhost:3000/) in your browser.

### Run Automated Tests
```powershell
node --test --experimental-strip-types tests/*.test.ts
```

---

## 13. Testing & Verification Proof

The test suite runs using Node.js's native test runner without third-party test dependencies:

```text
# tests 76
# suites 27
# pass 76
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 550.5546
```

### Verified Test Coverage (76 / 76 PASSING):
- ✅ **Risk Engine & Policy:** Inactivity days calculation, threshold evaluation, `KEEP` vs `REVIEW`, future timestamp sanitization, exempt user protection, free seat $0 cost handling.
- ✅ **Savings Calculator:** Monthly and annual potential savings calculations across single and multiple candidates.
- ✅ **Approval State Machine:** Valid state transitions (`DISCOVERED` $\rightarrow$ `FLAGGED` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` $\rightarrow$ `EXECUTED`), rejection handling, `UnauthorizedExecutionError` throw on unapproved candidate execution.
- ✅ **Execution Guardrails:** `NO_DATA` execution blocking, fail-closed handling.
- ✅ **Webcmd CLI Wrapper:** Subprocess execution, JSON parsing, secret sanitization, timeout handling, exit code 77 auth detection.
- ✅ **GitHub & Slack Adapters:** Member normalization, activity timestamp parsing (`parseSlackLastActiveTimestamp`), read-only audit workflow, execution post-verification.
- ✅ **Server & UI Integration:** HTML UI serving, `/api/dashboard`, `/api/audit/github`, `/api/audit/slack`, candidate approval, rejection, and execution routes.
- ✅ **Safe Demo Mode Suite:** GitHub/Slack demo audits, risk engine integration, savings calculations, approval enforcement, safe execution simulation, post-verification, and `DEMO_MODE=false` real adapter preservation.

---

## 14. Security Design Principles

- **Fail Safe:** Missing activity timestamps or unverified evidence are treated as `NO_DATA` (`KEEP`). Automation never assumes missing evidence means inactivity.
- **Human Authorization:** Destructive actions require explicit backend state machine approval (`APPROVED`). Client-side state overrides are rejected.
- **Least Action:** Execution targets only the specifically approved candidate user ID.
- **Post-Verification:** Actions are marked `EXECUTED` only after DOM state re-inspection confirms member removal or deactivation.
- **Centralized Auditability:** All audit decisions, state transitions, and execution results are logged to an append-only audit trail.
- **Credential & Secret Safety:** No credentials, API tokens, or secrets are hard-coded. Webcmd output sanitization redacts sensitive credentials from log outputs.

---

## 15. Tech Stack

- **Language & Runtime:** TypeScript (Node.js ES Modules using `--experimental-strip-types`)
- **Backend Core:** Native Node.js `node:http` API server (zero heavy framework dependencies)
- **Browser Automation Engine:** Webcmd CLI (Subprocess integration via `node:child_process`)
- **Frontend Dashboard:** HTML5, Vanilla CSS (Design Tokens, Glassmorphism, Responsive Grid), Vanilla ES6 JavaScript, HTML5 Canvas (Particle background & Sparklines)
- **Testing Framework:** Native Node.js Test Runner (`node:test`, `node:assert/strict`)

---

## 16. Project Structure

```text
c:\webcmd\grimreaper\
├── docs/                                 # Architecture & Policy documentation
│   ├── SaaS GrimReaper System Architecture.md
│   └── SaaS_GrimReaper_Terms_and_Conditions_Policy.md
├── engine/                               # Reference Python policy implementation
│   └── reference/
├── public/
│   └── index.html                        # Dashboard HTML UI & Control Surface
├── src/
│   ├── adapters/
│   │   ├── github.ts                     # GitHub Audit & Execution Adapter
│   │   └── slack.ts                      # Slack Audit & Execution Adapter
│   ├── approval.ts                       # Approval State Machine & Guardrails
│   ├── audit-logger.ts                   # Append-Only Audit Logger
│   ├── demo-data.ts                      # Synthetic Demo Data Generator
│   ├── models.ts                         # Core Data Models (SaaSSeat, Risk, Savings)
│   ├── orchestrator.ts                   # Central Orchestration Pipeline
│   ├── risk-engine.ts                    # Deterministic Risk Evaluation Engine
│   ├── savings.ts                        # Potential Savings Calculation Engine
│   ├── server.ts                         # HTTP API Server
│   └── webcmd-cli.ts                     # Webcmd CLI Subprocess Wrapper
└── tests/                                # Automated Test Suite (76/76 PASSING)
    ├── demo-mode.test.ts
    ├── github-adapter.test.ts
    ├── grimreaper.test.ts
    ├── offboarding-execution.test.ts
    ├── orchestrator-github.test.ts
    ├── risk-engine-policy.test.ts
    ├── server-ui-integration.test.ts
    └── slack-adapter.test.ts
```

---

## 17. What Is Implemented

- [x] Webcmd CLI subprocess wrapper with secret redaction and auth handoff detection
- [x] GitHub browser audit adapter (People list & Audit Log activity)
- [x] Slack browser audit adapter (Admin Member Directory & timestamp parsing)
- [x] Normalized `SaaSSeat` core data model
- [x] Deterministic Risk Engine (`KEEP` vs `REVIEW`, inactivity thresholds, exempt status)
- [x] `NO_DATA` safety rule (`NO_DATA` is never classified as inactive)
- [x] Potential Savings calculation engine (monthly & annual potential waste)
- [x] Formal Approval State Machine (`DISCOVERED` $\rightarrow$ `FLAGGED` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` $\rightarrow$ `EXECUTED` / `REJECTED`)
- [x] Hard backend execution guardrail (`executeOffboardingGuardrail`)
- [x] DOM Post-verification after offboarding execution
- [x] Append-only audit logger
- [x] HTTP API backend server (`src/server.ts`)
- [x] Full interactive HTML/CSS/JS UI dashboard with live filters and confirmation controls
- [x] Safe Demo Mode (`DEMO_MODE=true`) with synthetic records and safe execution simulation
- [x] 100% passing automated test suite (76/76 tests passing)

---

## 18. Future Work

The following enhancements are planned for future iterations beyond the current hackathon scope:

- **Broader SaaS Platform Adapters:** Expanding browser audit adapters to Google Workspace, Figma, Notion, and Linear.
- **Enterprise Identity & IdP Integration:** Cross-referencing SaaS member lists against Okta / Entra ID employee status.
- **Self-Learning / DOM Recovery:** Dynamic DOM selector adaptation and automated browser error recovery.
- **Custom Policy Configuration UI:** In-dashboard UI for customizing inactivity thresholds and exemption lists.
- **Billing API Verification:** Direct integration with vendor billing APIs to verify actual invoice adjustments post-offboarding.

---

## 19. Design & Product Principle

> **"GrimReaper is not an auto-delete bot."**
>
> *It is an evidence-driven browser agent designed to automate investigation while keeping destructive authority with a human.*

```text
Investigate automatically. Decide with evidence. Act only with approval. Verify everything.
```
