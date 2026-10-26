import { z } from 'zod';
import exercisesJson from './exercises.json' with { type: 'json' };
import modesJson from './modes.json' with { type: 'json' };

/** Runtime-validated subset of the catalog that the application consumes. The JSON stays the source of truth. */
const exerciseSchema = z.object({
  id: z.string().min(1),
  definitionVersion: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  supportedModeIds: z.array(z.enum(['rehabilitation', 'wellness'])).min(1),
  metrics: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), unit: z.string().min(1) })).min(1),
  clinicalReviewStatus: z.enum(['pending', 'approved']),
  technicalStatus: z.enum(['pending', 'validated']),
  availability: z.object({ status: z.enum(['blocked', 'available']), blockers: z.array(z.string()) }),
  validationEvidence: z.array(z.unknown()),
});
const catalogSchema = z.object({ schemaVersion: z.string().min(1), exercises: z.array(exerciseSchema).length(6) });
const modesSchema = z.object({ schemaVersion: z.string().min(1), modes: z.array(z.object({ id: z.enum(['rehabilitation', 'wellness']), displayName: z.string().min(1), purpose: z.string().min(1) })).length(2) });

export type CatalogExercise = z.infer<typeof exerciseSchema>;
export const catalog = catalogSchema.parse(exercisesJson);
export const modes = modesSchema.parse(modesJson).modes;

export function exerciseById(id: string): CatalogExercise {
  const found = catalog.exercises.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown catalog exercise ${id}`);
  return found;
}

/** Participant capture requires both statuses, availability and no blockers. Listing an entry never enables it. */
export function participantStartAllowed(entry: CatalogExercise): boolean {
  return entry.availability.status === 'available' && entry.availability.blockers.length === 0 &&
    entry.clinicalReviewStatus === 'approved' && entry.technicalStatus === 'validated' && entry.validationEvidence.length > 0;
}

export function readinessLabels(entry: CatalogExercise): string[] {
  if (participantStartAllowed(entry)) return ['Available'];
  const labels: string[] = [];
  if (entry.clinicalReviewStatus !== 'approved') labels.push('Needs clinical review');
  if (entry.technicalStatus !== 'validated') labels.push('Needs technical validation');
  if (!labels.length) labels.push('Blocked: release evidence incomplete');
  return labels;
}
