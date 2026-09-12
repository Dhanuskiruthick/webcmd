/**
 * Slack Read-Only Audit Adapter Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SlackAdapter,
  parseSlackLastActiveTimestamp,
  SLACK_VERIFIED_FIELDS,
  type ScrapedSlackUser,
} from '../src/adapters/slack.ts';
import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';

describe('Slack Read-Only Audit Adapter Unit Tests', () => {
  const adapter = new SlackAdapter();
  const refDate = new Date('2026-09-12T12:00:00Z');

  // Test Group 1: Timestamp Parsing Utility
  describe('parseSlackLastActiveTimestamp', () => {
    it('should parse relative days into ISO string', () => {
      const parsed = parseSlackLastActiveTimestamp('5 days ago', refDate);
      assert.ok(parsed);
      const expected = new Date(refDate.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
      assert.equal(parsed, expected);
    });

    it('should parse relative hours into ISO string', () => {
      const parsed = parseSlackLastActiveTimestamp('3 hours ago', refDate);
      assert.ok(parsed);
      const expected = new Date(refDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
      assert.equal(parsed, expected);
    });

    it('should parse relative months into ISO string', () => {
      const parsed = parseSlackLastActiveTimestamp('2 months ago', refDate);
      assert.ok(parsed);
      const expected = new Date(refDate.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      assert.equal(parsed, expected);
    });

    it('should parse direct ISO dates', () => {
      const parsed = parseSlackLastActiveTimestamp('2026-08-01T00:00:00.000Z', refDate);
      assert.equal(parsed, '2026-08-01T00:00:00.000Z');
    });

    it('should return undefined for "Never", "Deactivated", null, or empty strings', () => {
      assert.equal(parseSlackLastActiveTimestamp('Never', refDate), undefined);
      assert.equal(parseSlackLastActiveTimestamp('never active', refDate), undefined);
      assert.equal(parseSlackLastActiveTimestamp('Deactivated member', refDate), undefined);
      assert.equal(parseSlackLastActiveTimestamp(null, refDate), undefined);
      assert.equal(parseSlackLastActiveTimestamp('', refDate), undefined);
      assert.equal(parseSlackLastActiveTimestamp('   ', refDate), undefined);
    });
  });

  // Test Group 2: Slack Member Normalization
  describe('Slack Member Normalization', () => {
    it('should normalize a full member paid seat with verified fields', () => {
      const scraped: ScrapedSlackUser = {
        user_id: 'U123456',
        display_name: 'Alice Smith',
        email: 'alice@acme.com',
        role: 'Full Member',
        last_active_raw: '2 days ago',
      };

      const seat = adapter.normalizeSeat(scraped, 'acme-corp', 8.75, refDate);

      assert.equal(seat.platform, 'slack');
      assert.equal(seat.user_id, 'slack_acme-corp_u123456');
      assert.equal(seat.display_name, 'Alice Smith');
      assert.equal(seat.email, 'alice@acme.com');
      assert.equal(seat.role, 'Full Member');
      assert.equal(seat.paid_seat, true);
      assert.equal(seat.monthly_cost, 8.75);
      assert.equal(seat.exempt, false);
      assert.ok(seat.last_activity);
      assert.equal(seat.metadata?.slack_user_id, 'U123456');
      assert.equal(seat.metadata?.workspace, 'acme-corp');
      assert.equal(seat.metadata?.is_guest, false);
      assert.equal(seat.metadata?.is_deactivated, false);
      assert.equal(seat.metadata?.last_activity_source, 'slack_admin_members');
    });

    it('should set paid_seat to false and monthly_cost to 0 for Guests and Deactivated users', () => {
      const guestScraped: ScrapedSlackUser = {
        user_id: 'U_GUEST_1',
        display_name: 'Guest Contractor',
        email: 'contractor@external.com',
        role: 'Multi-Channel Guest',
        last_active_raw: '1 day ago',
        is_guest: true,
      };

      const deactivatedScraped: ScrapedSlackUser = {
        user_id: 'U_DEACT_1',
        display_name: 'Former Employee',
        email: 'former@acme.com',
        role: 'Deactivated Member',
        last_active_raw: 'Never',
      };

      const guestSeat = adapter.normalizeSeat(guestScraped, 'acme-corp', 8.75, refDate);
      const deactivatedSeat = adapter.normalizeSeat(deactivatedScraped, 'acme-corp', 8.75, refDate);

      assert.equal(guestSeat.paid_seat, false);
      assert.equal(guestSeat.monthly_cost, 0);
      assert.equal(guestSeat.metadata?.is_guest, true);

      assert.equal(deactivatedSeat.paid_seat, false);
      assert.equal(deactivatedSeat.monthly_cost, 0);
      assert.equal(deactivatedSeat.metadata?.is_deactivated, true);
    });

    it('should support custom monthly seat price overrides', () => {
      const scraped: ScrapedSlackUser = {
        user_id: 'U999',
        display_name: 'Bob Admin',
        email: 'bob@enterprise.com',
        role: 'Workspace Admin',
        last_active_raw: '1 hour ago',
      };

      // Business+ plan: $15.00/seat/month
      const seat = adapter.normalizeSeat(scraped, 'enterprise-org', 15.0, refDate);
      assert.equal(seat.monthly_cost, 15.0);
    });
  });

  // Test Group 3: Risk Engine Integration & NO_DATA Handling
  describe('Risk Engine & NO_DATA Rule Integration', () => {
    it('should return NO_DATA (flagged = false) when last activity is unavailable', () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat = adapter.normalizeSeat(
        {
          user_id: 'U_NO_ACT',
          display_name: 'Unknown Active User',
          email: 'unknown@acme.com',
          role: 'Full Member',
          last_active_raw: null,
        },
        'acme-corp',
        8.75,
        refDate
      );

      const candidates = orchestrator.ingestSeats([seat]);
      const candidate = candidates[0];

      assert.equal(candidate.seat.last_activity, undefined);
      assert.equal(candidate.risk.flagged, false);
      assert.equal(candidate.risk.risk_level, 'NONE');
      assert.equal(candidate.risk.inactive_days, null);
      assert.match(candidate.risk.reason, /No valid activity timestamp available/i);
    });

    it('should flag seat as MEDIUM risk when activity exceeds inactivity threshold', () => {
      const orchestrator = new GrimReaperOrchestrator();
      // 100 days ago activity string
      const seat = adapter.normalizeSeat(
        {
          user_id: 'U_INACTIVE_100',
          display_name: 'Inactive User',
          email: 'inactive@acme.com',
          role: 'Full Member',
          last_active_raw: '100 days ago',
        },
        'acme-corp',
        8.75,
        refDate
      );

      const candidates = orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      const candidate = candidates[0];

      assert.equal(candidate.risk.flagged, true);
      assert.equal(candidate.risk.risk_level, 'MEDIUM');
      assert.ok(candidate.risk.inactive_days && candidate.risk.inactive_days >= 99);
      assert.equal(candidate.approval_state, 'FLAGGED');

      const savings = orchestrator.getPotentialSavings();
      assert.equal(savings.candidate_seat_count, 1);
      assert.equal(savings.monthly_potential_savings, 8.75);
    });

    it('should NOT flag seat when activity is recent within inactivity threshold', () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat = adapter.normalizeSeat(
        {
          user_id: 'U_ACTIVE_RECENT',
          display_name: 'Active User',
          email: 'active@acme.com',
          role: 'Full Member',
          last_active_raw: '2 days ago',
        },
        'acme-corp',
        8.75,
        refDate
      );

      const candidates = orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      const candidate = candidates[0];

      assert.equal(candidate.risk.flagged, false);
      assert.equal(candidate.risk.risk_level, 'NONE');
      assert.equal(candidate.approval_state, 'DISCOVERED');
    });
  });

  // Test Group 4: Auth Required & Access Denied Safety Handling
  describe('Authentication & Access Control', () => {
    it('should handle authRequired safely when webcmd detects missing credentials', async () => {
      const mockWebcmd = new WebcmdCliWrapper();
      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        if (args.includes('create')) {
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: 'Authentication required. Profile slack-admin requires login.',
            authRequired: true,
            durationMs: 15,
            errorDiagnostic: 'Authentication required. Profile slack-admin requires login.',
          };
        }
        return { success: true, exitCode: 0, stdout: '{}', stderr: '', authRequired: false, durationMs: 10 };
      };

      const mockAdapter = new SlackAdapter(mockWebcmd);
      const result = await mockAdapter.auditWorkspace({ workspaceSlug: 'acme-corp' });

      assert.equal(result.authRequired, true);
      assert.equal(result.total_members, 0);
      assert.equal(result.seats.length, 0);
      assert.equal(result.evidence.auth_verified, false);
      assert.equal(result.evidence.read_only_confirmed, true);
    });

    it('should handle admin directory access denied safely', async () => {
      const mockWebcmd = new WebcmdCliWrapper();
      let callCount = 0;

      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        callCount++;
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_slack_1', profileId: 'slack-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_slack_1', profileId: 'slack-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 10,
          };
        }

        // Script evaluation returns access_denied
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ authRequired: false, access_denied: true, members: [], hasNext: false }),
          stderr: '',
          data: { authRequired: false, access_denied: true, members: [], hasNext: false },
          authRequired: false,
          durationMs: 50,
        };
      };

      const mockAdapter = new SlackAdapter(mockWebcmd);
      const result = await mockAdapter.auditWorkspace({ workspaceSlug: 'acme-corp' });

      assert.equal(result.authRequired, false);
      assert.equal(result.evidence.access_denied, true);
      assert.equal(result.evidence.auth_verified, true);
      assert.equal(result.evidence.read_only_confirmed, true);
      assert.match(result.errorDiagnostic || '', /Access denied/i);
    });
  });

  // Test Group 5: Multiple Members & Pagination Handling
  describe('Multiple Members & Pagination Handling', () => {
    it('should scrape across multiple pages and aggregate members correctly', async () => {
      const mockWebcmd = new WebcmdCliWrapper();
      let scriptCallCount = 0;

      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_pages', profileId: 'slack-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_pages', profileId: 'slack-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 10,
          };
        }

        scriptCallCount++;
        // Page 1 return 2 members, hasNext = true
        if (scriptCallCount === 1) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({
              authRequired: false,
              access_denied: false,
              members: [
                { user_id: 'U001', display_name: 'Member 1', email: 'm1@acme.com', role: 'Full Member', last_active_raw: '10 days ago' },
                { user_id: 'U002', display_name: 'Member 2', email: 'm2@acme.com', role: 'Full Member', last_active_raw: '100 days ago' },
              ],
              hasNext: true,
            }),
            stderr: '',
            data: {
              authRequired: false,
              access_denied: false,
              members: [
                { user_id: 'U001', display_name: 'Member 1', email: 'm1@acme.com', role: 'Full Member', last_active_raw: '10 days ago' },
                { user_id: 'U002', display_name: 'Member 2', email: 'm2@acme.com', role: 'Full Member', last_active_raw: '100 days ago' },
              ],
              hasNext: true,
            },
            authRequired: false,
            durationMs: 80,
          };
        }

        // Page 2 return 1 member, hasNext = false
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            access_denied: false,
            members: [
              { user_id: 'U003', display_name: 'Member 3', email: 'm3@acme.com', role: 'Workspace Admin', last_active_raw: '1 day ago' },
            ],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            access_denied: false,
            members: [
              { user_id: 'U003', display_name: 'Member 3', email: 'm3@acme.com', role: 'Workspace Admin', last_active_raw: '1 day ago' },
            ],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 70,
        };
      };

      const mockAdapter = new SlackAdapter(mockWebcmd);
      const result = await mockAdapter.auditWorkspace({ workspaceSlug: 'acme-corp', maxPages: 5 });

      assert.equal(result.total_members, 3);
      assert.equal(result.seats.length, 3);
      assert.equal(result.evidence.pages_scraped, 2);
      assert.equal(result.evidence.read_only_confirmed, true);
      assert.equal(result.seats[0].user_id, 'slack_acme-corp_u001');
      assert.equal(result.seats[1].user_id, 'slack_acme-corp_u002');
      assert.equal(result.seats[2].user_id, 'slack_acme-corp_u003');
    });
  });

  // Test Group 6: Strict Read-Only Execution
  describe('Strict Read-Only Execution', () => {
    it('should confirm read-only operations and issue no modifying/destructive webcmd calls', async () => {
      const issuedCommands: string[][] = [];
      const mockWebcmd = new WebcmdCliWrapper();

      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        issuedCommands.push(args);
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_readonly', profileId: 'slack-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_readonly', profileId: 'slack-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 10,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            access_denied: false,
            members: [{ user_id: 'U_RO', display_name: 'Read Only User', role: 'Full Member', last_active_raw: '5 days ago' }],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            access_denied: false,
            members: [{ user_id: 'U_RO', display_name: 'Read Only User', role: 'Full Member', last_active_raw: '5 days ago' }],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 50,
        };
      };

      const mockAdapter = new SlackAdapter(mockWebcmd);
      const result = await mockAdapter.auditWorkspace({ workspaceSlug: 'acme-corp' });

      assert.equal(result.evidence.read_only_confirmed, true);

      const allCmdText = issuedCommands.map((c) => c.join(' ')).join('\n');
      assert.doesNotMatch(allCmdText, /deactivate|delete|remove|kick|invite|role|edit/i);
    });
  });

  // Test Group 7: Orchestrator Slack Integration
  describe('GrimReaperOrchestrator Slack Integration', () => {
    it('should orchestrate Slack audit and compute risk/savings pipeline end-to-end', async () => {
      const mockWebcmd = new WebcmdCliWrapper();
      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_orch_slack', profileId: 'slack-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_orch_slack', profileId: 'slack-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 10,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            access_denied: false,
            members: [
              { user_id: 'U_ACTIVE_1', display_name: 'Active 1', email: 'act1@acme.com', role: 'Full Member', last_active_raw: '2 days ago' },
              { user_id: 'U_INACTIVE_1', display_name: 'Inactive 1', email: 'inact1@acme.com', role: 'Full Member', last_active_raw: '120 days ago' },
            ],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            access_denied: false,
            members: [
              { user_id: 'U_ACTIVE_1', display_name: 'Active 1', email: 'act1@acme.com', role: 'Full Member', last_active_raw: '2 days ago' },
              { user_id: 'U_INACTIVE_1', display_name: 'Inactive 1', email: 'inact1@acme.com', role: 'Full Member', last_active_raw: '120 days ago' },
            ],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 60,
        };
      };

      const orchestrator = new GrimReaperOrchestrator({
        webcmdWrapper: mockWebcmd,
        riskEngineOptions: { inactivity_threshold_days: 90 },
      });

      const res = await orchestrator.auditSlack({ workspaceSlug: 'acme-corp', monthlyCostPerSeat: 8.75 });

      assert.equal(res.summary.total_seats, 2);
      assert.equal(res.summary.flagged_seats, 1);
      assert.equal(res.summary.auth_required, false);
      assert.equal(res.summary.access_denied, false);
      assert.equal(res.candidates.length, 2);
      assert.equal(res.potential_savings.candidate_seat_count, 1);
      assert.equal(res.potential_savings.monthly_potential_savings, 8.75);
      assert.equal(res.potential_savings.annual_potential_savings, 105.0);

      // Verify audit log entry was created
      const auditLog = orchestrator.getAuditLogger().getRecords();
      assert.ok(auditLog.length >= 3); // 2 seat ingests + 1 audit completed
      assert.equal(auditLog[auditLog.length - 1].action, 'SLACK_AUDIT_COMPLETED');
    });
  });
});
