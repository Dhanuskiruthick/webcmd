/**
 * SaaS GrimReaper Safe Demo Data Generator
 *
 * Provides realistic but clearly fake demo records for GitHub and Slack audits.
 * All identities use synthetic .test domains.
 */

import type { SaaSSeat } from './models.ts';

function daysAgoISO(days: number, refDate: Date = new Date()): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(refDate.getTime() - ms).toISOString();
}

/**
 * Returns GitHub demo seats with activity dates relative to referenceDate (default: current Date).
 */
export function getGitHubDemoSeats(orgName = 'acme-corp', referenceDate: Date = new Date()): SaaSSeat[] {
  const cleanOrg = orgName.trim().toLowerCase();
  const auditTs = referenceDate.toISOString();

  return [
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_arun.dev`,
      display_name: 'Arun Dev',
      email: 'arun.dev@example.test',
      role: 'Developer',
      last_activity: daysAgoISO(2, referenceDate),
      paid_seat: true,
      monthly_cost: 21,
      exempt: false,
      metadata: {
        github_username: 'arun.dev',
        organization: orgName,
        profile_url: 'https://github.com/arun.dev',
        last_activity_source: 'GitHub Demo Workspace',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_maya.ops`,
      display_name: 'Maya Ops',
      email: 'maya.ops@example.test',
      role: 'DevOps Engineer',
      last_activity: daysAgoISO(4, referenceDate),
      paid_seat: true,
      monthly_cost: 21,
      exempt: false,
      metadata: {
        github_username: 'maya.ops',
        organization: orgName,
        profile_url: 'https://github.com/maya.ops',
        last_activity_source: 'GitHub Demo Workspace',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_rahul.old`,
      display_name: 'Rahul Old',
      email: 'rahul.old@example.test',
      role: 'Developer',
      last_activity: daysAgoISO(137, referenceDate),
      paid_seat: true,
      monthly_cost: 21,
      exempt: false,
      metadata: {
        github_username: 'rahul.old',
        organization: orgName,
        profile_url: 'https://github.com/rahul.old',
        last_activity_source: 'GitHub Demo Workspace',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_sneha.intern`,
      display_name: 'Sneha Intern',
      email: 'sneha.intern@example.test',
      role: 'Intern',
      last_activity: daysAgoISO(182, referenceDate),
      paid_seat: true,
      monthly_cost: 21,
      exempt: false,
      metadata: {
        github_username: 'sneha.intern',
        organization: orgName,
        profile_url: 'https://github.com/sneha.intern',
        last_activity_source: 'GitHub Demo Workspace',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_bot-ci`,
      display_name: 'bot-ci',
      email: 'bot-ci@example.test',
      role: 'Automation/Bot',
      last_activity: undefined, // MISSING / UNKNOWN
      paid_seat: true,
      monthly_cost: 21,
      exempt: false,
      metadata: {
        github_username: 'bot-ci',
        organization: orgName,
        profile_url: 'https://github.com/bot-ci',
        last_activity_source: 'none',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'github',
      user_id: `github_${cleanOrg}_guest-user`,
      display_name: 'Guest User',
      email: 'guest-user@example.test',
      role: 'Guest',
      last_activity: daysAgoISO(210, referenceDate),
      paid_seat: false,
      monthly_cost: 0,
      exempt: false,
      metadata: {
        github_username: 'guest-user',
        organization: orgName,
        profile_url: 'https://github.com/guest-user',
        last_activity_source: 'GitHub Demo Workspace',
        evidence_source: 'GitHub Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
  ];
}

/**
 * Returns Slack demo seats with activity dates relative to referenceDate (default: current Date).
 */
export function getSlackDemoSeats(
  workspaceSlug = 'acme-corp',
  monthlyCostOverride?: number,
  referenceDate: Date = new Date()
): SaaSSeat[] {
  const cleanWorkspace = workspaceSlug.trim().toLowerCase();
  const cost = typeof monthlyCostOverride === 'number' && monthlyCostOverride > 0 ? monthlyCostOverride : 8;
  const auditTs = referenceDate.toISOString();

  return [
    {
      platform: 'slack',
      user_id: `slack_${cleanWorkspace}_alex`,
      display_name: 'Alex',
      email: 'alex@example.test',
      role: 'Engineer',
      last_activity: daysAgoISO(1, referenceDate),
      paid_seat: true,
      monthly_cost: cost,
      exempt: false,
      metadata: {
        slack_user_id: 'alex',
        workspace: workspaceSlug,
        last_activity_source: 'Slack Demo Workspace',
        evidence_source: 'Slack Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'slack',
      user_id: `slack_${cleanWorkspace}_priya`,
      display_name: 'Priya',
      email: 'priya@example.test',
      role: 'Security Engineer',
      last_activity: daysAgoISO(3, referenceDate),
      paid_seat: true,
      monthly_cost: cost,
      exempt: false,
      metadata: {
        slack_user_id: 'priya',
        workspace: workspaceSlug,
        last_activity_source: 'Slack Demo Workspace',
        evidence_source: 'Slack Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'slack',
      user_id: `slack_${cleanWorkspace}_karthik`,
      display_name: 'Karthik',
      email: 'karthik@example.test',
      role: 'Engineer',
      last_activity: daysAgoISO(121, referenceDate),
      paid_seat: true,
      monthly_cost: cost,
      exempt: false,
      metadata: {
        slack_user_id: 'karthik',
        workspace: workspaceSlug,
        last_activity_source: 'Slack Demo Workspace',
        evidence_source: 'Slack Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'slack',
      user_id: `slack_${cleanWorkspace}_old-intern`,
      display_name: 'Old Intern',
      email: 'old-intern@example.test',
      role: 'Intern',
      last_activity: daysAgoISO(164, referenceDate),
      paid_seat: true,
      monthly_cost: cost,
      exempt: false,
      metadata: {
        slack_user_id: 'old-intern',
        workspace: workspaceSlug,
        last_activity_source: 'Slack Demo Workspace',
        evidence_source: 'Slack Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
    {
      platform: 'slack',
      user_id: `slack_${cleanWorkspace}_integration-bot`,
      display_name: 'Integration Bot',
      email: 'integration-bot@example.test',
      role: 'Integration/Bot',
      last_activity: undefined, // MISSING / UNKNOWN
      paid_seat: true,
      monthly_cost: cost,
      exempt: false,
      metadata: {
        slack_user_id: 'integration-bot',
        workspace: workspaceSlug,
        last_activity_source: 'none',
        evidence_source: 'Slack Demo Workspace',
        audit_timestamp: auditTs,
      },
    },
  ];
}
