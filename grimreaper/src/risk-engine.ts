/**
 * Risk Engine for SaaS GrimReaper
 *
 * Provides deterministic evaluation of SaaS seat activity, exempt status,
 * paid status, and inactivity thresholds.
 */

import type { PolicyRecommendation, RiskAssessment, RiskLevel, SaaSSeat } from './models.ts';

export interface RiskEngineOptions {
  /** Inactivity threshold in days (default: 90 days) */
  inactivity_threshold_days?: number;
  /** Reference timestamp for calculating inactivity (default: current Date) */
  reference_date?: Date;
}

/**
 * Calculates the number of full days elapsed between `lastActivity` and `referenceDate`.
 * Returns `null` if `lastActivity` is missing, invalid, or in the future (Rule 5 & Rule 7).
 */
export function calculateInactiveDays(
  lastActivity?: string,
  referenceDate: Date = new Date()
): number | null {
  if (!lastActivity || !lastActivity.trim()) {
    return null;
  }
  const parsed = Date.parse(lastActivity);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const diffMs = referenceDate.getTime() - parsed;
  // Future date check (Member 3 Rule 7: Future timestamps treated as unknown / NO_DATA)
  if (diffMs < 0) {
    return null;
  }
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export class RiskEngine {
  private readonly defaultThresholdDays: number;

  constructor(defaultThresholdDays = 90) {
    this.defaultThresholdDays = defaultThresholdDays;
  }

  /**
   * Deterministically evaluates a SaaS seat against inactivity, policy recommendation (KEEP/REVIEW),
   * exempt status, and paid seat rules.
   */
  evaluateSeat(seat: SaaSSeat, options: RiskEngineOptions = {}): RiskAssessment {
    const threshold = options.inactivity_threshold_days ?? this.defaultThresholdDays;
    const refDate = options.reference_date ?? new Date();
    const inactiveDays = calculateInactiveDays(seat.last_activity, refDate);

    // Rule 1: Exempt users are never flagged (Policy: KEEP)
    if (seat.exempt) {
      return {
        flagged: false,
        risk_level: 'NONE',
        recommendation: 'KEEP',
        inactive_days: inactiveDays,
        reason: 'User is explicitly marked exempt from offboarding audit',
      };
    }

    // Rule 2: Free / unpaid seats do not incur license waste (Policy: KEEP)
    if (!seat.paid_seat) {
      return {
        flagged: false,
        risk_level: 'NONE',
        recommendation: 'KEEP',
        inactive_days: inactiveDays,
        reason: 'Unpaid/free seat does not incur direct license cost waste',
      };
    }

    // Rule 3: Missing or future activity data cannot be verified as inactive (Policy: KEEP)
    if (inactiveDays === null) {
      return {
        flagged: false,
        risk_level: 'NONE',
        recommendation: 'KEEP',
        inactive_days: null,
        reason: 'No valid activity timestamp available to determine inactivity',
      };
    }

    // Rule 4: Paid seat meets or exceeds inactivity threshold -> Flagged for review (Policy: REVIEW)
    if (inactiveDays >= threshold) {
      let riskLevel: RiskLevel = 'LOW';
      if (inactiveDays >= 180) {
        riskLevel = 'HIGH';
      } else if (inactiveDays >= 90) {
        riskLevel = 'MEDIUM';
      }

      return {
        flagged: true,
        risk_level: riskLevel,
        recommendation: 'REVIEW',
        inactive_days: inactiveDays,
        reason: `Paid seat inactive for ${inactiveDays} days (threshold: ${threshold} days)`,
      };
    }

    // Rule 5: User active within threshold (Policy: KEEP)
    return {
      flagged: false,
      risk_level: 'NONE',
      recommendation: 'KEEP',
      inactive_days: inactiveDays,
      reason: `User active within threshold (${inactiveDays} days < ${threshold} days)`,
    };
  }
}
