/**
 * GrimReaper Orchestrator GitHub Integration Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';

describe('GrimReaper Orchestrator GitHub Integration Tests', () => {
  const refDate = new Date('2026-09-12T12:00:00Z');

  // Test 1: Successful GitHub Audit -> Orchestrator Ingestion
  it('should run auditGitHub, ingest seats, evaluate risk, and calculate potential savings', async () => {
    const mockWebcmd = new WebcmdCliWrapper();
    let callCount = 0;

    mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      callCount++;
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_orch_1', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_orch_1', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 20,
        };
      }

      // Member list
      if (callCount === 2) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            members: [
              { username: 'active_dev', display_name: 'Active Dev', role: 'Member', two_factor_enabled: true },
              { username: 'inactive_dev', display_name: 'Inactive Dev', role: 'Member', two_factor_enabled: false },
            ],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            members: [
              { username: 'active_dev', display_name: 'Active Dev', role: 'Member', two_factor_enabled: true },
              { username: 'inactive_dev', display_name: 'Inactive Dev', role: 'Member', two_factor_enabled: false },
            ],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 80,
        };
      }

      // Audit log for active_dev (2 days inactive)
      if (callCount === 3) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-09-10T12:00:00.000Z' }),
          stderr: '',
          data: { auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-09-10T12:00:00.000Z' },
          authRequired: false,
          durationMs: 90,
        };
      }

      // Audit log for inactive_dev (120 days inactive)
      if (callCount === 4) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ auth_required: false, access_denied: false, action: 'org.invite', timestamp: '2026-05-10T12:00:00.000Z' }),
          stderr: '',
          data: { auth_required: false, access_denied: false, action: 'org.invite', timestamp: '2026-05-10T12:00:00.000Z' },
          authRequired: false,
          durationMs: 90,
        };
      }

      return { success: true, exitCode: 0, stdout: '{}', stderr: '', data: {}, authRequired: false, durationMs: 10 };
    };

    const orchestrator = new GrimReaperOrchestrator({
      riskEngineOptions: { reference_date: refDate, inactivity_threshold_days: 90 },
      webcmdWrapper: mockWebcmd,
    });

    const result = await orchestrator.auditGitHub({ orgName: 'acme-corp', monthlyCostPerSeat: 21.0 });

    assert.equal(result.summary.total_seats, 2);
    assert.equal(result.summary.flagged_seats, 1);
    assert.equal(result.summary.auth_required, false);
    assert.equal(result.summary.audit_log_access_denied, false);

    assert.equal(result.candidates.length, 2);
    assert.equal(result.potential_savings.candidate_seat_count, 1);
    assert.equal(result.potential_savings.monthly_potential_savings, 21.0);
    assert.equal(result.potential_savings.annual_potential_savings, 252.0);

    // Audit Log records verification
    const logs = orchestrator.getAuditLogger().getRecords();
    const completedLog = logs.find((l) => l.action === 'GITHUB_AUDIT_COMPLETED');
    assert.ok(completedLog);
    assert.match(completedLog.risk_decision, /Discovered 2 seats \(1 flagged\)/);
  });

  // Test 2: NO_DATA Activity Handling
  it('should handle members with NO_DATA without incorrectly flagging them as inactive', async () => {
    const mockWebcmd = new WebcmdCliWrapper();
    let callCount = 0;

    mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      callCount++;
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_orch_2', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_orch_2', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 20,
        };
      }

      if (callCount === 2) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            members: [{ username: 'nodata_user', display_name: 'No Data', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            members: [{ username: 'nodata_user', display_name: 'No Data', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 80,
        };
      }

      // Audit log returns null timestamp (no activity)
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ auth_required: false, access_denied: false, action: null, timestamp: null }),
        stderr: '',
        data: { auth_required: false, access_denied: false, action: null, timestamp: null },
        authRequired: false,
        durationMs: 50,
      };
    };

    const orchestrator = new GrimReaperOrchestrator({
      riskEngineOptions: { reference_date: refDate, inactivity_threshold_days: 90 },
      webcmdWrapper: mockWebcmd,
    });

    const result = await orchestrator.auditGitHub({ orgName: 'nodata-org' });

    assert.equal(result.summary.total_seats, 1);
    assert.equal(result.summary.flagged_seats, 0);

    const candidate = result.candidates[0];
    assert.equal(candidate.risk.flagged, false);
    assert.equal(candidate.risk.risk_level, 'NONE');
    assert.equal(candidate.approval_state, 'DISCOVERED');
    assert.match(candidate.risk.reason, /No valid activity timestamp available/i);
  });

  // Test 3: Audit Log Access Denied (Non-Owner Account)
  it('should handle audit-log access denial (non-owner) safely without throwing uncontrolled errors', async () => {
    const mockWebcmd = new WebcmdCliWrapper();
    let callCount = 0;

    mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      callCount++;
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_orch_3', profileId: 'github-member', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_orch_3', profileId: 'github-member', kind: 'explicit' },
          authRequired: false,
          durationMs: 20,
        };
      }

      if (callCount === 2) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            members: [{ username: 'member_1', display_name: 'Member 1', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            members: [{ username: 'member_1', display_name: 'Member 1', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 80,
        };
      }

      // Audit log returns access_denied: true
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ auth_required: false, access_denied: true, action: null, timestamp: null }),
        stderr: '',
        data: { auth_required: false, access_denied: true, action: null, timestamp: null },
        authRequired: false,
        durationMs: 50,
      };
    };

    const orchestrator = new GrimReaperOrchestrator({ webcmdWrapper: mockWebcmd });
    const result = await orchestrator.auditGitHub({ orgName: 'nonowner-org' });

    assert.equal(result.summary.auth_required, false);
    assert.equal(result.summary.audit_log_access_denied, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].seat.metadata?.audit_log_access_denied, true);
  });

  // Test 4: Auth Required Handling
  it('should handle authRequired safely and log GITHUB_AUDIT_AUTH_REQUIRED audit entry', async () => {
    const mockWebcmd = new WebcmdCliWrapper();

    mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create')) {
        return {
          success: false,
          exitCode: 77,
          stdout: '',
          stderr: 'error: SESSION_PAUSED_FOR_HUMAN_HANDOFF for session github-audit',
          data: null,
          authRequired: true,
          durationMs: 50,
          errorDiagnostic: 'Human sign-in required',
        };
      }
      return { success: true, exitCode: 0, stdout: '{}', stderr: '', data: {}, authRequired: false, durationMs: 10 };
    };

    const orchestrator = new GrimReaperOrchestrator({ webcmdWrapper: mockWebcmd });
    const result = await orchestrator.auditGitHub({ orgName: 'unauth-org' });

    assert.equal(result.summary.auth_required, true);
    assert.equal(result.summary.total_seats, 0);

    const logs = orchestrator.getAuditLogger().getRecords();
    const authLog = logs.find((l) => l.action === 'GITHUB_AUDIT_AUTH_REQUIRED');
    assert.ok(authLog);
  });

  // Test 5: Read-Only Audit Mode Confirmation
  it('should confirm that audit commands issue strictly read-only browser operations', async () => {
    const issuedArgs: string[][] = [];
    const mockWebcmd = new WebcmdCliWrapper();

    mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      issuedArgs.push(args);
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_orch_4', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_orch_4', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 20,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          authRequired: false,
          members: [{ username: 'readonly_user', display_name: 'ReadOnly', role: 'Member', two_factor_enabled: true }],
          hasNext: false,
        }),
        stderr: '',
        data: {
          authRequired: false,
          members: [{ username: 'readonly_user', display_name: 'ReadOnly', role: 'Member', two_factor_enabled: true }],
          hasNext: false,
        },
        authRequired: false,
        durationMs: 80,
      };
    };

    const orchestrator = new GrimReaperOrchestrator({ webcmdWrapper: mockWebcmd });
    const result = await orchestrator.auditGitHub({ orgName: 'readonly-org', fetchAuditLogActivity: false });

    assert.equal(result.audit_result.evidence.read_only_confirmed, true);

    const allArgsText = issuedArgs.map((a) => a.join(' ')).join('\n');
    assert.doesNotMatch(allArgsText, /delete|remove|invite|kick|revoke/i);
  });
});
