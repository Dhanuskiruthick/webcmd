/**
 * SaaS GrimReaper Offboarding Execution Layer Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createGrimReaperServer } from '../src/server.ts';
import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';
import { UnauthorizedExecutionError } from '../src/approval.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { SlackAdapter } from '../src/adapters/slack.ts';

describe('Safe Offboarding Execution Layer Tests', () => {
  let server: ReturnType<typeof createGrimReaperServer>['server'];
  let orchestrator: GrimReaperOrchestrator;
  let mockWebcmd: WebcmdCliWrapper;
  let baseUrl: string;

  before(async () => {
    mockWebcmd = new WebcmdCliWrapper();

    orchestrator = new GrimReaperOrchestrator({
      webcmdWrapper: mockWebcmd,
      riskEngineOptions: { inactivity_threshold_days: 90 },
    });

    const serverObj = createGrimReaperServer(orchestrator);
    server = serverObj.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after((done) => {
    server.close(done);
  });

  // Test 1: Execution without approval -> rejected
  it('should reject execution when candidate is not in APPROVED state', async () => {
    const unapprovedSeat = {
      platform: 'github' as const,
      user_id: 'github_acme_unapproved_user',
      display_name: 'Unapproved User',
      role: 'Member',
      last_activity: '2025-01-01T00:00:00Z',
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };

    orchestrator.ingestSeats([unapprovedSeat], { reference_date: new Date('2026-09-12T00:00:00Z') });

    await assert.rejects(
      async () => {
        await orchestrator.executeCandidateOffboarding('github_acme_unapproved_user');
      },
      (err: Error) => {
        assert.equal(err.name, 'UnauthorizedExecutionError');
        assert.match(err.message, /SECURITY VIOLATION/i);
        return true;
      }
    );
  });

  // Test 2: NO_DATA candidate -> rejected
  it('should reject execution when candidate has NO_DATA (missing activity timestamp)', async () => {
    const noDataSeat = {
      platform: 'github' as const,
      user_id: 'github_acme_nodata_user',
      display_name: 'No Data User',
      role: 'Member',
      last_activity: undefined, // Missing activity
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };

    orchestrator.ingestSeats([noDataSeat]);
    const cand = orchestrator.getCandidate('github_acme_nodata_user');
    if (cand) {
      cand.approval_state = 'APPROVED';
    }

    const res = await orchestrator.executeCandidateOffboarding('github_acme_nodata_user');
    assert.equal(res.result.status, 'UNSUPPORTED');
    assert.equal(res.result.verified, false);
    assert.match(res.result.message, /NO_DATA/i);

    // Verify candidate was NOT set to EXECUTED
    const updatedCand = orchestrator.getCandidate('github_acme_nodata_user');
    assert.equal(updatedCand?.approval_state, 'APPROVED');
  });

  // Test 3: Unknown candidate -> rejected
  it('should throw when attempting execution on an unknown candidate user ID', async () => {
    await assert.rejects(async () => {
      await orchestrator.executeCandidateOffboarding('unknown_nonexistent_user_xyz');
    });
  });

  // Test 4: GitHub execution success using mocked Webcmd
  it('should execute GitHub member removal successfully and post-verify in browser', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[], input?: string): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_exec_gh', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_exec_gh', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'EXECUTED', verified: true, message: 'Successfully removed member from GitHub organization.' }),
        stderr: '',
        data: { status: 'EXECUTED', verified: true, message: 'Successfully removed member from GitHub organization.' },
        authRequired: false,
        durationMs: 40,
      };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const execRes = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'octocat' });

    assert.equal(execRes.status, 'EXECUTED');
    assert.equal(execRes.verified, true);
    assert.equal(execRes.platform, 'github');
    assert.match(execRes.message, /Successfully removed/i);
  });

  // Test 5: GitHub auth failure
  it('should return AUTH_REQUIRED status when Webcmd detects missing session credentials', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create')) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Authentication required. Profile github-admin requires login.',
          authRequired: true,
          durationMs: 15,
          errorDiagnostic: 'Authentication required. Profile github-admin requires login.',
        };
      }
      return { success: true, exitCode: 0, stdout: '{}', stderr: '', authRequired: false, durationMs: 5 };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const res = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'target_user' });

    assert.equal(res.status, 'AUTH_REQUIRED');
    assert.equal(res.verified, false);
  });

  // Test 6: GitHub access denied
  it('should return ACCESS_DENIED when browser page detects non-owner role or 403', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_denied', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_denied', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'ACCESS_DENIED', verified: false, message: 'Access denied to organization people admin page.' }),
        stderr: '',
        data: { status: 'ACCESS_DENIED', verified: false, message: 'Access denied to organization people admin page.' },
        authRequired: false,
        durationMs: 30,
      };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const res = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'target_user' });

    assert.equal(res.status, 'ACCESS_DENIED');
    assert.equal(res.verified, false);
  });

  // Test 7: Target not found
  it('should return NOT_FOUND when target user is absent from organization member list', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_notfound', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_notfound', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'NOT_FOUND', verified: false, message: 'Target member not found in organization member directory.' }),
        stderr: '',
        data: { status: 'NOT_FOUND', verified: false, message: 'Target member not found in organization member directory.' },
        authRequired: false,
        durationMs: 30,
      };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const res = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'ghost_user' });

    assert.equal(res.status, 'NOT_FOUND');
    assert.equal(res.verified, false);
  });

  // Test 8: Verification failure
  it('should return VERIFICATION_FAILED if member remains in org after removal action', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_verif_fail', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_verif_fail', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'VERIFICATION_FAILED', verified: false, message: 'Post-verification failed: member remains present in org.' }),
        stderr: '',
        data: { status: 'VERIFICATION_FAILED', verified: false, message: 'Post-verification failed: member remains present in org.' },
        authRequired: false,
        durationMs: 30,
      };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const res = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'stubborn_user' });

    assert.equal(res.status, 'VERIFICATION_FAILED');
    assert.equal(res.verified, false);
  });

  // Test 9: Execution failure
  it('should return EXECUTION_FAILED on unexpected DOM state or command failure', async () => {
    const ghAdapterWebcmd = new WebcmdCliWrapper();
    ghAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_exec_fail', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_exec_fail', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'EXECUTION_FAILED', verified: false, message: 'Removal button or action controls not found for target member.' }),
        stderr: '',
        data: { status: 'EXECUTION_FAILED', verified: false, message: 'Removal button or action controls not found for target member.' },
        authRequired: false,
        durationMs: 30,
      };
    };

    const customAdapter = new GitHubAdapter(ghAdapterWebcmd);
    const res = await customAdapter.executeMemberOffboarding({ orgName: 'acme-corp', username: 'broken_dom_user' });

    assert.equal(res.status, 'EXECUTION_FAILED');
    assert.equal(res.verified, false);
  });

  // Test 10: Successful audit logging
  it('should write sanitized audit event logs for execution attempts', async () => {
    const seat = {
      platform: 'github' as const,
      user_id: 'github_acme_audit_logged_user',
      display_name: 'Audit Logged User',
      role: 'Member',
      last_activity: '2025-01-01T00:00:00Z',
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };

    const execWebcmd = new WebcmdCliWrapper();
    execWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_log_test', profileId: 'github-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_log_test', profileId: 'github-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ status: 'EXECUTED', verified: true, message: 'Member removed.' }),
        stderr: '',
        data: { status: 'EXECUTED', verified: true, message: 'Member removed.' },
        authRequired: false,
        durationMs: 20,
      };
    };

    const orch = new GrimReaperOrchestrator({ webcmdWrapper: execWebcmd });
    orch.ingestSeats([seat], { reference_date: new Date('2026-09-12T00:00:00Z') });
    orch.requestApproval('github_acme_audit_logged_user');
    orch.approveCandidate('github_acme_audit_logged_user');

    await orch.executeCandidateOffboarding('github_acme_audit_logged_user');

    const logs = orch.getAuditLogger().getRecordsForUser('github_acme_audit_logged_user');
    assert.ok(logs.length >= 3);
    const execLog = logs.find((l) => l.action === 'OFFBOARDING_EXECUTED');
    assert.ok(execLog);
    assert.equal(execLog?.approval_state, 'EXECUTED');
  });

  // Test 11: Slack supported/unsupported behavior
  it('should return UNSUPPORTED or structured status for Slack deactivation when selectors are missing', async () => {
    const slackAdapterWebcmd = new WebcmdCliWrapper();
    slackAdapterWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_slack_exec', profileId: 'slack-admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_slack_exec', profileId: 'slack-admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          status: 'UNSUPPORTED',
          verified: false,
          message: 'Slack user deactivation requires manual enterprise 2FA or owner authorization on this workspace tier.',
        }),
        stderr: '',
        data: {
          status: 'UNSUPPORTED',
          verified: false,
          message: 'Slack user deactivation requires manual enterprise 2FA or owner authorization on this workspace tier.',
        },
        authRequired: false,
        durationMs: 30,
      };
    };

    const slackAdapter = new SlackAdapter(slackAdapterWebcmd);
    const res = await slackAdapter.executeMemberOffboarding({ workspaceSlug: 'acme-corp', userId: 'U_SLACK_TEST' });

    assert.equal(res.status, 'UNSUPPORTED');
    assert.equal(res.verified, false);
    assert.match(res.message, /Slack user deactivation/i);
  });

  // Test 12: API endpoint validation
  it('should validate API requests and enforce APPROVED state on POST /api/candidates/execute', async () => {
    // 1. Missing userId -> 400
    const res400 = await fetch(`${baseUrl}/api/candidates/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res400.status, 400);

    // 2. Unknown userId -> 404
    const res404 = await fetch(`${baseUrl}/api/candidates/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'nonexistent_user_999' }),
    });
    assert.equal(res404.status, 404);

    // 3. Unapproved candidate -> 403
    const unapprovedSeat = {
      platform: 'github' as const,
      user_id: 'github_acme_api_unapproved',
      display_name: 'API Unapproved',
      role: 'Member',
      last_activity: '2025-01-01T00:00:00Z',
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };
    orchestrator.ingestSeats([unapprovedSeat], { reference_date: new Date('2026-09-12T00:00:00Z') });

    const res403 = await fetch(`${baseUrl}/api/candidates/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'github_acme_api_unapproved' }),
    });
    assert.equal(res403.status, 403);
    const body403 = await res403.json();
    assert.equal(body403.status, 'UNAUTHORIZED_STATE');
  });

  // Test 13: Client cannot bypass approval state by sending approved=true
  it('should reject execution even if client sends approved=true in body on an unapproved candidate', async () => {
    const unapprovedSeat = {
      platform: 'github' as const,
      user_id: 'github_acme_bypass_attempt',
      display_name: 'Bypass Attempt User',
      role: 'Member',
      last_activity: '2025-01-01T00:00:00Z',
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };
    orchestrator.ingestSeats([unapprovedSeat], { reference_date: new Date('2026-09-12T00:00:00Z') });

    const res = await fetch(`${baseUrl}/api/candidates/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'github_acme_bypass_attempt', approved: true, approval_state: 'APPROVED' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.status, 'UNAUTHORIZED_STATE');

    // Candidate in orchestrator must remain FLAGGED
    const cand = orchestrator.getCandidate('github_acme_bypass_attempt');
    assert.equal(cand?.approval_state, 'FLAGGED');
  });
});
