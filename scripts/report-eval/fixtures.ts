import { z } from 'zod';
import { reportInputSchema } from '../../src/contracts/provider-report.js';
import { videoReportInputSchema } from '../../src/contracts/video-report.js';

const common = { id: z.string().regex(/^[a-z0-9_-]+$/), fictional: z.literal(true), notes: z.array(z.string().max(300)).max(8) };
export const evalFixturesSchema = z.array(z.discriminatedUnion('branch', [
  z.strictObject({ ...common, branch: z.literal('measured'), input: reportInputSchema.refine((i) => i.provenance === 'labeled_synthetic_fixture') }),
  z.strictObject({ ...common, branch: z.literal('quick'), input: videoReportInputSchema }),
])).min(1).max(30).refine((fixtures) => new Set(fixtures.map((f) => f.id)).size === fixtures.length);
export type EvalFixture = z.infer<typeof evalFixturesSchema>[number];
