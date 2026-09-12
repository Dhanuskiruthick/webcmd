/**
 * SaaS GrimReaper Core Data Models
 *
 * Defines normalized SaaS seat structures, risk assessment outputs,
 * potential savings calculations, and approval state definitions.
 */

export type SaaSPlatform = 'github' | 'slack';

export interface SaaSSeat {
  platform: SaaSPlatform;
  user_id: string;
  display_name: string;
  email?: string;
  role: string;
  /** ISO 8601 timestamp of last recorded user activity, e.g. "2026-05-10T12:00:00Z" */
  last_activity?: string;
  paid_seat: boolean;
  monthly_cost: number;
  exempt: boolean;
  metadata?: Record<string, unknown>;
}

export type ApprovalState =
  | 'DISCOVERED'
  | 'FLAGGED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTED'
  | 'REJECTED';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type PolicyRecommendation = 'KEEP' | 'REVIEW';

export interface RiskAssessment {
  flagged: boolean;
  risk_level: RiskLevel;
  recommendation?: PolicyRecommendation;
  inactive_days: number | null;
  reason: string;
}

export interface PotentialSavings {
  /** Estimated monthly savings if all flagged candidate seats are offboarded. */
  monthly_potential_savings: number;
  /** Estimated annual savings if all flagged candidate seats are offboarded. */
  annual_potential_savings: number;
  /** Total count of candidate seats flagged for offboarding review. */
  candidate_seat_count: number;
}

export interface ManagedSeatCandidate {
  seat: SaaSSeat;
  risk: RiskAssessment;
  approval_state: ApprovalState;
  flagged_at?: string;
  approved_at?: string;
  rejected_at?: string;
  executed_at?: string;
}
