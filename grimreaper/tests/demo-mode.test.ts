/**
 * SaaS GrimReaper Safe Demo Mode Unit & Integration Tests
 *
 * Verifies DEMO_MODE=true behavior, risk engine decisions, savings calculations,
 * approval state enforcement, safe execution simulation, post-verification,
 * and DEMO_MODE=false real adapter preservation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { UnauthorizedExecutionError } from '../src/approval.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';

describe('SaaS GrimReaper Safe Demo Mode Suite', () => {
  let orchestrator: GrimReaperOrchestrator;

  beforeEach(() => {
    orchestrator = new GrimReaperOrchestrator({ demoMode: true });
  });

  it('A. GitHub demo audit returns users', async () => {
    const res = await orchestrator.auditGitHub({ orgName: 'acme-corp' });

    assert.equal(res.audit_result.platform, 'github');
    assert.equal(res.summary.total_seats, 6);
    assert.equal(res.candidates.length, 6);
    assert.equal(res.audit_result.authRequired, false);

    const userIds = res.candidates.map((c) => c.seat.user_id);
    assert.ok(userIds.includes('github_acme-corp_arun.dev'));
    assert.ok(userIds.includes('github_acme-corp_maya.ops'));
    assert.ok(userIds.includes('github_acme-corp_rahul.old'));
    assert.ok(userIds.includes('github_acme-corp_sneha.intern'));
    assert.ok(userIds.includes('github_acme-corp_bot-ci'));
    assert.ok(userIds.includes('github_acme-corp_guest-user'));
  });

  it('B. Slack demo audit returns users', async () => {
    const res = await orchestrator.auditSlack({ workspaceSlug: 'acme-corp' });

    assert.equal(res.audit_result.platform, 'slack');
    assert.equal(res.summary.total_seats, 5);
    assert.equal(res.candidates.length, 5);
    assert.equal(res.audit_result.authRequired, false);

    const userIds = res.candidates.map((c) => c.seat.user_id);
    assert.ok(userIds.includes('slack_acme-corp_alex'));
    assert.ok(userIds.includes('slack_acme-corp_priya'));
    assert.ok(userIds.includes('slack_acme-corp_karthik'));
    assert.ok(userIds.includes('slack_acme-corp_old-intern'));
    assert.ok(userIds.includes('slack_acme-corp_integration-bot'));
  });

  it('C. Active paid user -> KEEP', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const arun = orchestrator.getCandidate('github_acme-corp_arun.dev');
    assert.ok(arun);
    assert.equal(arun.risk.recommendation, 'KEEP');
    assert.equal(arun.risk.flagged, false);
    assert.equal(arun.risk.risk_level, 'NONE');
    assert.equal(arun.approval_state, 'DISCOVERED');

    await orchestrator.auditSlack({ workspaceSlug: 'acme-corp' });
    const alex = orchestrator.getCandidate('slack_acme-corp_alex');
    assert.ok(alex);
    assert.equal(alex.risk.recommendation, 'KEEP');
    assert.equal(alex.risk.flagged, false);
    assert.equal(alex.risk.risk_level, 'NONE');
  });

  it('D. Inactive paid user >= threshold -> REVIEW', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const rahul = orchestrator.getCandidate('github_acme-corp_rahul.old');
    assert.ok(rahul);
    assert.equal(rahul.risk.recommendation, 'REVIEW');
    assert.equal(rahul.risk.flagged, true);
    assert.equal(rahul.risk.inactive_days, 137);
    assert.equal(rahul.risk.risk_level, 'MEDIUM');
    assert.equal(rahul.approval_state, 'FLAGGED');

    const sneha = orchestrator.getCandidate('github_acme-corp_sneha.intern');
    assert.ok(sneha);
    assert.equal(sneha.risk.recommendation, 'REVIEW');
    assert.equal(sneha.risk.flagged, true);
    assert.equal(sneha.risk.inactive_days, 182);
    assert.equal(sneha.risk.risk_level, 'HIGH');

    await orchestrator.auditSlack({ workspaceSlug: 'acme-corp' });
    const karthik = orchestrator.getCandidate('slack_acme-corp_karthik');
    assert.ok(karthik);
    assert.equal(karthik.risk.recommendation, 'REVIEW');
    assert.equal(karthik.risk.flagged, true);
    assert.equal(karthik.risk.inactive_days, 121);
  });

  it('E. Free/exempt user -> KEEP', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const guest = orchestrator.getCandidate('github_acme-corp_guest-user');
    assert.ok(guest);
    assert.equal(guest.seat.paid_seat, false);
    assert.equal(guest.seat.monthly_cost, 0);
    assert.equal(guest.risk.recommendation, 'KEEP');
    assert.equal(guest.risk.flagged, false);
    assert.equal(guest.risk.risk_level, 'NONE');
  });

  it('F. Missing activity -> NO_DATA and NOT inactive', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const botCi = orchestrator.getCandidate('github_acme-corp_bot-ci');
    assert.ok(botCi);
    assert.equal(botCi.seat.last_activity, undefined);
    assert.equal(botCi.risk.inactive_days, null);
    assert.equal(botCi.risk.recommendation, 'KEEP');
    assert.equal(botCi.risk.flagged, false);
    assert.equal(botCi.risk.risk_level, 'NONE');

    await orchestrator.auditSlack({ workspaceSlug: 'acme-corp' });
    const integrationBot = orchestrator.getCandidate('slack_acme-corp_integration-bot');
    assert.ok(integrationBot);
    assert.equal(integrationBot.seat.last_activity, undefined);
    assert.equal(integrationBot.risk.inactive_days, null);
    assert.equal(integrationBot.risk.recommendation, 'KEEP');
    assert.equal(integrationBot.risk.flagged, false);
  });

  it('G. Savings are calculated correctly', async () => {
    const ghRes = await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    // rahul.old ($21) + sneha.intern ($21) = $42/mo, $504/yr
    assert.equal(ghRes.potential_savings.monthly_potential_savings, 42);
    assert.equal(ghRes.potential_savings.annual_potential_savings, 504);
    assert.equal(ghRes.potential_savings.candidate_seat_count, 2);

    const slackRes = await orchestrator.auditSlack({ workspaceSlug: 'acme-corp', monthlyCostPerSeat: 8 });
    // karthik ($8) + old-intern ($8) = $16/mo, $192/yr
    assert.equal(slackRes.potential_savings.monthly_potential_savings, 16);
    assert.equal(slackRes.potential_savings.annual_potential_savings, 192);
    assert.equal(slackRes.potential_savings.candidate_seat_count, 2);
  });

  it('H. Demo approval is still required', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const rahulId = 'github_acme-corp_rahul.old';

    await assert.rejects(
      async () => {
        await orchestrator.executeCandidateOffboarding(rahulId);
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedExecutionError);
        assert.match(err.message, /SECURITY VIOLATION/);
        return true;
      }
    );
  });

  it('I. Demo execution only works after backend approval', async () => {
    await orchestrator.auditGitHub({ orgName: 'acme-corp' });
    const rahulId = 'github_acme-corp_rahul.old';

    // Transition FLAGGED -> PENDING_APPROVAL -> APPROVED
    orchestrator.requestApproval(rahulId);
    assert.equal(orchestrator.getCandidate(rahulId)?.approval_state, 'PENDING_APPROVAL');

    orchestrator.approveCandidate(rahulId);
    assert.equal(orchestrator.getCandidate(rahulId)?.approval_state, 'APPROVED');

    // Execution should now succeed
    const execRes = await orchestrator.executeCandidateOffboarding(rahulId);
    assert.equal(execRes.candidate.approval_state, 'EXECUTED');
    assert.ok(execRes.candidate.executed_at);
  });

  it('J. Demo execution does not invoke real destructive adapters', async () => {
    let realWebcmdCalled = false;
    const customWebcmd = new WebcmdCliWrapper();
    customWebcmd.exec = async () => {
      realWebcmdCalled = true;
      return { success: true, exitCode: 0, stdout: '{}', stderr: '', authRequired: false, durationMs: 5 };
    };

    const demoOrchestrator = new GrimReaperOrchestrator({ demoMode: true, webcmdWrapper: customWebcmd });
    await demoOrchestrator.auditGitHub({ orgName: 'acme-corp' });

    const rahulId = 'github_acme-corp_rahul.old';
    demoOrchestrator.requestApproval(rahulId);
    demoOrchestrator.approveCandidate(rahulId);

    const execRes = await demoOrchestrator.executeCandidateOffboarding(rahulId);

    assert.equal(realWebcmdCalled, false);
    assert.equal(execRes.result.status, 'EXECUTED');
    assert.equal(execRes.result.verified, true);
    assert.deepEqual(execRes.result.details, {
      platform: 'github',
      mode: 'demo',
      action: 'offboarding',
      target: 'rahul.old',
      result: 'success',
      verification: 'passed',
    });
  });

  it('K. Demo post-verification succeeds', async () => {
    await orchestrator.auditSlack({ workspaceSlug: 'acme-corp' });
    const karthikId = 'slack_acme-corp_karthik';

    orchestrator.requestApproval(karthikId);
    orchestrator.approveCandidate(karthikId);

    const execRes = await orchestrator.executeCandidateOffboarding(karthikId);
    assert.equal(execRes.result.verified, true);
    assert.equal(execRes.result.status, 'EXECUTED');

    const logs = orchestrator.getAuditLogger().getRecordsForUser(karthikId);
    const execLog = logs.find((l) => l.action === 'OFFBOARDING_EXECUTED');
    assert.ok(execLog);
    assert.equal(execLog.approval_state, 'EXECUTED');
  });

  it('L. DEMO_MODE=false preserves existing real adapter behavior', async () => {
    let realWebcmdInvoked = false;
    const mockWebcmd = new WebcmdCliWrapper();
    mockWebcmd.exec = async (args) => {
      realWebcmdInvoked = true;
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_test', profileId: 'admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_test', profileId: 'admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 5,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({ data: { members: [], hasNext: false } }),
        stderr: '',
        data: { members: [], hasNext: false },
        authRequired: false,
        durationMs: 5,
      };
    };

    const realOrchestrator = new GrimReaperOrchestrator({ demoMode: false, webcmdWrapper: mockWebcmd });
    await realOrchestrator.auditGitHub({ orgName: 'real-corp' });

    assert.equal(realWebcmdInvoked, true);
  });
});
