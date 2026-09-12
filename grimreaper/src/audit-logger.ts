/**
 * Audit Logger for SaaS GrimReaper
 *
 * Persists append-only audit trail logs for all seat audits, risk decisions,
 * approval state changes, and offboarding executions while redacting secrets.
 */

import { sanitizeLogs } from './webcmd-cli.ts';
import type { ApprovalState, PotentialSavings, SaaSPlatform } from './models.ts';

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  platform: SaaSPlatform;
  user_id: string;
  action: string;
  risk_decision: string;
  savings_estimate: PotentialSavings;
  approval_state: ApprovalState;
  execution_result?: unknown;
  error_information?: string;
}

export class AuditLogger {
  private readonly records: AuditLogRecord[] = [];

  /**
   * Logs an audit record, sanitizing any sensitive text or error information.
   */
  log(recordInput: Omit<AuditLogRecord, 'id' | 'timestamp'>): AuditLogRecord {
    const sanitizedError = recordInput.error_information
      ? sanitizeLogs(recordInput.error_information)
      : undefined;

    const record: AuditLogRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...recordInput,
      error_information: sanitizedError,
    };

    this.records.push(record);
    return record;
  }

  /** Retrieves all logged audit records. */
  getRecords(): ReadonlyArray<AuditLogRecord> {
    return [...this.records];
  }

  /** Retrieves audit records filtered by user_id. */
  getRecordsForUser(userId: string): AuditLogRecord[] {
    return this.records.filter((r) => r.user_id === userId);
  }

  /** Clears in-memory audit logs (useful for testing). */
  clear(): void {
    this.records.length = 0;
  }
}
