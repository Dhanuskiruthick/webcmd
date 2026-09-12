/**
 * SaaS GrimReaper Orchestrator Component
 *
 * Coordinates Webcmd CLI interaction, seat analysis, risk classification,
 * savings estimation, approval workflows, and audit trail generation.
 */

import { AuditLogger } from './audit-logger.ts';
import { executeOffboardingGuardrail, validateStateTransition, UnauthorizedExecutionError } from './approval.ts';
import type { ManagedSeatCandidate, PotentialSavings, SaaSSeat } from './models.ts';
import { RiskEngine, type RiskEngineOptions } from './risk-engine.ts';
import { calculatePotentialSavings } from './savings.ts';
import { WebcmdCliWrapper } from './webcmd-cli.ts';
import { GitHubAdapter, type GitHubAuditOptions, type GitHubAuditResult, type OffboardingExecutionResult } from './adapters/github.ts';
import { SlackAdapter, type SlackAuditOptions, type SlackAuditResult } from './adapters/slack.ts';

export interface OrchestratorOptions {
  riskEngineOptions?: RiskEngineOptions;
  webcmdWrapper?: WebcmdCliWrapper;
}

export interface GitHubOrchestrationResult {
  audit_result: GitHubAuditResult;
  candidates: ManagedSeatCandidate[];
  potential_savings: PotentialSavings;
  summary: {
    total_seats: number;
    flagged_seats: number;
    auth_required: boolean;
    audit_log_access_denied: boolean;
  };
}

export interface SlackOrchestrationResult {
  audit_result: SlackAuditResult;
  candidates: ManagedSeatCandidate[];
  potential_savings: PotentialSavings;
  summary: {
    total_seats: number;
    flagged_seats: number;
    auth_required: boolean;
    access_denied: boolean;
  };
}

export class GrimReaperOrchestrator {
  private readonly riskEngine: RiskEngine;
  private readonly riskEngineOptions?: RiskEngineOptions;
  private readonly auditLogger: AuditLogger;
  private readonly webcmdWrapper: WebcmdCliWrapper;
  private readonly candidates: Map<string, ManagedSeatCandidate> = new Map();

  constructor(options: OrchestratorOptions = {}) {
    this.riskEngineOptions = options.riskEngineOptions;
    this.riskEngine = new RiskEngine(options.riskEngineOptions?.inactivity_threshold_days);
    this.auditLogger = new AuditLogger();
    this.webcmdWrapper = options.webcmdWrapper ?? new WebcmdCliWrapper();
  }

  getWebcmd(): WebcmdCliWrapper {
    return this.webcmdWrapper;
  }

  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  /**
   * Orchestrates an end-to-end GitHub Audit:
   * 1. Invokes GitHubAdapter.auditOrganization() via Webcmd CLI.
   * 2. Handles authRequired or audit log access denial safely.
   * 3. Ingests scraped seats into existing Risk Engine & Savings Pipeline.
   * 4. Logs audit records.
   */
  async auditGitHub(options: GitHubAuditOptions): Promise<GitHubOrchestrationResult> {
    const adapter = new GitHubAdapter(this.webcmdWrapper);
    const auditResult = await adapter.auditOrganization(options);

    if (auditResult.authRequired) {
      this.auditLogger.log({
        platform: 'github',
        user_id: 'system',
        action: 'GITHUB_AUDIT_AUTH_REQUIRED',
        risk_decision: auditResult.errorDiagnostic || 'Authentication required for GitHub profile',
        savings_estimate: { monthly_potential_savings: 0, annual_potential_savings: 0, candidate_seat_count: 0 },
        approval_state: 'DISCOVERED',
        error_information: auditResult.errorDiagnostic,
      });

      return {
        audit_result: auditResult,
        candidates: [],
        potential_savings: { monthly_potential_savings: 0, annual_potential_savings: 0, candidate_seat_count: 0 },
        summary: {
          total_seats: 0,
          flagged_seats: 0,
          auth_required: true,
          audit_log_access_denied: false,
        },
      };
    }

    // Ingest seats into existing pipeline
    const candidates = this.ingestSeats(auditResult.seats, this.riskEngineOptions);
    const potential_savings = calculatePotentialSavings(candidates);
    const flaggedCount = candidates.filter((c) => c.risk.flagged).length;

    this.auditLogger.log({
      platform: 'github',
      user_id: 'system',
      action: 'GITHUB_AUDIT_COMPLETED',
      risk_decision: `Audited org '${options.orgName}': Discovered ${auditResult.seats.length} seats (${flaggedCount} flagged)`,
      savings_estimate: potential_savings,
      approval_state: 'DISCOVERED',
    });

    return {
      audit_result: auditResult,
      candidates,
      potential_savings,
      summary: {
        total_seats: auditResult.seats.length,
        flagged_seats: flaggedCount,
        auth_required: false,
        audit_log_access_denied: Boolean(auditResult.evidence?.audit_log_access_denied),
      },
    };
  }

  /**
   * Orchestrates an end-to-end Slack Audit:
   * 1. Invokes SlackAdapter.auditWorkspace() via Webcmd CLI.
   * 2. Handles authRequired or access denial safely.
   * 3. Ingests scraped seats into existing Risk Engine & Savings Pipeline.
   * 4. Logs audit records.
   */
  async auditSlack(options: SlackAuditOptions): Promise<SlackOrchestrationResult> {
    const adapter = new SlackAdapter(this.webcmdWrapper);
    const auditResult = await adapter.auditWorkspace(options);

    if (auditResult.authRequired || auditResult.evidence?.access_denied) {
      this.auditLogger.log({
        platform: 'slack',
        user_id: 'system',
        action: auditResult.authRequired ? 'SLACK_AUDIT_AUTH_REQUIRED' : 'SLACK_AUDIT_ACCESS_DENIED',
        risk_decision: auditResult.errorDiagnostic || 'Authentication or permissions required for Slack workspace',
        savings_estimate: { monthly_potential_savings: 0, annual_potential_savings: 0, candidate_seat_count: 0 },
        approval_state: 'DISCOVERED',
        error_information: auditResult.errorDiagnostic,
      });

      return {
        audit_result: auditResult,
        candidates: [],
        potential_savings: { monthly_potential_savings: 0, annual_potential_savings: 0, candidate_seat_count: 0 },
        summary: {
          total_seats: 0,
          flagged_seats: 0,
          auth_required: auditResult.authRequired,
          access_denied: Boolean(auditResult.evidence?.access_denied),
        },
      };
    }

    // Ingest seats into existing pipeline
    const candidates = this.ingestSeats(auditResult.seats, this.riskEngineOptions);
    const potential_savings = calculatePotentialSavings(candidates);
    const flaggedCount = candidates.filter((c) => c.risk.flagged).length;

    this.auditLogger.log({
      platform: 'slack',
      user_id: 'system',
      action: 'SLACK_AUDIT_COMPLETED',
      risk_decision: `Audited Slack workspace '${options.workspaceSlug}': Discovered ${auditResult.seats.length} seats (${flaggedCount} flagged)`,
      savings_estimate: potential_savings,
      approval_state: 'DISCOVERED',
    });

    return {
      audit_result: auditResult,
      candidates,
      potential_savings,
      summary: {
        total_seats: auditResult.seats.length,
        flagged_seats: flaggedCount,
        auth_required: false,
        access_denied: false,
      },
    };
  }

  /**
   * Ingests a set of discovered SaaS seats, evaluates risk, and updates candidates.
   */
  ingestSeats(seats: SaaSSeat[], options: RiskEngineOptions = {}): ManagedSeatCandidate[] {
    const updatedCandidates: ManagedSeatCandidate[] = [];

    for (const seat of seats) {
      const risk = this.riskEngine.evaluateSeat(seat, options);
      const initialState = risk.flagged ? 'FLAGGED' : 'DISCOVERED';

      const candidate: ManagedSeatCandidate = {
        seat,
        risk,
        approval_state: initialState,
        ...(risk.flagged ? { flagged_at: new Date().toISOString() } : {}),
      };

      this.candidates.set(seat.user_id, candidate);
      updatedCandidates.push(candidate);

      const savings = calculatePotentialSavings([candidate]);
      this.auditLogger.log({
        platform: seat.platform,
        user_id: seat.user_id,
        action: risk.flagged ? 'SEAT_FLAGGED' : 'SEAT_DISCOVERED',
        risk_decision: risk.reason,
        savings_estimate: savings,
        approval_state: initialState,
      });
    }

    return updatedCandidates;
  }

  /** Returns all tracked candidates */
  getCandidates(): ManagedSeatCandidate[] {
    return Array.from(this.candidates.values());
  }

  /** Returns candidate by user_id */
  getCandidate(userId: string): ManagedSeatCandidate | undefined {
    return this.candidates.get(userId);
  }

  /** Returns overall potential savings across all candidates */
  getPotentialSavings(): PotentialSavings {
    return calculatePotentialSavings(this.getCandidates());
  }

  /** Transitions a candidate to PENDING_APPROVAL */
  requestApproval(userId: string): ManagedSeatCandidate {
    const candidate = this.requireCandidate(userId);
    validateStateTransition(candidate.approval_state, 'PENDING_APPROVAL');

    candidate.approval_state = 'PENDING_APPROVAL';

    this.auditLogger.log({
      platform: candidate.seat.platform,
      user_id: candidate.seat.user_id,
      action: 'APPROVAL_REQUESTED',
      risk_decision: candidate.risk.reason,
      savings_estimate: calculatePotentialSavings([candidate]),
      approval_state: 'PENDING_APPROVAL',
    });

    return candidate;
  }

  /** Approves a candidate seat for offboarding */
  approveCandidate(userId: string): ManagedSeatCandidate {
    const candidate = this.requireCandidate(userId);
    validateStateTransition(candidate.approval_state, 'APPROVED');

    candidate.approval_state = 'APPROVED';
    candidate.approved_at = new Date().toISOString();

    this.auditLogger.log({
      platform: candidate.seat.platform,
      user_id: candidate.seat.user_id,
      action: 'CANDIDATE_APPROVED',
      risk_decision: candidate.risk.reason,
      savings_estimate: calculatePotentialSavings([candidate]),
      approval_state: 'APPROVED',
    });

    return candidate;
  }

  /** Rejects a candidate seat from offboarding */
  rejectCandidate(userId: string, reason = 'Rejected by admin'): ManagedSeatCandidate {
    const candidate = this.requireCandidate(userId);
    validateStateTransition(candidate.approval_state, 'REJECTED');

    candidate.approval_state = 'REJECTED';
    candidate.rejected_at = new Date().toISOString();

    this.auditLogger.log({
      platform: candidate.seat.platform,
      user_id: candidate.seat.user_id,
      action: 'CANDIDATE_REJECTED',
      risk_decision: `Rejected: ${reason}`,
      savings_estimate: calculatePotentialSavings([candidate]),
      approval_state: 'REJECTED',
    });

    return candidate;
  }

  /**
   * Executes an approved offboarding action.
   * GUARANTEE: Will throw UnauthorizedExecutionError if candidate is NOT APPROVED.
   */
  async executeApprovedOffboarding<T = unknown>(
    userId: string,
    actionRunner: (candidate: ManagedSeatCandidate) => Promise<T>
  ): Promise<{ result: T; candidate: ManagedSeatCandidate }> {
    const candidate = this.requireCandidate(userId);

    try {
      const { result, updatedCandidate } = await executeOffboardingGuardrail(
        candidate,
        actionRunner
      );

      this.candidates.set(userId, updatedCandidate);

      this.auditLogger.log({
        platform: updatedCandidate.seat.platform,
        user_id: updatedCandidate.seat.user_id,
        action: 'OFFBOARDING_EXECUTED',
        risk_decision: updatedCandidate.risk.reason,
        savings_estimate: calculatePotentialSavings([updatedCandidate]),
        approval_state: 'EXECUTED',
        execution_result: result,
      });

      return { result, candidate: updatedCandidate };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.auditLogger.log({
        platform: candidate.seat.platform,
        user_id: candidate.seat.user_id,
        action: 'OFFBOARDING_FAILED',
        risk_decision: candidate.risk.reason,
        savings_estimate: calculatePotentialSavings([candidate]),
        approval_state: candidate.approval_state,
        error_information: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Executes offboarding for an explicitly APPROVED candidate.
   * SAFETY GUARANTEES:
   * 1. Requires candidate to exist in backend state.
   * 2. Requires candidate to be in APPROVED state (throws UnauthorizedExecutionError if not).
   * 3. Blocks candidates with NO_DATA (missing activity data).
   * 4. Dispatches platform-specific adapter browser execution.
   * 5. Sanitizes audit logs.
   */
  async executeCandidateOffboarding(userId: string): Promise<{ result: OffboardingExecutionResult; candidate: ManagedSeatCandidate }> {
    const candidate = this.requireCandidate(userId);

    // Rule 1: Candidate MUST be in APPROVED state
    if (candidate.approval_state !== 'APPROVED') {
      throw new UnauthorizedExecutionError(userId, candidate.approval_state);
    }

    // Rule 2: Candidates with NO_DATA cannot be offboarded
    if (!candidate.seat.last_activity || candidate.risk.inactive_days === null) {
      const unsupportedResult: OffboardingExecutionResult = {
        status: 'UNSUPPORTED',
        platform: candidate.seat.platform,
        user_id: userId,
        verified: false,
        message: `Execution blocked: Candidate '${userId}' has NO_DATA (missing activity timestamp).`,
        webcmd_commands_issued: [],
      };

      this.auditLogger.log({
        platform: candidate.seat.platform,
        user_id: userId,
        action: 'OFFBOARDING_BLOCKED_NO_DATA',
        risk_decision: 'Execution blocked for seat with NO_DATA',
        savings_estimate: calculatePotentialSavings([candidate]),
        approval_state: candidate.approval_state,
        error_information: unsupportedResult.message,
      });

      return { result: unsupportedResult, candidate };
    }

    return this.executeApprovedOffboarding(userId, async (approvedCand) => {
      if (approvedCand.seat.platform === 'github') {
        const adapter = new GitHubAdapter(this.webcmdWrapper);
        const orgName = (approvedCand.seat.metadata?.organization as string) || 'acme-corp';
        const username = (approvedCand.seat.metadata?.github_username as string) || approvedCand.seat.user_id.replace(/^github_[^_]+_/, '');
        return adapter.executeMemberOffboarding({ orgName, username });
      } else {
        const adapter = new SlackAdapter(this.webcmdWrapper);
        const workspaceSlug = (approvedCand.seat.metadata?.workspace as string) || 'acme-corp';
        return adapter.executeMemberOffboarding({ workspaceSlug, userId: approvedCand.seat.user_id });
      }
    });
  }

  private requireCandidate(userId: string): ManagedSeatCandidate {
    const candidate = this.candidates.get(userId);
    if (!candidate) {
      throw new Error(`Candidate user '${userId}' not found in GrimReaper orchestrator.`);
    }
    return candidate;
  }
}
