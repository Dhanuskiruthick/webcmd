# SaaS GrimReaper System Architecture & Technical Specification

## 1. Overview & Business Objectives

SaaS GrimReaper is an automated SaaS seat audit, risk classification, potential savings estimation, and safe offboarding execution engine built on top of Webcmd browser automation.

### Key Objectives
* **Deterministic Auditing:** Extract real member activity timestamps from browser-accessible admin portals and audit logs.
* **Risk & Policy Engine:** Evaluate seat inactivity conservatively without inferring inactivity from missing data (`NO_DATA`).
* **Savings Estimation:** Compute potential monthly and annual license waste without claiming guaranteed billing reduction.
* **Mandatory Human Approval:** State machine guardrails enforce explicit human approval before any offboarding action can reach execution.
* **Safe Execution Layer:** Isolated Webcmd browser sessions execute targeted de-provisioning only after verification.

---

## 2. Component Architecture

```
User (Browser Dashboard)
  │
  ▼
HTTP Server & API (src/server.ts)
  │
  ▼
GrimReaper Orchestrator (src/orchestrator.ts)
  ├──► GitHub Adapter (src/adapters/github.ts) ──► Webcmd CLI Subprocess ──► Browser Automation
  └──► Slack Adapter  (src/adapters/slack.ts)  ──► Webcmd CLI Subprocess ──► Browser Automation
  │
  ▼
Risk & Policy Engine (src/risk-engine.ts)
  │
  ▼
Potential Savings Engine (src/savings.ts)
  │
  ▼
Approval State Machine (src/approval.ts)
  │
  ▼
Safe Execution Layer (adapters executeMemberOffboarding)
  │
  ▼
Sanitized Audit Logger (src/audit-logger.ts)
```

---

## 3. Core Principles & Business Rules

1. **Rule 1 — Mandatory Human Approval:** Offboarding actions cannot execute automatically. Human sign-off is mandatory.
2. **Rule 2 — NO_DATA Protection:** Missing activity timestamps or unparseable dates are treated as `NO_DATA` (`KEEP` policy, `LOW`/`NONE` risk).
3. **Rule 3 — Unpaid Seat Exclusion:** Unpaid/free seats (guests, free tier) do not incur direct cost waste.
4. **Rule 4 — Exempt User Protection:** Users marked exempt are never flagged for offboarding review.
5. **Rule 5 — Future Timestamp Sanitization:** Future timestamps in `last_activity` are treated as invalid (`NO_DATA`).
6. **Rule 6 — Potential Savings Labeling:** Savings are labeled strictly as *POTENTIAL* until billing reduction is confirmed.
7. **Rule 7 — Strict Post-Verification:** Execution routines re-verify browser state before marking candidate as `EXECUTED`.

---

## 4. Platform Adapter Specifications

### GitHub Adapter
* **Directory Inspection:** `https://github.com/orgs/<org>/people`
* **Activity Source:** GitHub Organization Audit Log (`https://github.com/organizations/<org>/settings/audit-log?q=actor:<user>`)
* **Execution:** Targeted member removal via Webcmd session with DOM post-verification.

### Slack Adapter
* **Directory Inspection:** `https://<workspace>.slack.com/admin/users`
* **Activity Source:** Last active timestamp string on workspace member list.
* **Execution:** User deactivation for supported tiers; returns `UNSUPPORTED` if manual enterprise 2FA is required.

---

## 5. Security & Safety Controls

* **Credential Redaction:** Secrets and auth cookies are automatically sanitized from logs via `sanitizeLogs()`.
* **Isolated Sessions:** Each audit or execution runs in an isolated Webcmd CLI subprocess.
* **Fail-Closed Guardrails:** Any uncertainty during browser navigation returns `AUTH_REQUIRED`, `ACCESS_DENIED`, `EXECUTION_FAILED`, or `UNSUPPORTED`.
