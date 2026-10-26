import { z } from 'zod';

/**
 * Optional reported context (PRD FR-14, checklist E1). Kept beside, never inside, measured observations:
 * - self-report: the person's own wording, who entered it, when, and whether they confirmed it;
 * - clinician context: existing diagnosis/restriction text supplied from outside the app, with verification status.
 * Absence means "not reported", never "no symptoms". Nothing here is inferred from pose; the existing
 * discomfort Stop event and yes/no/not_reported answer stay in the session record unchanged.
 */
export const SESSION_CONTEXT_VERSION = 'session-context.v1';

/** Real context stays on the device until the provider/data gate (FR-21, E3) is resolved. */
export const dataClassSchema = z.enum(['synthetic_fixture', 'real']);
const text = (max: number) => z.string().trim().min(1).max(max);
/** sr-N for self-report, cc-N for clinician context; also the only IDs the report input accepts. */
const contextId = z.string().regex(/^(sr|cc)-\d{1,3}$/);

export const selfReportEntrySchema = z.strictObject({
  id: contextId, kind: z.literal('self_report'),
  /** Original wording as entered; never paraphrased by the app or a model. */
  originalText: text(500),
  reportedAt: z.iso.datetime(),
  timing: z.enum(['before_recording', 'after_recording']),
  source: z.enum(['participant', 'supervisor_on_behalf']),
  confirmation: z.enum(['confirmed_by_participant', 'unconfirmed']),
  dataClass: dataClassSchema,
});

export const clinicianContextEntrySchema = z.strictObject({
  id: contextId, kind: z.literal('clinician_context'),
  category: z.enum(['diagnosis', 'restriction', 'other']),
  text: text(500),
  suppliedAt: z.iso.datetime(),
  suppliedBy: z.enum(['clinician', 'supervisor_relaying_clinician']),
  verification: z.enum(['unverified', 'verified_against_source_record']),
  dataClass: dataClassSchema,
});

export const sessionContextSchema = z.strictObject({
  schemaVersion: z.literal(SESSION_CONTEXT_VERSION),
  selfReport: z.array(selfReportEntrySchema).max(10),
  clinician: z.array(clinicianContextEntrySchema).max(10),
}).superRefine((c, ctx) => {
  const ids = [...c.selfReport, ...c.clinician].map((e) => e.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'context entry IDs must be unique' });
});
export type SelfReportEntry = z.infer<typeof selfReportEntrySchema>;
export type ClinicianContextEntry = z.infer<typeof clinicianContextEntrySchema>;
export type ContextEntry = SelfReportEntry | ClinicianContextEntry;
export type SessionContext = z.infer<typeof sessionContextSchema>;

/** Default for new and legacy sessions: nothing reported. */
export function emptyContext(): SessionContext {
  return { schemaVersion: SESSION_CONTEXT_VERSION, selfReport: [], clinician: [] };
}

/** Display wording that never turns missing context into a negative finding. */
export function selfReportStatusText(context: SessionContext): string {
  return context.selfReport.length ? `${context.selfReport.length} self-reported note(s), shown in the person's own words.` : 'No self-report was recorded. This does not mean no symptoms.';
}
