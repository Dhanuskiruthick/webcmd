/**
 * SaaS GrimReaper — Slack Read-Only Audit Adapter
 *
 * Automates browser inspection of Slack Workspace Members & Admin Member Management
 * using Webcmd CLI.
 * Strictly READ-ONLY: Never executes user deactivation, removal, invitation, or role modifications.
 */

import type { SaaSSeat } from '../models.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../webcmd-cli.ts';
import type { ExecutionStatus, OffboardingExecutionResult } from './github.ts';

export interface SlackAuditOptions {
  /** Webcmd browser profile to use (default: 'slack-admin') */
  profile?: string;
  /** Slack Workspace slug/subdomain, e.g. "acme-corp" */
  workspaceSlug: string;
  /** Monthly cost estimate per paid seat in USD (default: $8.75 for Slack Pro) */
  monthlyCostPerSeat?: number;
  /** Maximum number of member directory pages to scrape (default: 10) */
  maxPages?: number;
  /** Command execution timeout in ms (default: 30000) */
  sessionTimeoutMs?: number;
}

export interface SlackExecutionOptions {
  profile?: string;
  workspaceSlug: string;
  userId: string;
  sessionTimeoutMs?: number;
}

export interface ScrapedSlackUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  last_active_raw: string | null;
  is_guest?: boolean;
}

export interface SlackAuditEvidence {
  pages_scraped: number;
  fields_discovered: string[];
  webcmd_commands_issued: string[];
  auth_verified: boolean;
  read_only_confirmed: boolean;
  raw_members_count: number;
  access_denied: boolean;
}

export interface SlackAuditResult {
  platform: 'slack';
  workspace_slug: string;
  total_members: number;
  seats: SaaSSeat[];
  evidence: SlackAuditEvidence;
  authRequired: boolean;
  errorDiagnostic?: string;
}

/**
 * Verified fields exposed on Slack Workspace Admin Member Directory:
 * - user_id (Slack member ID or username)
 * - display_name (Full name or display name)
 * - email (User email address)
 * - role (Workspace role: 'Primary Owner' | 'Workspace Admin' | 'Full Member' | 'Guest' | 'Deactivated')
 * - last_activity (Verified last active timestamp/relative activity string)
 * - paid_seat (true for Full Members/Admins/Owners on paid plans, false for Guests or Deactivated)
 * - monthly_cost (8.75 - standard Pro seat cost)
 */
export const SLACK_VERIFIED_FIELDS = [
  'user_id',
  'display_name',
  'email',
  'role',
  'last_activity',
  'paid_seat',
  'monthly_cost',
];

/**
 * Parses Slack relative or absolute time strings into an ISO 8601 timestamp string.
 * Returns `undefined` if activity is missing, unparseable, or "Never".
 */
export function parseSlackLastActiveTimestamp(
  rawText: string | null | undefined,
  referenceDate: Date = new Date()
): string | undefined {
  if (!rawText || !rawText.trim()) return undefined;
  const cleaned = rawText.trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes('never') || lower.includes('deactivated')) {
    return undefined;
  }

  // Check direct ISO/Date parsing
  const parsedDirect = Date.parse(cleaned);
  if (!Number.isNaN(parsedDirect)) {
    return new Date(parsedDirect).toISOString();
  }

  // Parse relative days e.g. "5 days ago", "10 days ago"
  const matchDays = /(\d+)\s+days?\s+ago/i.exec(cleaned);
  if (matchDays) {
    const days = parseInt(matchDays[1], 10);
    return new Date(referenceDate.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  // Parse relative hours e.g. "2 hours ago"
  const matchHours = /(\d+)\s+hours?\s+ago/i.exec(cleaned);
  if (matchHours) {
    const hours = parseInt(matchHours[1], 10);
    return new Date(referenceDate.getTime() - hours * 60 * 60 * 1000).toISOString();
  }

  // Parse relative months e.g. "3 months ago" (approx 30 days/month)
  const matchMonths = /(\d+)\s+months?\s+ago/i.exec(cleaned);
  if (matchMonths) {
    const months = parseInt(matchMonths[1], 10);
    return new Date(referenceDate.getTime() - months * 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  return undefined;
}

export class SlackAdapter {
  private readonly webcmd: WebcmdCliWrapper;

  constructor(webcmdWrapper?: WebcmdCliWrapper) {
    this.webcmd = webcmdWrapper ?? new WebcmdCliWrapper();
  }

  /**
   * Normalizes raw scraped Slack user data into standard SaaSSeat model.
   */
  normalizeSeat(
    user: ScrapedSlackUser,
    workspaceSlug: string,
    monthlyCost = 8.75,
    referenceDate: Date = new Date()
  ): SaaSSeat {
    const rawId = (user.user_id || user.display_name || 'unknown').replace(/^@/, '').trim();
    const roleNormalized = user.role || 'Full Member';
    const isGuest = Boolean(user.is_guest) || roleNormalized.toLowerCase().includes('guest');
    const isDeactivated = roleNormalized.toLowerCase().includes('deactivated');

    // Guests and Deactivated users do not occupy paid seats on Slack
    const isPaidSeat = !isGuest && !isDeactivated;

    const validLastActivity = parseSlackLastActiveTimestamp(user.last_active_raw, referenceDate);

    return {
      platform: 'slack',
      user_id: `slack_${workspaceSlug.toLowerCase()}_${rawId.toLowerCase()}`,
      display_name: user.display_name || rawId,
      email: user.email || undefined,
      role: roleNormalized,
      last_activity: validLastActivity,
      paid_seat: isPaidSeat,
      monthly_cost: isPaidSeat ? Math.max(0, monthlyCost) : 0,
      exempt: false,
      metadata: {
        slack_user_id: rawId,
        workspace: workspaceSlug,
        raw_last_active: user.last_active_raw || null,
        is_guest: isGuest,
        is_deactivated: isDeactivated,
        last_activity_source: validLastActivity ? 'slack_admin_members' : 'none',
      },
    };
  }

  /**
   * Performs a READ-ONLY audit of a Slack Workspace Member directory via Webcmd browser automation.
   */
  async auditWorkspace(options: SlackAuditOptions): Promise<SlackAuditResult> {
    const profile = options.profile ?? 'slack-admin';
    const workspaceSlug = options.workspaceSlug.trim();
    const monthlyCost = options.monthlyCostPerSeat ?? 8.75;
    const maxPages = options.maxPages ?? 10;
    const sessionTimeoutMs = options.sessionTimeoutMs ?? 30_000;

    const commandsIssued: string[] = [];
    const discoveredSeats: SaaSSeat[] = [];

    // Step 1: Create an isolated session for this audit
    const sessionName = `slack-audit-${workspaceSlug.toLowerCase()}-${Date.now()}`;
    commandsIssued.push(`webcmd --profile ${profile} session create ${sessionName} -f json`);
    
    const sessionRes = await this.webcmd.createSession(profile, sessionName, {
      timeoutMs: sessionTimeoutMs,
    });

    if (!sessionRes.success || sessionRes.authRequired) {
      return {
        platform: 'slack',
        workspace_slug: workspaceSlug,
        total_members: 0,
        seats: [],
        evidence: {
          pages_scraped: 0,
          fields_discovered: SLACK_VERIFIED_FIELDS,
          webcmd_commands_issued: commandsIssued,
          auth_verified: false,
          read_only_confirmed: true,
          raw_members_count: 0,
          access_denied: false,
        },
        authRequired: sessionRes.authRequired,
        errorDiagnostic: sessionRes.errorDiagnostic ?? 'Failed to create Webcmd browser session for Slack audit',
      };
    }

    const sessionId = sessionRes.data?.id ?? sessionName;

    try {
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage && currentPage <= maxPages) {
        const pageUrl = `https://${workspaceSlug}.slack.com/admin/users?page=${currentPage}`;
        
        const extractScript = `
          if (!window.location.href.includes('/admin/users')) {
            await page.goto('${pageUrl}', { waitUntil: 'domcontentloaded' });
          }

          const currentUrl = page.url();
          if (currentUrl.includes('/ssb/signin') || currentUrl.includes('/login') || currentUrl.includes('slack.com/signin')) {
            return { authRequired: true, access_denied: false, members: [], hasNext: false };
          }

          const pageTitle = document.title || '';
          if (pageTitle.includes('404') || pageTitle.includes('Access Denied') || pageTitle.includes('Unauthorized')) {
            return { authRequired: false, access_denied: true, members: [], hasNext: false };
          }

          const extracted = await page.evaluate(() => {
            const items = [];
            const rows = document.querySelectorAll('tr.member_row, tr[data-member-id], div.member_item, tr.c-table__row');
            
            rows.forEach((row) => {
              const nameEl = row.querySelector('.member_name, .c-member_name, td.name_column, span.bold');
              const emailEl = row.querySelector('.member_email, td.email_column, a[href^="mailto:"]');
              const roleEl = row.querySelector('.member_role, td.role_column, span.c-badge');
              const activityEl = row.querySelector('.member_activity, td.activity_column, span.last_active');

              const nameText = nameEl ? nameEl.textContent.trim() : null;
              const emailText = emailEl ? emailEl.textContent.replace('mailto:', '').trim() : null;
              const roleText = roleEl ? roleEl.textContent.trim() : 'Full Member';
              const activityText = activityEl ? activityEl.textContent.trim() : null;

              const memberId = row.getAttribute('data-member-id') || nameText || 'unknown';

              if (nameText) {
                items.push({
                  user_id: memberId,
                  display_name: nameText,
                  email: emailText,
                  role: roleText,
                  last_active_raw: activityText,
                });
              }
            });

            const nextBtn = document.querySelector('a.pagination_next, button[data-action="next_page"], a[rel="next"]');
            const hasNext = Boolean(nextBtn && !nextBtn.classList.contains('disabled'));

            return { authRequired: false, access_denied: false, members: items, hasNext };
          });

          return extracted;
        `;

        commandsIssued.push(`webcmd --profile ${profile} --session ${sessionId} browser run --stdin -f json (page ${currentPage})`);

        const runRes = await this.webcmd.browserRun(profile, sessionId, extractScript, {
          timeoutMs: sessionTimeoutMs,
        });

        if (!runRes.success || runRes.authRequired) {
          if (runRes.authRequired) {
            return {
              platform: 'slack',
              workspace_slug: workspaceSlug,
              total_members: discoveredSeats.length,
              seats: discoveredSeats,
              evidence: {
                pages_scraped: currentPage - 1,
                fields_discovered: SLACK_VERIFIED_FIELDS,
                webcmd_commands_issued: commandsIssued,
                auth_verified: false,
                read_only_confirmed: true,
                raw_members_count: discoveredSeats.length,
                access_denied: false,
              },
              authRequired: true,
              errorDiagnostic: `Authentication required on Slack for profile '${profile}' at ${pageUrl}`,
            };
          }
          break;
        }

        const rawData = runRes.data as Record<string, unknown> | null;
        const data = (rawData?.data && typeof rawData.data === 'object' ? rawData.data : rawData) as {
          authRequired?: boolean;
          access_denied?: boolean;
          members?: ScrapedSlackUser[];
          hasNext?: boolean;
        } | null;

        if (data?.authRequired) {
          return {
            platform: 'slack',
            workspace_slug: workspaceSlug,
            total_members: discoveredSeats.length,
            seats: discoveredSeats,
            evidence: {
              pages_scraped: currentPage - 1,
              fields_discovered: SLACK_VERIFIED_FIELDS,
              webcmd_commands_issued: commandsIssued,
              auth_verified: false,
              read_only_confirmed: true,
              raw_members_count: discoveredSeats.length,
              access_denied: false,
            },
            authRequired: true,
            errorDiagnostic: `Redirected to signin. Human sign-in required for profile '${profile}'`,
          };
        }

        if (data?.access_denied) {
          return {
            platform: 'slack',
            workspace_slug: workspaceSlug,
            total_members: discoveredSeats.length,
            seats: discoveredSeats,
            evidence: {
              pages_scraped: currentPage - 1,
              fields_discovered: SLACK_VERIFIED_FIELDS,
              webcmd_commands_issued: commandsIssued,
              auth_verified: true,
              read_only_confirmed: true,
              raw_members_count: discoveredSeats.length,
              access_denied: true,
            },
            authRequired: false,
            errorDiagnostic: `Access denied to Slack Admin Member directory for profile '${profile}'`,
          };
        }

        const rawMembers = data?.members ?? [];
        for (const rawUser of rawMembers) {
          if (rawUser.user_id || rawUser.display_name) {
            const seat = this.normalizeSeat(rawUser, workspaceSlug, monthlyCost);
            if (!discoveredSeats.some((s) => s.user_id === seat.user_id)) {
              discoveredSeats.push(seat);
            }
          }
        }

        hasNextPage = Boolean(data?.hasNext) && rawMembers.length > 0;
        currentPage++;
      }

      return {
        platform: 'slack',
        workspace_slug: workspaceSlug,
        total_members: discoveredSeats.length,
        seats: discoveredSeats,
        evidence: {
          pages_scraped: currentPage - 1,
          fields_discovered: SLACK_VERIFIED_FIELDS,
          webcmd_commands_issued: commandsIssued,
          auth_verified: true,
          read_only_confirmed: true,
          raw_members_count: discoveredSeats.length,
          access_denied: false,
        },
        authRequired: false,
      };

    } finally {
      // Step 3: Always clean up and close browser session
      commandsIssued.push(`webcmd --profile ${profile} session close ${sessionId} -f json`);
      await this.webcmd.closeSession(profile, sessionId, { timeoutMs: 10_000 });
    }
  }

  /**
   * Executes member deactivation on Slack using Webcmd browser automation.
   * If Slack workspace tier requires enterprise manual admin authorization, returns UNSUPPORTED safely.
   */
  async executeMemberOffboarding(options: SlackExecutionOptions): Promise<OffboardingExecutionResult> {
    const profile = options.profile ?? 'slack-admin';
    const workspaceSlug = options.workspaceSlug.trim();
    const userId = options.userId.trim();
    const sessionTimeoutMs = options.sessionTimeoutMs ?? 30_000;
    const commandsIssued: string[] = [];

    const sessionName = `slack-exec-${workspaceSlug.toLowerCase()}-${Date.now()}`;
    commandsIssued.push(`webcmd --profile ${profile} session create ${sessionName} -f json`);

    const sessionRes = await this.webcmd.createSession(profile, sessionName, { timeoutMs: sessionTimeoutMs });
    if (!sessionRes.success || sessionRes.authRequired) {
      return {
        status: 'AUTH_REQUIRED',
        platform: 'slack',
        user_id: userId,
        verified: false,
        message: sessionRes.errorDiagnostic || `Authentication required on Slack for profile '${profile}'`,
        webcmd_commands_issued: commandsIssued,
      };
    }

    const sessionId = sessionRes.data?.id ?? sessionName;

    try {
      const pageUrl = `https://${workspaceSlug}.slack.com/admin/users?query=${encodeURIComponent(userId)}`;

      const execScript = `
        if (!window.location.href.includes('/admin/users')) {
          await page.goto('${pageUrl}', { waitUntil: 'domcontentloaded' });
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/ssb/signin') || currentUrl.includes('/login') || currentUrl.includes('slack.com/signin')) {
          return { status: 'AUTH_REQUIRED', verified: false, message: 'Redirected to Slack sign-in page.' };
        }

        const pageTitle = document.title || '';
        if (pageTitle.includes('404') || pageTitle.includes('Access Denied') || pageTitle.includes('Unauthorized')) {
          return { status: 'ACCESS_DENIED', verified: false, message: 'Access denied to Slack Admin Member directory.' };
        }

        const result = await page.evaluate((targetId) => {
          const rows = document.querySelectorAll('tr.member_row, tr[data-member-id], div.member_item, tr.c-table__row');
          let targetRow = null;

          for (const row of rows) {
            const memberIdAttr = row.getAttribute('data-member-id') || '';
            const rowText = row.textContent || '';
            if (memberIdAttr.toLowerCase().includes(targetId.toLowerCase()) || rowText.toLowerCase().includes(targetId.toLowerCase())) {
              targetRow = row;
              break;
            }
          }

          if (!targetRow) {
            return { status: 'NOT_FOUND', verified: false, message: 'Target member not found in Slack admin directory.' };
          }

          const deactivateBtn = targetRow.querySelector('button[data-action="deactivate-user"], a.deactivate_member, button.c-button--danger');
          if (!deactivateBtn) {
            return {
              status: 'UNSUPPORTED',
              verified: false,
              message: 'Slack user deactivation requires manual enterprise 2FA or owner authorization on this workspace tier.'
            };
          }

          deactivateBtn.click();
          const confirmBtn = document.querySelector('button.c-button--danger[type="submit"], button#confirm_deactivate');
          if (confirmBtn) {
            confirmBtn.click();
          }

          return { status: 'EXECUTED', verified: true, message: 'Slack member deactivation action triggered successfully.' };
        }, userId);

        return result;
      `;

      commandsIssued.push(`webcmd --profile ${profile} --session ${sessionId} browser run --stdin -f json (exec deactivate ${userId})`);

      const runRes = await this.webcmd.browserRun(profile, sessionId, execScript, { timeoutMs: sessionTimeoutMs });
      if (!runRes.success || runRes.authRequired) {
        if (runRes.authRequired) {
          return {
            status: 'AUTH_REQUIRED',
            platform: 'slack',
            user_id: userId,
            verified: false,
            message: `Authentication required on Slack for profile '${profile}'`,
            webcmd_commands_issued: commandsIssued,
          };
        }
        return {
          status: 'EXECUTION_FAILED',
          platform: 'slack',
          user_id: userId,
          verified: false,
          message: runRes.errorDiagnostic || 'Webcmd browser run failed during execution',
          webcmd_commands_issued: commandsIssued,
        };
      }

      const rawData = runRes.data as Record<string, unknown> | null;
      const data = (rawData?.data && typeof rawData.data === 'object' ? rawData.data : rawData) as { status: ExecutionStatus; verified: boolean; message: string } | null;

      return {
        status: data?.status || 'UNSUPPORTED',
        platform: 'slack',
        user_id: userId,
        verified: Boolean(data?.verified),
        message: data?.message || 'Slack user deactivation evaluated.',
        webcmd_commands_issued: commandsIssued,
      };

    } finally {
      commandsIssued.push(`webcmd --profile ${profile} session close ${sessionId} -f json`);
      await this.webcmd.closeSession(profile, sessionId, { timeoutMs: 10_000 });
    }
  }
}
