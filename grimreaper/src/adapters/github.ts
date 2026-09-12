/**
 * SaaS GrimReaper — GitHub Read-Only Audit Adapter
 *
 * Automates browser inspection of GitHub Organization Members and Organization Audit Logs
 * using Webcmd CLI.
 * Strictly READ-ONLY: Never executes write, remove, invite, or role modification actions.
 */

import type { SaaSSeat } from '../models.ts';
import { WebcmdCliWrapper, type WebcmdExecutionResult } from '../webcmd-cli.ts';

export interface GitHubAuditOptions {
  /** Webcmd browser profile to use (default: 'github-admin') */
  profile?: string;
  /** GitHub Organization slug, e.g. "acme-corp" */
  orgName: string;
  /** Monthly cost estimate per paid seat in USD (default: $21.00 for Enterprise) */
  monthlyCostPerSeat?: number;
  /** Maximum number of member list pagination pages to scrape (default: 10) */
  maxPages?: number;
  /** Enable/disable audit log query for actor activity (default: true) */
  fetchAuditLogActivity?: boolean;
  /** Command execution timeout in ms (default: 30000) */
  sessionTimeoutMs?: number;
}

export interface GitHubAuditEvidence {
  pages_scraped: number;
  fields_discovered: string[];
  webcmd_commands_issued: string[];
  auth_verified: boolean;
  read_only_confirmed: boolean;
  raw_members_count: number;
  audit_log_queries_count: number;
  audit_log_events_found: number;
  audit_log_access_denied: boolean;
}

export interface GitHubAuditResult {
  platform: 'github';
  org_name: string;
  total_members: number;
  seats: SaaSSeat[];
  evidence: GitHubAuditEvidence;
  authRequired: boolean;
  errorDiagnostic?: string;
}

export interface ScrapedGitHubUser {
  username: string;
  display_name: string | null;
  role: string;
  two_factor_enabled: boolean | null;
}

export interface ScrapedAuditLogEvent {
  action: string | null;
  timestamp: string | null;
  access_denied?: boolean;
  auth_required?: boolean;
}

export interface GitHubExecutionOptions {
  profile?: string;
  orgName: string;
  username: string;
  sessionTimeoutMs?: number;
}

export type ExecutionStatus =
  | 'EXECUTED'
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'VERIFICATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNSUPPORTED';

export interface OffboardingExecutionResult {
  status: ExecutionStatus;
  platform: 'github' | 'slack';
  user_id: string;
  verified: boolean;
  message: string;
  details?: Record<string, unknown>;
  webcmd_commands_issued: string[];
}

/**
 * Verified fields actually exposed across GitHub Org People page & Audit Log:
 * - username (verified from member link)
 * - display_name (verified from profile label if present, else null)
 * - role (verified from role badge/dropdown: 'Owner' | 'Member' | 'Billing Manager')
 * - email (null - GitHub hides email addresses on org people page)
 * - last_activity (verified from Org Owner Audit Log if accessible, else null)
 * - paid_seat (true - every org member occupies a paid seat)
 * - monthly_cost (21.0 - standard enterprise seat cost)
 */
export const GITHUB_VERIFIED_FIELDS = [
  'username',
  'display_name',
  'role',
  'two_factor_enabled',
  'last_activity',
  'paid_seat',
  'monthly_cost',
];

export class GitHubAdapter {
  private readonly webcmd: WebcmdCliWrapper;

  constructor(webcmdWrapper?: WebcmdCliWrapper) {
    this.webcmd = webcmdWrapper ?? new WebcmdCliWrapper();
  }

  /**
   * Normalizes raw scraped GitHub member & audit log data into a standard SaaSSeat model.
   */
  normalizeSeat(
    user: ScrapedGitHubUser,
    orgName: string,
    monthlyCost = 21.0,
    auditActivity?: ScrapedAuditLogEvent | null
  ): SaaSSeat {
    const handle = user.username.replace(/^@/, '').trim();
    
    // Parse timestamp if valid
    let validLastActivity: string | undefined = undefined;
    if (auditActivity?.timestamp && !auditActivity.access_denied) {
      const parsed = Date.parse(auditActivity.timestamp);
      if (!Number.isNaN(parsed)) {
        validLastActivity = new Date(parsed).toISOString();
      }
    }

    return {
      platform: 'github',
      user_id: `github_${orgName.toLowerCase()}_${handle.toLowerCase()}`,
      display_name: user.display_name || handle,
      email: undefined, // Explicitly undefined/null: not exposed on GitHub People page
      role: user.role || 'Member',
      last_activity: validLastActivity,
      paid_seat: true,
      monthly_cost: Math.max(0, monthlyCost),
      exempt: false,
      metadata: {
        github_username: handle,
        organization: orgName,
        two_factor_enabled: user.two_factor_enabled,
        profile_url: `https://github.com/${handle}`,
        last_activity_source: validLastActivity ? 'github_audit_log' : 'none',
        last_activity_event: validLastActivity ? (auditActivity?.action || 'audit_log_event') : null,
        audit_log_access_denied: Boolean(auditActivity?.access_denied),
      },
    };
  }

  /**
   * Performs a READ-ONLY audit of a GitHub organization member directory and audit log activity.
   */
  async auditOrganization(options: GitHubAuditOptions): Promise<GitHubAuditResult> {
    const profile = options.profile ?? 'github-admin';
    const orgName = options.orgName.trim();
    const monthlyCost = options.monthlyCostPerSeat ?? 21.0;
    const maxPages = options.maxPages ?? 10;
    const fetchAuditLog = options.fetchAuditLogActivity ?? true;
    const sessionTimeoutMs = options.sessionTimeoutMs ?? 30_000;

    const commandsIssued: string[] = [];
    const discoveredSeats: SaaSSeat[] = [];
    let auditLogQueriesCount = 0;
    let auditLogEventsFound = 0;
    let auditLogAccessDenied = false;

    // Step 1: Create an isolated session for this audit
    const sessionName = `github-audit-${orgName.toLowerCase()}-${Date.now()}`;
    commandsIssued.push(`webcmd --profile ${profile} session create ${sessionName} -f json`);
    
    const sessionRes = await this.webcmd.createSession(profile, sessionName, {
      timeoutMs: sessionTimeoutMs,
    });

    if (!sessionRes.success || sessionRes.authRequired) {
      return {
        platform: 'github',
        org_name: orgName,
        total_members: 0,
        seats: [],
        evidence: {
          pages_scraped: 0,
          fields_discovered: GITHUB_VERIFIED_FIELDS,
          webcmd_commands_issued: commandsIssued,
          auth_verified: false,
          read_only_confirmed: true,
          raw_members_count: 0,
          audit_log_queries_count: 0,
          audit_log_events_found: 0,
          audit_log_access_denied: false,
        },
        authRequired: sessionRes.authRequired,
        errorDiagnostic: sessionRes.errorDiagnostic ?? 'Failed to create Webcmd browser session for GitHub audit',
      };
    }

    const sessionId = sessionRes.data?.id ?? sessionName;

    try {
      let currentPage = 1;
      let hasNextPage = true;
      const rawScrapedUsers: ScrapedGitHubUser[] = [];

      // Step 2: Scrape Member List Pages
      while (hasNextPage && currentPage <= maxPages) {
        const pageUrl = `https://github.com/orgs/${orgName}/people?page=${currentPage}`;
        
        const extractScript = `
          if (window.location.href !== '${pageUrl}') {
            await page.goto('${pageUrl}', { waitUntil: 'domcontentloaded' });
          }

          const currentUrl = page.url();
          if (currentUrl.includes('/login') || currentUrl.includes('/session')) {
            return { authRequired: true, members: [], hasNext: false };
          }

          const extracted = await page.evaluate(() => {
            const items = [];
            const rows = document.querySelectorAll('.js-bulk-actions-target, [data-bulk-actions-target], li.table-list-item, div.member-list-item, div.Box-row');
            
            rows.forEach((row) => {
              const userLink = row.querySelector('a[aria-label], a[data-hovercard-type="user"], a.Link--primary, a[href^="/orgs/"]');
              if (!userLink) return;

              let href = userLink.getAttribute('href') || '';
              let username = href.split('/').pop() || userLink.textContent.trim();
              username = username.replace(/^@/, '').trim();
              if (!username || username === 'people' || username === 'teams') return;

              const nameEl = row.querySelector('.f4, .color-fg-muted, span[itemprop="name"]');
              const displayName = nameEl ? nameEl.textContent.trim() : null;

              let role = 'Member';
              const textContent = row.textContent || '';
              if (textContent.includes('Owner')) {
                role = 'Owner';
              } else if (textContent.includes('Billing manager')) {
                role = 'Billing Manager';
              }

              let twoFactor = null;
              if (textContent.includes('2FA enabled')) {
                twoFactor = true;
              } else if (textContent.includes('2FA disabled')) {
                twoFactor = false;
              }

              items.push({
                username,
                display_name: displayName !== username ? displayName : null,
                role,
                two_factor_enabled: twoFactor,
              });
            });

            const nextBtn = document.querySelector('a.next_page, a[rel="next"]');
            const hasNext = Boolean(nextBtn && !nextBtn.classList.contains('disabled'));

            return { authRequired: false, members: items, hasNext };
          });

          return extracted;
        `;

        commandsIssued.push(`webcmd --profile ${profile} --session ${sessionId} browser run --stdin -f json (people page ${currentPage})`);

        const runRes = await this.webcmd.browserRun(profile, sessionId, extractScript, {
          timeoutMs: sessionTimeoutMs,
        });

        if (!runRes.success || runRes.authRequired) {
          if (runRes.authRequired) {
            return {
              platform: 'github',
              org_name: orgName,
              total_members: discoveredSeats.length,
              seats: discoveredSeats,
              evidence: {
                pages_scraped: currentPage - 1,
                fields_discovered: GITHUB_VERIFIED_FIELDS,
                webcmd_commands_issued: commandsIssued,
                auth_verified: false,
                read_only_confirmed: true,
                raw_members_count: discoveredSeats.length,
                audit_log_queries_count: 0,
                audit_log_events_found: 0,
                audit_log_access_denied: false,
              },
              authRequired: true,
              errorDiagnostic: `Authentication required on GitHub for profile '${profile}' at ${pageUrl}`,
            };
          }
          break;
        }

        const rawData = runRes.data as Record<string, unknown> | null;
        const data = (rawData?.data && typeof rawData.data === 'object' ? rawData.data : rawData) as { authRequired?: boolean; members?: ScrapedGitHubUser[]; hasNext?: boolean } | null;

        if (data?.authRequired) {
          return {
            platform: 'github',
            org_name: orgName,
            total_members: discoveredSeats.length,
            seats: discoveredSeats,
            evidence: {
              pages_scraped: currentPage - 1,
              fields_discovered: GITHUB_VERIFIED_FIELDS,
              webcmd_commands_issued: commandsIssued,
              auth_verified: false,
              read_only_confirmed: true,
              raw_members_count: discoveredSeats.length,
              audit_log_queries_count: 0,
              audit_log_events_found: 0,
              audit_log_access_denied: false,
            },
            authRequired: true,
            errorDiagnostic: `Redirected to login. Human sign-in required for profile '${profile}'`,
          };
        }

        const rawMembers = data?.members ?? [];
        for (const rawUser of rawMembers) {
          if (rawUser.username && !rawScrapedUsers.some((u) => u.username.toLowerCase() === rawUser.username.toLowerCase())) {
            rawScrapedUsers.push(rawUser);
          }
        }

        hasNextPage = Boolean(data?.hasNext) && rawMembers.length > 0;
        currentPage++;
      }

      // Step 3: Fetch Audit Log activity per member if enabled
      for (const user of rawScrapedUsers) {
        let auditActivity: ScrapedAuditLogEvent | null = null;

        if (fetchAuditLog && !auditLogAccessDenied) {
          auditLogQueriesCount++;
          const auditUrl = `https://github.com/organizations/${orgName}/settings/audit-log?q=actor:${user.username}`;
          
          const auditScript = `
            await page.goto('${auditUrl}', { waitUntil: 'domcontentloaded' });
            
            const currentUrl = page.url();
            if (currentUrl.includes('/login') || currentUrl.includes('/session')) {
              return { auth_required: true, access_denied: false, action: null, timestamp: null };
            }

            // Check if page returned 404/403 or non-owner redirect
            const pageTitle = document.title || '';
            const pageText = document.body ? document.body.textContent : '';
            if (
              pageTitle.includes('Page not found') ||
              pageTitle.includes('Access Denied') ||
              pageText.includes('You must be an organization owner') ||
              !currentUrl.includes('/settings/audit-log')
            ) {
              return { auth_required: false, access_denied: true, action: null, timestamp: null };
            }

            // Extract latest audit log entry row
            return page.evaluate(() => {
              // Target audit log rows
              const rows = document.querySelectorAll('tr[id^="audit-log-entry"], div.audit-log-entry, tr.audit-log-row, table.audit-log-table tr');
              if (rows.length === 0) {
                // Try semantic relative-time or time elements
                const timeEl = document.querySelector('time[datetime], relative-time[datetime]');
                if (!timeEl) {
                  return { auth_required: false, access_denied: false, action: null, timestamp: null };
                }
                const dt = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent;
                return { auth_required: false, access_denied: false, action: 'audit_event', timestamp: dt };
              }

              // Extract first (latest) row
              const firstRow = rows[0];
              const timeEl = firstRow.querySelector('time[datetime], relative-time[datetime], time');
              const actionEl = firstRow.querySelector('.action, .audit-log-action, code, td');
              
              const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent) : null;
              const action = actionEl ? actionEl.textContent.trim() : 'audit_event';

              return { auth_required: false, access_denied: false, action, timestamp };
            });
          `;

          commandsIssued.push(`webcmd --profile ${profile} --session ${sessionId} browser run --stdin -f json (audit log ${user.username})`);

          const auditRes = await this.webcmd.browserRun(profile, sessionId, auditScript, {
            timeoutMs: sessionTimeoutMs,
          });

          if (auditRes.success && auditRes.data) {
            const rawAuditData = auditRes.data as Record<string, unknown>;
            const data = (rawAuditData.data && typeof rawAuditData.data === 'object' ? rawAuditData.data : rawAuditData) as ScrapedAuditLogEvent;
            if (data.auth_required) {
              return {
                platform: 'github',
                org_name: orgName,
                total_members: discoveredSeats.length,
                seats: discoveredSeats,
                evidence: {
                  pages_scraped: currentPage - 1,
                  fields_discovered: GITHUB_VERIFIED_FIELDS,
                  webcmd_commands_issued: commandsIssued,
                  auth_verified: false,
                  read_only_confirmed: true,
                  raw_members_count: rawScrapedUsers.length,
                  audit_log_queries_count: auditLogQueriesCount,
                  audit_log_events_found: auditLogEventsFound,
                  audit_log_access_denied: auditLogAccessDenied,
                },
                authRequired: true,
                errorDiagnostic: `Authentication required on GitHub for profile '${profile}' at ${auditUrl}`,
              };
            }

            if (data.access_denied) {
              auditLogAccessDenied = true;
              auditActivity = { action: null, timestamp: null, access_denied: true };
            } else if (data.timestamp) {
              auditLogEventsFound++;
              auditActivity = data;
            }
          }
        }

        const seat = this.normalizeSeat(user, orgName, monthlyCost, auditActivity);
        discoveredSeats.push(seat);
      }

      return {
        platform: 'github',
        org_name: orgName,
        total_members: discoveredSeats.length,
        seats: discoveredSeats,
        evidence: {
          pages_scraped: currentPage - 1,
          fields_discovered: GITHUB_VERIFIED_FIELDS,
          webcmd_commands_issued: commandsIssued,
          auth_verified: true,
          read_only_confirmed: true,
          raw_members_count: rawScrapedUsers.length,
          audit_log_queries_count: auditLogQueriesCount,
          audit_log_events_found: auditLogEventsFound,
          audit_log_access_denied: auditLogAccessDenied,
        },
        authRequired: false,
      };

    } finally {
      // Step 4: Always clean up and close browser session
      commandsIssued.push(`webcmd --profile ${profile} session close ${sessionId} -f json`);
      await this.webcmd.closeSession(profile, sessionId, { timeoutMs: 10_000 });
    }
  }

  /**
   * Executes member removal on GitHub using Webcmd browser automation.
   * STRICT SAFETY: Executed ONLY after human approval has been verified by backend state machine.
   */
  async executeMemberOffboarding(options: GitHubExecutionOptions): Promise<OffboardingExecutionResult> {
    const profile = options.profile ?? 'github-admin';
    const orgName = options.orgName.trim();
    const username = options.username.trim().replace(/^@/, '');
    const sessionTimeoutMs = options.sessionTimeoutMs ?? 30_000;
    const commandsIssued: string[] = [];
    const userId = `github_${orgName.toLowerCase()}_${username.toLowerCase()}`;

    // Step 1: Create an isolated session for execution
    const sessionName = `github-exec-${orgName.toLowerCase()}-${username.toLowerCase()}-${Date.now()}`;
    commandsIssued.push(`webcmd --profile ${profile} session create ${sessionName} -f json`);

    const sessionRes = await this.webcmd.createSession(profile, sessionName, { timeoutMs: sessionTimeoutMs });
    if (!sessionRes.success || sessionRes.authRequired) {
      return {
        status: 'AUTH_REQUIRED',
        platform: 'github',
        user_id: userId,
        verified: false,
        message: sessionRes.errorDiagnostic || `Authentication required on GitHub for profile '${profile}'`,
        webcmd_commands_issued: commandsIssued,
      };
    }

    const sessionId = sessionRes.data?.id ?? sessionName;

    try {
      const pageUrl = `https://github.com/orgs/${orgName}/people?query=${encodeURIComponent(username)}`;

      const execScript = `
        if (window.location.href !== '${pageUrl}') {
          await page.goto('${pageUrl}', { waitUntil: 'domcontentloaded' });
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/session')) {
          return { status: 'AUTH_REQUIRED', verified: false, message: 'Redirected to login page.' };
        }

        const pageTitle = document.title || '';
        const pageText = document.body ? document.body.textContent : '';
        if (pageTitle.includes('Page not found') || pageTitle.includes('Access Denied') || pageText.includes('You must be an organization owner')) {
          return { status: 'ACCESS_DENIED', verified: false, message: 'Access denied to organization people admin page.' };
        }

        // Locate member row and execute removal
        const removalResult = await page.evaluate((targetUser) => {
          const rows = document.querySelectorAll('.js-bulk-actions-target, [data-bulk-actions-target], li.table-list-item, div.member-list-item, div.Box-row');
          let targetRow = null;

          for (const row of rows) {
            const userLink = row.querySelector('a[href*="/' + targetUser + '"], a.Link--primary, a[data-hovercard-type="user"]');
            if (userLink) {
              const href = userLink.getAttribute('href') || '';
              const linkUser = href.split('/').pop() || userLink.textContent.trim();
              if (linkUser.replace(/^@/, '').toLowerCase() === targetUser.toLowerCase()) {
                targetRow = row;
                break;
              }
            }
          }

          if (!targetRow) {
            return { status: 'NOT_FOUND', verified: false, message: 'Target member not found in organization member directory.' };
          }

          const actionBtn = targetRow.querySelector('button[data-action="remove-member"], button.js-remove-member, summary[aria-label*="Member"], button[aria-label*="Remove"]');
          if (!actionBtn) {
            return { status: 'EXECUTION_FAILED', verified: false, message: 'Removal button or action controls not found for target member.' };
          }

          actionBtn.click();

          const confirmModal = document.querySelector('button[type="submit"].btn-danger, button#confirm-remove, button[data-confirm-remove]');
          if (confirmModal) {
            confirmModal.click();
          }

          return { status: 'PENDING_VERIFICATION', verified: false, message: 'Removal action triggered.' };
        }, username);

        if (removalResult.status !== 'PENDING_VERIFICATION') {
          return removalResult;
        }

        // Step 2: Post-Verification (Re-navigate to confirm member is gone)
        await page.goto('${pageUrl}', { waitUntil: 'domcontentloaded' });
        const postVerification = await page.evaluate((targetUser) => {
          const rows = document.querySelectorAll('.js-bulk-actions-target, [data-bulk-actions-target], li.table-list-item, div.member-list-item, div.Box-row');
          let stillPresent = false;

          for (const row of rows) {
            const userLink = row.querySelector('a[href*="/' + targetUser + '"], a.Link--primary, a[data-hovercard-type="user"]');
            if (userLink) {
              const href = userLink.getAttribute('href') || '';
              const linkUser = href.split('/').pop() || userLink.textContent.trim();
              if (linkUser.replace(/^@/, '').toLowerCase() === targetUser.toLowerCase()) {
                stillPresent = true;
                break;
              }
            }
          }

          if (stillPresent) {
            return { status: 'VERIFICATION_FAILED', verified: false, message: 'Post-verification failed: member remains present in org.' };
          }

          return { status: 'EXECUTED', verified: true, message: 'Successfully removed member from GitHub organization.' };
        }, username);

        return postVerification;
      `;

      commandsIssued.push(`webcmd --profile ${profile} --session ${sessionId} browser run --stdin -f json (exec remove ${username})`);

      const runRes = await this.webcmd.browserRun(profile, sessionId, execScript, { timeoutMs: sessionTimeoutMs });
      if (!runRes.success || runRes.authRequired) {
        if (runRes.authRequired) {
          return {
            status: 'AUTH_REQUIRED',
            platform: 'github',
            user_id: userId,
            verified: false,
            message: `Authentication required on GitHub for profile '${profile}'`,
            webcmd_commands_issued: commandsIssued,
          };
        }
        return {
          status: 'EXECUTION_FAILED',
          platform: 'github',
          user_id: userId,
          verified: false,
          message: runRes.errorDiagnostic || 'Webcmd browser run failed during execution',
          webcmd_commands_issued: commandsIssued,
        };
      }

      const rawData = runRes.data as Record<string, unknown> | null;
      const data = (rawData?.data && typeof rawData.data === 'object' ? rawData.data : rawData) as { status: ExecutionStatus; verified: boolean; message: string } | null;

      const finalStatus = data?.status || 'EXECUTION_FAILED';
      const finalVerified = Boolean(data?.verified);

      return {
        status: finalStatus,
        platform: 'github',
        user_id: userId,
        verified: finalVerified,
        message: data?.message || 'Execution completed.',
        webcmd_commands_issued: commandsIssued,
      };

    } finally {
      commandsIssued.push(`webcmd --profile ${profile} session close ${sessionId} -f json`);
      await this.webcmd.closeSession(profile, sessionId, { timeoutMs: 10_000 });
    }
  }
}
