/**
 * Potential Savings Calculation Module for SaaS GrimReaper
 *
 * Computes potential financial savings from flagged candidate seats.
 * Note: These values represent POTENTIAL license waste, not guaranteed actual billing changes.
 */

import type { ManagedSeatCandidate, PotentialSavings } from './models.ts';

export function calculatePotentialSavings(candidates: ManagedSeatCandidate[]): PotentialSavings {
  const flaggedCandidates = candidates.filter((c) => c.risk.flagged);

  const monthlyTotal = flaggedCandidates.reduce((sum, item) => {
    const cost = Number(item.seat.monthly_cost) || 0;
    return sum + Math.max(0, cost);
  }, 0);

  const monthly_potential_savings = Math.round(monthlyTotal * 100) / 100;
  const annual_potential_savings = Math.round(monthlyTotal * 12 * 100) / 100;

  return {
    monthly_potential_savings,
    annual_potential_savings,
    candidate_seat_count: flaggedCandidates.length,
  };
}
