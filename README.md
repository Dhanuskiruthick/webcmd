# SaaS GrimReaper

## Ghost License & Shadow IT Offboarding Agent

> **Investigate automatically. Decide with evidence. Act only with approval. Verify everything.**

Organizations accumulate SaaS accounts and paid seats that may no longer be actively used. Finding these accounts, validating whether they are genuinely inactive, estimating potential savings, and safely offboarding them is repetitive administrative work — and automating it carelessly can create security and operational risk.

**SaaS GrimReaper** is a browser-based SaaS security and IT automation agent that investigates workspaces such as GitHub and Slack, collects user and activity evidence, identifies potentially abandoned paid seats, evaluates risk, estimates potential savings, and guides approved offboarding through a human-in-the-loop workflow.

```text
Browser Evidence
       │
       ▼
Risk Assessment
       │
       ▼
Potential Savings
       │
       ▼
Human Approval
       │
       ▼
Safe Action
       │
       ▼
Post-Verification
       │
       ▼
Audit Trail
```

---

## Why GrimReaper?

SaaS administration contains a large amount of repetitive browser work:

* Find users and their roles
* Check activity evidence
* Determine whether a seat is paid or free
* Identify exceptions
* Assess inactivity risk
* Estimate potential savings
* Obtain authorization
* Perform the administrative action
* Verify the result
* Record what happened

The difficult part is not clicking **Delete**.

The difficult part is deciding **whether deletion is actually safe**.

> **GrimReaper automates the investigation while keeping destructive authority with a human.**

---

# The Solution

GrimReaper separates the workflow into distinct stages:

```text
Evidence
   ↓
Decision
   ↓
Authorization
   ↓
Action
   ↓
Verification
   ↓
Audit
```

This prevents browser automation from becoming uncontrolled account deletion.

The system:

1. Audits a SaaS workspace
2. Normalizes platform evidence into a common model
3. Evaluates the account using security/risk policies
4. Calculates potential license savings
5. Flags candidates for review
6. Requires explicit human approval
7. Executes only approved actions
8. Verifies the resulting state
9. Records the decision and action in an audit trail

---

# Architecture

```text
                         ┌──────────────────┐
                         │       User       │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ GrimReaper UI    │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Orchestrator   │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
             ┌──────────────┐           ┌──────────────┐
             │ Webcmd       │           │ Webcmd       │
             │ GitHub       │           │ Slack        │
             │ Adapter      │           │ Adapter      │
             └──────┬───────┘           └──────┬───────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
                         ┌──────────────────┐
                         │ Evidence /       │
                         │ SaaSSeat         │
                         │ Normalization    │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │   Risk Engine    │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │ Savings Engine   │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │ Human Approval   │
                         │      Gate        │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │ Safe Execution   │
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │ Post-Verification│
                         └────────┬─────────┘
                                  ▼
                         ┌──────────────────┐
                         │    Audit Log     │
                         └──────────────────┘
```

### Core Components

| Component                  | Responsibility                                       |
| -------------------------- | ---------------------------------------------------- |
| **Webcmd Layer**           | Browser-based SaaS interaction                       |
| **Platform Adapters**      | GitHub and Slack-specific auditing/actions           |
| **SaaSSeat Model**         | Normalized representation of SaaS users/seats        |
| **Risk Engine**            | Determines whether a seat should be kept or reviewed |
| **Savings Engine**         | Calculates potential license savings                 |
| **Approval State Machine** | Controls authorization before destructive actions    |
| **Execution Layer**        | Performs approved offboarding safely                 |
| **Verification Layer**     | Confirms the expected post-action state              |
| **Audit Logger**           | Records decisions and actions                        |

---

# Browser Agent Architecture

GrimReaper is designed around **browser-driven administrative workflows**.

The Webcmd integration provides the browser interaction layer used by the platform adapters.

The implementation includes:

* Webcmd CLI integration
* Authenticated browser sessions/profiles
* Browser-based auditing
* Platform-specific GitHub and Slack adapters
* Isolated execution sessions
* Timeout and retry handling
* Authentication/access detection
* Post-action verification

The browser is treated as the operational interface, while the GrimReaper backend controls the decision and authorization logic.

> The current implementation does **not** claim self-learning or automatic workflow recovery.

---

# Evidence-Driven Risk Engine

GrimReaper does not simply identify old accounts and delete them.

It evaluates evidence.

| Situation                                 | Decision           |
| ----------------------------------------- | ------------------ |
| Active paid seat                          | `KEEP`             |
| Paid seat inactive ≥ configured threshold | `REVIEW`           |
| Free / exempt seat                        | `KEEP`             |
| Activity evidence unavailable             | `NO_DATA` / `KEEP` |

## NO_DATA ≠ INACTIVE

This is one of GrimReaper's most important safety rules.

A missing activity timestamp is an **absence of evidence**, not proof of inactivity.

Therefore:

```text
Missing Activity Evidence
          │
          ▼
       NO_DATA
          │
          ▼
      FAIL SAFE
          │
          ▼
     DO NOT OFFBOARD
```

This prevents the agent from making a destructive decision based on an assumption.

The risk engine supports a configurable inactivity threshold and produces risk assessments that are consumed by the existing orchestration and approval workflow.

---

# Potential Savings

Once a seat is determined to be an eligible paid candidate, GrimReaper calculates **potential** savings.

```text
Potential Annual Savings
=
Eligible Monthly Seat Cost × 12
```

For example:

```text
$21/month × 12
=
$252 potential annual savings
```

The system deliberately calls these **potential savings** rather than guaranteed savings.

Actual billing impact depends on the SaaS provider, subscription plan, billing cycle, and account-management behavior.

---

# Human-in-the-Loop Safety

GrimReaper is **not an autonomous deletion bot**.

Destructive actions are controlled by an explicit approval state machine.

```text
DISCOVERED
    │
    ▼
FLAGGED
    │
    ▼
PENDING_APPROVAL
    │
    ├──────────────► REJECTED
    │
    ▼
APPROVED
    │
    ▼
EXECUTED
    │
    ▼
VERIFIED
```

### Security Controls

**Backend Authorization**

The backend is authoritative. A frontend request cannot simply declare that an account is approved.

**Explicit Approval**

A candidate must reach the `APPROVED` state before execution.

**NO_DATA Protection**

Candidates without sufficient activity evidence are not treated as inactive and cannot be destructively executed through the normal flow.

**Fail Closed**

Execution failures do not silently become successful offboarding operations.

**Post-Verification**

Execution is not considered complete until the expected state is verified.

**Auditability**

Important decisions and actions are recorded in the audit log.

> **Automate investigation. Keep authority with the human.**

---

# GitHub Integration

GrimReaper includes a GitHub platform adapter for browser-based workspace auditing and approved member offboarding.

The adapter supports the normalized GrimReaper workflow:

```text
GitHub Workspace
      ↓
Audit Evidence
      ↓
SaaSSeat
      ↓
Risk Assessment
      ↓
Approval
      ↓
Approved Action
      ↓
Post-Verification
      ↓
Audit Log
```

In real adapter mode, approved execution is performed through an isolated browser session and followed by verification.

---

# Slack Integration

GrimReaper also includes a Slack platform adapter.

The Slack adapter follows the same normalized workflow while keeping platform-specific behavior inside the adapter layer.

```text
Slack Workspace
      ↓
Audit Evidence
      ↓
SaaSSeat
      ↓
Risk Assessment
      ↓
Approval
      ↓
Safe Deactivation
      ↓
Post-Verification
      ↓
Audit Log
```

Unsupported or restricted cases fail safely instead of pretending that an action succeeded.

Provider capabilities can vary depending on workspace configuration and subscription tier.

---

# Safe Demo Mode

For the hackathon live demonstration, GrimReaper provides an isolated **DEMO_MODE**.

This allows the complete workflow to be demonstrated without modifying real user accounts.

```powershell
$env:DEMO_MODE="true"
```

Demo mode uses synthetic GitHub and Slack workspace records containing:

* Active paid users
* Inactive paid users
* Free/exempt users
* Missing-activity `NO_DATA` cases
* Potential savings
* Approval workflow
* Simulated execution
* Post-verification
* Audit logging

The demo data still passes through the same application pipeline:

```text
Demo Evidence
     ↓
SaaSSeat
     ↓
Risk Engine
     ↓
Savings Engine
     ↓
Approval
     ↓
Simulated Execution
     ↓
Verification
     ↓
Audit Log
```

### Demo Safety

`DEMO_MODE`:

* Uses synthetic identities
* Does not modify real GitHub accounts
* Does not modify real Slack accounts
* Does not invoke real destructive platform actions
* Still enforces the backend approval state
* Still demonstrates post-verification
* Still records audit events

The real platform adapter path remains preserved when demo mode is disabled.

---

# Judge Demo — 90 Seconds

The strongest demonstration flow is:

```text
1. Open GrimReaper
        ↓
2. Audit GitHub
        ↓
3. Show active + inactive + NO_DATA users
        ↓
4. Audit Slack
        ↓
5. Select an inactive paid seat
        ↓
6. Show evidence + risk
        ↓
7. Show potential savings
        ↓
8. Approve candidate
        ↓
9. REAP
        ↓
10. Show verification
        ↓
11. Show audit log
```

### The Two Moments to Highlight

#### 1. NO_DATA

> "GrimReaper does not confuse missing evidence with inactivity."

#### 2. Human Approval

> "Even when the agent identifies a risky candidate, it cannot perform the destructive action until the backend records explicit approval."

These demonstrate that the system is designed around **safe automation**, not simply automation.

---

# Quick Start

## Requirements

* Node.js
* Webcmd
* Windows PowerShell for the demonstrated setup

## Run Demo Mode

From the project directory:

```powershell
cd C:\webcmd\grimreaper

$env:DEMO_MODE="true"

node --experimental-strip-types src/server.ts
```

Open:

```text
http://localhost:3000
```

---

# Run Tests

Execute the complete test suite:

```powershell
node --test --experimental-strip-types tests/*.test.ts
```

Current verified result:

```text
76 tests
76 passing
0 failing
```

---

# Testing

The automated test suite covers the major security and application layers, including:

* Core foundation
* SaaS seat normalization
* Risk engine
* Savings calculation
* GitHub adapter
* Slack adapter
* Orchestrator integration
* Server/UI integration
* Approval enforcement
* Safe execution
* NO_DATA handling
* Post-execution verification
* Audit logging
* Demo mode
* Execution guardrails

The current verified baseline is:

> **76 / 76 tests passing — 0 failures**

---

# Security Design Principles

## 1. Fail Safe

Missing evidence is never automatically interpreted as inactivity.

## 2. Human Authorization

Destructive actions require explicit backend approval.

## 3. Least Action

Only the approved target can proceed to execution.

## 4. Verify

The system checks the resulting state instead of assuming execution succeeded.

## 5. Auditability

Decisions, actions and verification results are recorded.

## 6. Credential Safety

Credentials and secrets are not hard-coded into the project.

---

# Tech Stack

The current implementation uses:

* **TypeScript**
* **Node.js**
* **Webcmd**
* **HTML / CSS / JavaScript**
* **Node.js HTTP server**
* **Node native test runner**

The project intentionally keeps the core architecture lightweight so the browser-agent workflow and security controls remain visible and understandable.

---

# Project Structure

```text
grimreaper/
│
├── src/
│   ├── adapters/
│   │   ├── github.ts
│   │   └── slack.ts
│   │
│   ├── approval.ts
│   ├── audit-logger.ts
│   ├── demo-data.ts
│   ├── models.ts
│   ├── orchestrator.ts
│   ├── risk-engine.ts
│   ├── savings.ts
│   ├── server.ts
│   └── webcmd-cli.ts
│
├── public/
│   └── index.html
│
├── tests/
│
├── docs/
│
├── engine/
│   └── reference/
│
└── README.md
```

### Key Files

| File                 | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `orchestrator.ts`    | Coordinates the complete workflow               |
| `risk-engine.ts`     | Evidence-based risk evaluation                  |
| `savings.ts`         | Potential savings calculation                   |
| `approval.ts`        | Approval state machine and execution guardrails |
| `audit-logger.ts`    | Audit trail                                     |
| `webcmd-cli.ts`      | Webcmd browser integration                      |
| `adapters/github.ts` | GitHub-specific browser workflow                |
| `adapters/slack.ts`  | Slack-specific browser workflow                 |
| `demo-data.ts`       | Isolated synthetic demo workspace               |
| `server.ts`          | Application server/API                          |
| `public/index.html`  | GrimReaper dashboard                            |

---

# Implemented

* [x] Browser-based SaaS auditing
* [x] GitHub adapter
* [x] Slack adapter
* [x] SaaSSeat normalization
* [x] Evidence-driven risk assessment
* [x] Configurable inactivity threshold
* [x] NO_DATA safety handling
* [x] Potential savings calculation
* [x] Human approval state machine
* [x] Backend execution authorization
* [x] Safe offboarding execution layer
* [x] Post-execution verification
* [x] Audit logging
* [x] Safe DEMO_MODE
* [x] Automated tests

---

# Future Work

The current prototype can be extended with:

* Self-learning workflow recovery
* Additional SaaS integrations
* Richer billing verification
* Configurable organization policies
* Enterprise identity and billing integrations
* Production deployment and observability

These are future improvements and are **not represented as current implemented functionality**.

---

# Why It Matters

SaaS administration is full of repetitive browser work.

GrimReaper turns that work into an **evidence-driven security workflow** without removing human control over destructive decisions.

It brings together browser automation, risk assessment, cost analysis, approval controls, verification and auditability in a single workflow.

> **GrimReaper is not an auto-delete bot. It automates investigation while keeping destructive authority with a human.**

```text
Investigate automatically.
Decide with evidence.
Act only with approval.
Verify everything.
```
