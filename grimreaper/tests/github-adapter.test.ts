/**
 * GitHub Audit Adapter Unit Tests (including Audit Log Activity Evidence)
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitHubAdapter, GITHUB_VERIFIED_FIELDS, type ScrapedGitHubUser, type ScrapedAuditLogEvent } from '../src/adapters/github.ts';
import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';

describe('GitHub Read-Only Audit Adapter Unit Tests', () => {
  const adapter = new GitHubAdapter();

  // Test 1: GitHub Data Normalization with Valid Audit Timestamp
  describe('Data Normalization with Audit Log Timestamp', () => {
    it('should set seat.last_activity when a valid audit timestamp is provided', () => {
      const scrapedUser: ScrapedGitHubUser = {
        username: 'octocat',
        display_name: 'The Octocat',
        role: 'Owner',
        two_factor_enabled: true,
      };

      const auditEvent: ScrapedAuditLogEvent = {
        action: 'repo.create',
        timestamp: '2026-09-10T14:30:00.000Z',
      };

      const seat = adapter.normalizeSeat(scrapedUser, 'acme-corp', 21.0, auditEvent);

      assert.equal(seat.platform, 'github');
      assert.equal(seat.user_id, 'github_acme-corp_octocat');
      assert.equal(seat.display_name, 'The Octocat');
      assert.equal(seat.email, undefined);
      assert.equal(seat.role, 'Owner');
      assert.equal(seat.last_activity, '2026-09-10T14:30:00.000Z');
      assert.equal(seat.paid_seat, true);
      assert.equal(seat.monthly_cost, 21.0);
      assert.equal(seat.exempt, false);
      assert.equal(seat.metadata?.github_username, 'octocat');
      assert.equal(seat.metadata?.last_activity_source, 'github_audit_log');
      assert.equal(seat.metadata?.last_activity_event, 'repo.create');
      assert.equal(seat.metadata?.audit_log_access_denied, false);
    });

    // Test 2: No Audit Activity Handling
    it('should leave last_activity as undefined when no audit activity is found', () => {
      const scrapedUser: ScrapedGitHubUser = {
        username: 'inactive_dev',
        display_name: 'Inactive Dev',
        role: 'Member',
        two_factor_enabled: null,
      };

      const noActivity: ScrapedAuditLogEvent = {
        action: null,
        timestamp: null,
      };

      const seat = adapter.normalizeSeat(scrapedUser, 'test-org', 21.0, noActivity);

      assert.equal(seat.user_id, 'github_test-org_inactive_dev');
      assert.equal(seat.last_activity, undefined);
      assert.equal(seat.metadata?.last_activity_source, 'none');
      assert.equal(seat.metadata?.last_activity_event, null);
    });

    // Test 3: Malformed / Missing Timestamp Handling
    it('should handle malformed timestamp string gracefully without throwing', () => {
      const scrapedUser: ScrapedGitHubUser = {
        username: 'user_malformed',
        display_name: 'User Malformed',
        role: 'Member',
        two_factor_enabled: null,
      };

      const malformed: ScrapedAuditLogEvent = {
        action: 'some.action',
        timestamp: 'invalid-date-string-xyz',
      };

      const seat = adapter.normalizeSeat(scrapedUser, 'test-org', 21.0, malformed);

      assert.equal(seat.last_activity, undefined);
      assert.equal(seat.metadata?.last_activity_source, 'none');
    });

    // Test 4: Authorization Failure / Non-Owner Handling
    it('should handle audit log access denied (non-owner) gracefully', () => {
      const scrapedUser: ScrapedGitHubUser = {
        username: 'non_owner',
        display_name: 'Non Owner',
        role: 'Member',
        two_factor_enabled: null,
      };

      const accessDenied: ScrapedAuditLogEvent = {
        action: null,
        timestamp: null,
        access_denied: true,
      };

      const seat = adapter.normalizeSeat(scrapedUser, 'test-org', 21.0, accessDenied);

      assert.equal(seat.last_activity, undefined);
      assert.equal(seat.metadata?.audit_log_access_denied, true);
      assert.equal(seat.metadata?.last_activity_source, 'none');
    });
  });

  // Test 5: Risk Engine Integration for GitHub Audit Log Seats
  describe('Risk Engine Integration for Audit Log Activity', () => {
    it('should flag seat when audit log timestamp exceeds inactivity threshold', () => {
      const orchestrator = new GrimReaperOrchestrator();
      const refDate = new Date('2026-09-12T12:00:00Z');

      // 100 days inactive audit timestamp
      const seat = adapter.normalizeSeat(
        { username: 'old_user', display_name: 'Old User', role: 'Member', two_factor_enabled: true },
        'acme',
        21.0,
        { action: 'repo.create', timestamp: '2026-06-01T00:00:00.000Z' }
      );

      const candidates = orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      assert.equal(candidates.length, 1);

      const candidate = candidates[0];
      assert.equal(candidate.risk.flagged, true);
      assert.equal(candidate.risk.risk_level, 'MEDIUM');
      assert.equal(candidate.approval_state, 'FLAGGED');
      assert.equal(candidate.seat.last_activity, '2026-06-01T00:00:00.000Z');

      const savings = orchestrator.getPotentialSavings();
      assert.equal(savings.candidate_seat_count, 1);
      assert.equal(savings.monthly_potential_savings, 21.0);
    });

    it('should NOT flag seat when audit log shows recent activity within threshold', () => {
      const orchestrator = new GrimReaperOrchestrator();
      const refDate = new Date('2026-09-12T12:00:00Z');

      // 2 days inactive audit timestamp
      const seat = adapter.normalizeSeat(
        { username: 'active_user', display_name: 'Active User', role: 'Member', two_factor_enabled: true },
        'acme',
        21.0,
        { action: 'pull_request.create', timestamp: '2026-09-10T12:00:00.000Z' }
      );

      const candidates = orchestrator.ingestSeats([seat], { reference_date: refDate, inactivity_threshold_days: 90 });
      const candidate = candidates[0];

      assert.equal(candidate.risk.flagged, false);
      assert.equal(candidate.risk.risk_level, 'NONE');
      assert.equal(candidate.approval_state, 'DISCOVERED');
    });

    it('should NOT flag seat when audit log returns NO_DATA (null timestamp)', () => {
      const orchestrator = new GrimReaperOrchestrator();
      const seat = adapter.normalizeSeat(
        { username: 'nodata_user', display_name: 'No Data User', role: 'Member', two_factor_enabled: true },
        'acme',
        21.0,
        null
      );

      const candidates = orchestrator.ingestSeats([seat]);
      const candidate = candidates[0];

      assert.equal(candidate.risk.flagged, false);
      assert.equal(candidate.risk.risk_level, 'NONE');
      assert.equal(candidate.risk.inactive_days, null);
      assert.match(candidate.risk.reason, /No valid activity timestamp available/i);
    });
  });

  // Test 6: End-to-End Mocked Audit with Multiple Members and Audit Log
  describe('Multiple Members Audit Log Extraction', () => {
    it('should audit multiple members and query audit log for each member', async () => {
      const mockWebcmd = new WebcmdCliWrapper();
      let callCount = 0;

      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        callCount++;
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_111', profileId: 'github-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_111', profileId: 'github-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 20,
          };
        }

        // Script execution 1: Scrape people page
        if (callCount === 2) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({
              authRequired: false,
              members: [
                { username: 'user_active', display_name: 'User Active', role: 'Owner', two_factor_enabled: true },
                { username: 'user_inactive', display_name: 'User Inactive', role: 'Member', two_factor_enabled: false },
              ],
              hasNext: false,
            }),
            stderr: '',
            data: {
              authRequired: false,
              members: [
                { username: 'user_active', display_name: 'User Active', role: 'Owner', two_factor_enabled: true },
                { username: 'user_inactive', display_name: 'User Inactive', role: 'Member', two_factor_enabled: false },
              ],
              hasNext: false,
            },
            authRequired: false,
            durationMs: 100,
          };
        }

        // Script execution 2: Audit log for user_active
        if (callCount === 3) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-09-11T10:00:00.000Z' }),
            stderr: '',
            data: { auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-09-11T10:00:00.000Z' },
            authRequired: false,
            durationMs: 120,
          };
        }

        // Script execution 3: Audit log for user_inactive
        if (callCount === 4) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ auth_required: false, access_denied: false, action: 'org.invite', timestamp: '2026-01-15T12:00:00.000Z' }),
            stderr: '',
            data: { auth_required: false, access_denied: false, action: 'org.invite', timestamp: '2026-01-15T12:00:00.000Z' },
            authRequired: false,
            durationMs: 110,
          };
        }

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

      const mockAdapter = new GitHubAdapter(mockWebcmd);
      const result = await mockAdapter.auditOrganization({ orgName: 'multi-member-org' });

      assert.equal(result.seats.length, 2);
      assert.equal(result.seats[0].last_activity, '2026-09-11T10:00:00.000Z');
      assert.equal(result.seats[1].last_activity, '2026-01-15T12:00:00.000Z');
      assert.equal(result.evidence.audit_log_queries_count, 2);
      assert.equal(result.evidence.audit_log_events_found, 2);
      assert.equal(result.evidence.read_only_confirmed, true);
    });
  });

  // Test 7: Read-Only Audit Mode Confirmation
  describe('Read-Only Audit Mode Confirmation', () => {
    it('should confirm that audit commands issue only read-only browser run operations', async () => {
      const issuedArgs: string[][] = [];
      const mockWebcmd = new WebcmdCliWrapper();

      mockWebcmd.exec = async (args: string[]): Promise<WebcmdExecutionResult> => {
        issuedArgs.push(args);
        if (args.includes('create') || args.includes('close')) {
          return {
            success: true,
            exitCode: 0,
            stdout: JSON.stringify({ id: 'sess_789', profileId: 'github-admin', kind: 'explicit' }),
            stderr: '',
            data: { id: 'sess_789', profileId: 'github-admin', kind: 'explicit' },
            authRequired: false,
            durationMs: 20,
          };
        }
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            members: [{ username: 'read_only_user', display_name: 'Read Only', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            members: [{ username: 'read_only_user', display_name: 'Read Only', role: 'Member', two_factor_enabled: true }],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 100,
        };
      };

      const mockAdapter = new GitHubAdapter(mockWebcmd);
      const result = await mockAdapter.auditOrganization({ orgName: 'audit-only-org', fetchAuditLogActivity: false });

      assert.equal(result.evidence.read_only_confirmed, true);
      assert.equal(result.seats.length, 1);

      const allArgsText = issuedArgs.map((a) => a.join(' ')).join('\n');
      assert.doesNotMatch(allArgsText, /delete|remove|invite|kick|revoke/i);
    });
  });
});
