import { SESSION_CONTEXT_VERSION, type SessionContext } from '../contracts/session-context.js';

/**
 * Fictional context for report demos and tests (PRD FR-21). These are invented sentences for a
 * non-existent person; they are not clinical examples and must not be replaced with real patient text.
 */
export function syntheticContext(at = '2026-10-25T12:00:00.000Z'): SessionContext {
  return {
    schemaVersion: SESSION_CONTEXT_VERSION,
    selfReport: [{ id: 'sr-1', kind: 'self_report', originalText: 'FICTIONAL FIXTURE: shoulder felt a little stiff before starting.', reportedAt: at,
      timing: 'before_recording', source: 'participant', confirmation: 'confirmed_by_participant', dataClass: 'synthetic_fixture' }],
    clinician: [{ id: 'cc-1', kind: 'clinician_context', category: 'restriction', text: 'FICTIONAL FIXTURE: seated exercises only for this demonstration.', suppliedAt: at,
      suppliedBy: 'supervisor_relaying_clinician', verification: 'unverified', dataClass: 'synthetic_fixture' }],
  };
}
