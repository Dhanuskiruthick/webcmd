/**
 * Approval State Machine and Execution Guardrails for SaaS GrimReaper
 *
 * Enforces valid state transitions and guarantees that unapproved candidates
 * CANNOT reach execution functions.
 */

import type { ApprovalState, ManagedSeatCandidate } from './models.ts';

export class InvalidStateTransitionError extends Error {
  constructor(fromState: ApprovalState, toState: ApprovalState, reason?: string) {
    const msg = `Invalid state transition from '${fromState}' to '${toState}'${reason ? `: ${reason}` : ''}`;
    super(msg);
    this.name = 'InvalidStateTransitionError';
  }
}

export class UnauthorizedExecutionError extends Error {
  constructor(candidateId: string, currentState: ApprovalState) {
    const msg = `SECURITY VIOLATION: Execution blocked for user '${candidateId}'. Seat must be in 'APPROVED' state (current state: '${currentState}').`;
    super(msg);
    this.name = 'UnauthorizedExecutionError';
  }
}

/**
 * Validates allowed state transitions in the GrimReaper approval lifecycle.
 */
export function validateStateTransition(
  currentState: ApprovalState,
  nextState: ApprovalState
): void {
  const allowedTransitions: Record<ApprovalState, ApprovalState[]> = {
    DISCOVERED: ['FLAGGED', 'REJECTED'],
    FLAGGED: ['PENDING_APPROVAL', 'REJECTED'],
    PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
    APPROVED: ['EXECUTED', 'REJECTED'],
    EXECUTED: [], // Terminal state
    REJECTED: ['PENDING_APPROVAL'], // Re-evaluation if needed
  };

  const allowed = allowedTransitions[currentState] || [];
  if (!allowed.includes(nextState)) {
    throw new InvalidStateTransitionError(currentState, nextState);
  }
}

/**
 * Executes an approved offboarding action for a candidate seat.
 * HARD GUARDRAIL: Throws UnauthorizedExecutionError if candidate is NOT in APPROVED state.
 */
export async function executeOffboardingGuardrail<T = unknown>(
  candidate: ManagedSeatCandidate,
  actionRunner: (candidate: ManagedSeatCandidate) => Promise<T>
): Promise<{ result: T; updatedCandidate: ManagedSeatCandidate }> {
  // STRICT SECURITY CHECK
  if (candidate.approval_state !== 'APPROVED') {
    throw new UnauthorizedExecutionError(candidate.seat.user_id, candidate.approval_state);
  }

  // Execute actual runner
  const result = await actionRunner(candidate);

  const resObj = result as { status?: string; verified?: boolean } | null;
  const isFailure = Boolean(
    resObj &&
    typeof resObj === 'object' &&
    (resObj.status === 'AUTH_REQUIRED' ||
     resObj.status === 'ACCESS_DENIED' ||
     resObj.status === 'NOT_FOUND' ||
     resObj.status === 'VERIFICATION_FAILED' ||
     resObj.status === 'EXECUTION_FAILED' ||
     resObj.status === 'UNSUPPORTED' ||
     resObj.verified === false)
  );
  const isSuccess = !isFailure;

  const updatedCandidate: ManagedSeatCandidate = {
    ...candidate,
    approval_state: isSuccess ? 'EXECUTED' : 'APPROVED',
    ...(isSuccess ? { executed_at: new Date().toISOString() } : {}),
  };

  return { result, updatedCandidate };
}
