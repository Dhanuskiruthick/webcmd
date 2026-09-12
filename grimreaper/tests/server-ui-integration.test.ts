/**
 * SaaS GrimReaper Server & UI Integration Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createGrimReaperServer } from '../src/server.ts';
import { GrimReaperOrchestrator } from '../src/orchestrator.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../src/webcmd-cli.ts';

describe('SaaS GrimReaper Server & UI Integration Tests', () => {
  let server: ReturnType<typeof createGrimReaperServer>['server'];
  let orchestrator: GrimReaperOrchestrator;
  let baseUrl: string;

  before(async () => {
    const mockWebcmd = new WebcmdCliWrapper();
    mockWebcmd.exec = async (args: string[], input?: string): Promise<WebcmdExecutionResult> => {
      if (args.includes('create') || args.includes('close')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ id: 'sess_test', profileId: 'admin', kind: 'explicit' }),
          stderr: '',
          data: { id: 'sess_test', profileId: 'admin', kind: 'explicit' },
          authRequired: false,
          durationMs: 10,
        };
      }

      const combined = (args.join(' ') + ' ' + (input || '')).toLowerCase();

      // Mock GitHub audit log return
      if (combined.includes('audit-log')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-01-01T00:00:00.000Z' }),
          stderr: '',
          data: { auth_required: false, access_denied: false, action: 'repo.create', timestamp: '2026-01-01T00:00:00.000Z' },
          authRequired: false,
          durationMs: 40,
        };
      }

      // Mock GitHub people scrape
      if (combined.includes('github') || combined.includes('people')) {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            authRequired: false,
            members: [
              { username: 'user_active_gh', display_name: 'GH Active', role: 'Owner', two_factor_enabled: true },
              { username: 'user_inactive_gh', display_name: 'GH Inactive', role: 'Member', two_factor_enabled: true },
            ],
            hasNext: false,
          }),
          stderr: '',
          data: {
            authRequired: false,
            members: [
              { username: 'user_active_gh', display_name: 'GH Active', role: 'Owner', two_factor_enabled: true },
              { username: 'user_inactive_gh', display_name: 'GH Inactive', role: 'Member', two_factor_enabled: true },
            ],
            hasNext: false,
          },
          authRequired: false,
          durationMs: 50,
        };
      }

      // Mock Slack audit return
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          authRequired: false,
          access_denied: false,
          members: [
            { user_id: 'U_SLACK_1', display_name: 'Slack Inactive', email: 'slack1@acme.com', role: 'Full Member', last_active_raw: '120 days ago' },
          ],
          hasNext: false,
        }),
        stderr: '',
        data: {
          authRequired: false,
          access_denied: false,
          members: [
            { user_id: 'U_SLACK_1', display_name: 'Slack Inactive', email: 'slack1@acme.com', role: 'Full Member', last_active_raw: '120 days ago' },
          ],
          hasNext: false,
        },
        authRequired: false,
        durationMs: 50,
      };
    };

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

  it('should serve HTML UI index.html on GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /SaaS GrimReaper/i);
    assert.match(text, /<!DOCTYPE html>/i);
  });

  it('should return empty initial dashboard payload on GET /api/dashboard', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.summary.total_seats, 0);
    assert.equal(data.summary.inactive_candidates, 0);
    assert.equal(data.candidates.length, 0);
  });

  it('should trigger GitHub audit via POST /api/audit/github and ingest candidates', async () => {
    const res = await fetch(`${baseUrl}/api/audit/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName: 'test-org' }),
    });

    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.audit_result.platform, 'github');
    assert.equal(result.audit_result.seats.length, 2);

    // Verify candidate data appears on dashboard
    const dashRes = await fetch(`${baseUrl}/api/dashboard`);
    const dashData = await dashRes.json();
    assert.ok(dashData.summary.total_seats >= 2);
  });

  it('should trigger Slack audit via POST /api/audit/slack and ingest candidates', async () => {
    const res = await fetch(`${baseUrl}/api/audit/slack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceSlug: 'test-workspace' }),
    });

    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.audit_result.platform, 'slack');
    assert.equal(result.audit_result.seats.length, 1);
  });

  it('should transition candidate state using approval state machine on POST /api/candidates/approve', async () => {
    // Ingest a flagged seat
    const seat = {
      platform: 'slack' as const,
      user_id: 'slack_test_flagged_user',
      display_name: 'Flagged User',
      role: 'Full Member',
      last_activity: '2025-01-01T00:00:00Z', // Inactive
      paid_seat: true,
      monthly_cost: 8.75,
      exempt: false,
    };

    orchestrator.ingestSeats([seat], { reference_date: new Date('2026-09-12T00:00:00Z'), inactivity_threshold_days: 90 });

    const initialCand = orchestrator.getCandidate('slack_test_flagged_user');
    assert.equal(initialCand?.approval_state, 'FLAGGED');

    // Call API to approve
    const res = await fetch(`${baseUrl}/api/candidates/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'slack_test_flagged_user' }),
    });

    assert.equal(res.status, 200);
    const updatedCand = await res.json();

    // Must be updated to APPROVED via Approval State Machine
    assert.equal(updatedCand.approval_state, 'APPROVED');
    assert.ok(updatedCand.approved_at);

    // Verify orchestrator candidate state
    const currentCand = orchestrator.getCandidate('slack_test_flagged_user');
    assert.equal(currentCand?.approval_state, 'APPROVED');
  });

  it('should reject candidate via POST /api/candidates/reject', async () => {
    const seat = {
      platform: 'github' as const,
      user_id: 'github_test_reject_user',
      display_name: 'Reject User',
      role: 'Member',
      last_activity: '2025-01-01T00:00:00Z',
      paid_seat: true,
      monthly_cost: 21.0,
      exempt: false,
    };

    orchestrator.ingestSeats([seat], { reference_date: new Date('2026-09-12T00:00:00Z') });

    const res = await fetch(`${baseUrl}/api/candidates/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'github_test_reject_user', reason: 'User needed on project' }),
    });

    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.approval_state, 'REJECTED');
    assert.ok(updated.rejected_at);
  });
});
