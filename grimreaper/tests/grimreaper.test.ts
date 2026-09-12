/**
 * SaaS GrimReaper Core Foundation Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SaaSSeat } from '../src/models.ts';
import { calculateInactiveDays, RiskEngine } from '../src/risk-engine.ts';
import { calculatePotentialSavings } from '../src/savings.ts';
import { executeOffboardingGuardrail, UnauthorizedExecutionError } from '../src/approval.ts';
import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, sanitizeLogs, isAuthRequiredOutput } from '../src/webcmd-cli.ts';

describe('SaaS GrimReaper Foundation Unit Tests', () => {
  // Reference date: 2026-09-12T12:00:00Z
  const refDate = new Date('2026-09-12T12:00:00Z');

  // 1. Inactivity Calculation Test
  describe('Inactivity Calculation', () => {
    it('should correctly calculate inactive days relative to reference date', () => {
      // 10 days before refDate
      const activeIso = '2026-09-02T12:00:00Z';
      const days = calculateInactiveDays(activeIso, refDate);
      assert.equal(days, 10);
    });

    it('should return null for missing or invalid last_activity string', () => {
      assert.equal(calculateInactiveDays(undefined, refDate), null);
      assert.equal(calculateInactiveDays('', refDate), null);
      assert.equal(calculateInactiveDays('invalid-date', refDate), null);
    });
  });

  // 2. Exempt User Handling Test
  describe('Exempt User Handling', () => {
    it('should NOT flag an exempt user even if inactive for 200 days', () => {
      const riskEngine = new RiskEngine(90);
      const seat: SaaSSeat = {
        platform: 'github',
        user_id: 'gh_user_exempt',
        display_name: 'Exempt User',
        role: 'Admin',
        last_activity: '2026-01-01T00:00:00Z', // ~254 days inactive
        paid_seat: true,
        monthly_cost: 21.0,
        exempt: true,
      };

      const assessment = riskEngine.evaluateSeat(seat, { reference_date: refDate });
      assert.equal(assessment.flagged, false);
      assert.equal(assessment.risk_level, 'NONE');
      assert.match(assessment.reason, /exempt/i);
    });
  });

  // 3. Unpaid Seat Handling Test
  describe('Unpaid Seat Handling', () => {
    it('should NOT flag an unpaid (free) seat even if inactive', () => {
      const riskEngine = new RiskEngine(90);
      const seat: SaaSSeat = {
        platform: 'slack',
        user_id: 'slack_free_user',
        display_name: 'Free Member',
        role: 'Member',
        last_activity: '2026-01-01T00:00:00Z',
        paid_seat: false,
        monthly_cost: 0,
        exempt: false,
      };

      const assessment = riskEngine.evaluateSeat(seat, { reference_date: refDate });
      assert.equal(assessment.flagged, false);
      assert.equal(assessment.risk_level, 'NONE');
      assert.match(assessment.reason, /Unpaid\/free seat/i);
    });
  });

  // 4. Potential Savings Calculation Test
  describe('Potential Savings Calculation', () => {
    it('should calculate potential monthly and annual savings for flagged seats only', () => {
      const orchestrator = new GrimReaperOrchestrator();

      const seats: SaaSSeat[] = [
        {
          platform: 'github',
          user_id: 'gh_active',
          display_name: 'Active User',
          role: 'Member',
          last_activity: '2026-09-10T00:00:00Z', // 2 days
          paid_seat: true,
          monthly_cost: 21.0,
          exempt: false,
        },
        {
          platform: 'github',
          user_id: 'gh_inactive',
          display_name: 'Inactive User 1',
          role: 'Member',
          last_activity: '2026-05-01T00:00:00Z', // >90 days
          paid_seat: true,
          monthly_cost: 21.0,
          exempt: false,
        },
        {
          platform: 'slack',
          user_id: 'slack_inactive',
          display_name: 'Inactive User 2',
          role: 'Member',
          last_activity: '2026-05-01T00:00:00Z', // >90 days
          paid_seat: true,
          monthly_cost: 15.0,
          exempt: false,
        },
      ];

      orchestrator.ingestSeats(seats, { reference_date: refDate, inactivity_threshold_days: 90 });
      const savings = orchestrator.getPotentialSavings();

      assert.equal(savings.candidate_seat_count, 2);
      assert.equal(savings.monthly_potential_savings, 36.0); // 21 + 15
      assert.equal(savings.annual_potential_savings, 432.0); // 36 * 12
    });
  });

  // 5 & 6. Approval Guardrails Tests
  describe('Approval State Machine Guardrails', () => {
    it('should throw UnauthorizedExecutionError if candidate is in FLAGGED state', async () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat: SaaSSeat = {
        platform: 'github',
        user_id: 'gh_unapproved',
        display_name: 'Unapproved User',
        role: 'Member',
        last_activity: '2026-01-01T00:00:00Z',
        paid_seat: true,
        monthly_cost: 21.0,
        exempt: false,
      };

      orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });

      let executed = false;
      const dummyAction = async () => {
        executed = true;
      };

      await assert.rejects(
        async () => {
          await orchestrator.executeApprovedOffboarding('gh_unapproved', dummyAction);
        },
        (err: Error) => {
          assert.equal(err instanceof UnauthorizedExecutionError, true);
          assert.match(err.message, /SECURITY VIOLATION/);
          return true;
        }
      );

      assert.equal(executed, false);
    });

    it('should throw UnauthorizedExecutionError if candidate is REJECTED', async () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat: SaaSSeat = {
        platform: 'slack',
        user_id: 'slack_rejected',
        display_name: 'Rejected Candidate',
        role: 'Member',
        last_activity: '2026-01-01T00:00:00Z',
        paid_seat: true,
        monthly_cost: 15.0,
        exempt: false,
      };

      orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      orchestrator.requestApproval('slack_rejected');
      orchestrator.rejectCandidate('slack_rejected', 'User is key contractor');

      let executed = false;
      const dummyAction = async () => {
        executed = true;
      };

      await assert.rejects(
        async () => {
          await orchestrator.executeApprovedOffboarding('slack_rejected', dummyAction);
        },
        (err: Error) => {
          assert.equal(err instanceof UnauthorizedExecutionError, true);
          assert.match(err.message, /SECURITY VIOLATION/);
          return true;
        }
      );

      assert.equal(executed, false);
    });

    it('should ALLOW execution ONLY when candidate is APPROVED', async () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat: SaaSSeat = {
        platform: 'github',
        user_id: 'gh_approved',
        display_name: 'Approved User',
        role: 'Member',
        last_activity: '2026-01-01T00:00:00Z',
        paid_seat: true,
        monthly_cost: 21.0,
        exempt: false,
      };

      orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      orchestrator.requestApproval('gh_approved');
      orchestrator.approveCandidate('gh_approved');

      let actionRunCount = 0;
      const actionFn = async () => {
        actionRunCount++;
        return { status: 'success', seatId: 'gh_approved' };
      };

      const { result, candidate } = await orchestrator.executeApprovedOffboarding(
        'gh_approved',
        actionFn
      );

      assert.equal(actionRunCount, 1);
      assert.equal(candidate.approval_state, 'EXECUTED');
      assert.deepEqual(result, { status: 'success', seatId: 'gh_approved' });
    });
  });

  // 7. Webcmd CLI Wrapper Tests
  describe('Webcmd CLI Wrapper Functions', () => {
    it('should sanitize credentials and tokens from logs', () => {
      const logWithSecrets = 'Headers: Authorization: Bearer secret_token_12345, Cookie: session=abcdef';
      const sanitized = sanitizeLogs(logWithSecrets);

      assert.doesNotMatch(sanitized, /secret_token_12345/);
      assert.doesNotMatch(sanitized, /session=abcdef/);
      assert.match(sanitized, /\[REDACTED_SECRET\]/);
    });

    it('should detect authentication required outputs and exit codes', () => {
      assert.equal(isAuthRequiredOutput(77, '', ''), true);
      assert.equal(
        isAuthRequiredOutput(
          1,
          '',
          'error: SESSION_PAUSED_FOR_HUMAN_HANDOFF for session work-session'
        ),
        true
      );
      assert.equal(isAuthRequiredOutput(0, 'Success', ''), false);
    });

    it('should handle process timeouts gracefully', async () => {
      const wrapper = new WebcmdCliWrapper(process.execPath, 100);
      // Run node inline script that sleeps for 2 seconds (exceeds 100ms timeout)
      const res = await wrapper.exec(['-e', 'setTimeout(() => {}, 2000)'], { timeoutMs: 100 });

      assert.equal(res.success, false);
      assert.equal(res.exitCode, 75);
      assert.match(res.stderr, /timed out/i);
    });
  });
});
