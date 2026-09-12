/**
 * Member 3 Engine Policy & Risk Rules Unit Tests
 *
 * Uses Node.js native test runner (node:test) and assertions (node:assert/strict).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RiskEngine, calculateInactiveDays } from '../src/risk-engine.ts';
import type { SaaSSeat } from '../src/models.ts';

describe('Member 3 Policy & Risk Integration Tests', () => {
  const refDate = new Date('2026-09-12T12:00:00Z');

  describe('Future Date Sanitization (Rule 7)', () => {
    it('should return null (NO_DATA) when last_activity is in the future relative to referenceDate', () => {
      const futureDate = '2026-10-01T00:00:00Z';
      const inactive = calculateInactiveDays(futureDate, refDate);
      assert.equal(inactive, null);
    });

    it('should assign KEEP recommendation and NONE risk for future last_activity', () => {
      const riskEngine = new RiskEngine();
      const seat: SaaSSeat = {
        platform: 'github',
        user_id: 'gh_future_user',
        display_name: 'Future User',
        role: 'Member',
        last_activity: '2026-12-31T00:00:00Z',
        paid_seat: true,
        monthly_cost: 21.0,
        exempt: false,
      };

      const assessment = riskEngine.evaluateSeat(seat, { reference_date: refDate });
      assert.equal(assessment.flagged, false);
      assert.equal(assessment.risk_level, 'NONE');
      assert.equal(assessment.recommendation, 'KEEP');
      assert.equal(assessment.inactive_days, null);
    });
  });

  describe('Policy Recommendation (KEEP vs REVIEW)', () => {
    it('should assign Recommendation.REVIEW iff inactive_days >= threshold, paid_seat is true, and exempt is false', () => {
      const riskEngine = new RiskEngine(60); // 60 day threshold (Member 3 spec)

      // 60 days inactive -> REVIEW
      const seat60: SaaSSeat = {
        platform: 'slack',
        user_id: 'slack_60',
        display_name: 'User 60d',
        role: 'Full Member',
        last_activity: '2026-07-14T12:00:00Z', // Exactly 60 days before 2026-09-12
        paid_seat: true,
        monthly_cost: 8.75,
        exempt: false,
      };

      const eval60 = riskEngine.evaluateSeat(seat60, { reference_date: refDate, inactivity_threshold_days: 60 });
      assert.equal(eval60.flagged, true);
      assert.equal(eval60.recommendation, 'REVIEW');

      // 59 days inactive -> KEEP
      const seat59: SaaSSeat = {
        ...seat60,
        last_activity: '2026-07-15T12:00:00Z', // 59 days ago
      };

      const eval59 = riskEngine.evaluateSeat(seat59, { reference_date: refDate, inactivity_threshold_days: 60 });
      assert.equal(eval59.flagged, false);
      assert.equal(eval59.recommendation, 'KEEP');
    });

    it('should assign KEEP recommendation for exempt or free seats even if inactive for 200 days', () => {
      const riskEngine = new RiskEngine();

      const exemptSeat: SaaSSeat = {
        platform: 'github',
        user_id: 'gh_exempt_200',
        display_name: 'Exempt User',
        role: 'Owner',
        last_activity: '2025-01-01T00:00:00Z',
        paid_seat: true,
        monthly_cost: 21.0,
        exempt: true,
      };

      const freeSeat: SaaSSeat = {
        platform: 'slack',
        user_id: 'slack_free_200',
        display_name: 'Guest User',
        role: 'Guest',
        last_activity: '2025-01-01T00:00:00Z',
        paid_seat: false,
        monthly_cost: 0,
        exempt: false,
      };

      const evalExempt = riskEngine.evaluateSeat(exemptSeat, { reference_date: refDate });
      assert.equal(evalExempt.flagged, false);
      assert.equal(evalExempt.recommendation, 'KEEP');

      const evalFree = riskEngine.evaluateSeat(freeSeat, { reference_date: refDate });
      assert.equal(evalFree.flagged, false);
      assert.equal(evalFree.recommendation, 'KEEP');
    });
  });
});
