import { z } from 'zod';
import { acceptedReportSchema } from './provider-report.js';
import { emptyContext, sessionContextSchema } from './session-context.js';

/**
 * Per-session data that sits beside the strict producer-validated session record (checklist A5/F4):
 * reported context, the accepted explanation and an optional public video URL. Stored in its own
 * IndexedDB store so the reach/elbow consumer schemas and their saved sessions stay unchanged.
 * Sessions saved before this version have no extras row and open with defaults: nothing reported,
 * no explanation, no public link. Defaults never invent symptoms, diagnoses or confirmations.
 */
export const SESSION_EXTRAS_VERSION = 'session-extras.v1';

/** A shareable link must be a remote HTTPS URL, never a local blob:/data: URL (FR-33, H3). */
export const publicVideoSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(2048),
  publishedAt: z.iso.datetime(),
});

export const sessionExtrasSchema = z.strictObject({
  schemaVersion: z.literal(SESSION_EXTRAS_VERSION),
  sessionId: z.string().min(1),
  context: sessionContextSchema,
  acceptedReport: acceptedReportSchema.nullable(),
  publicVideo: publicVideoSchema.nullable(),
}).superRefine((x, ctx) => {
  if (x.acceptedReport && x.acceptedReport.sessionId !== x.sessionId) ctx.addIssue({ code: 'custom', message: 'accepted report belongs to another session' });
});
export type SessionExtras = z.infer<typeof sessionExtrasSchema>;

export function defaultExtras(sessionId: string): SessionExtras {
  return { schemaVersion: SESSION_EXTRAS_VERSION, sessionId, context: emptyContext(), acceptedReport: null, publicVideo: null };
}
