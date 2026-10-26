import { z } from 'zod';
import { reachConfigSchema, reasonText, type ReachAttempt, type ReachConfig } from '../analysis/reach-contract.js';
import { SeatedReachAnalyzer } from '../analysis/seated-reach.js';
import type { Recording } from '../capture/recorder.js';

const finite = z.number().finite();
const time = finite.nonnegative();
const text = z.string().min(1).max(2000);
const reason = z.enum(Object.keys(reasonText) as [keyof typeof reasonText, ...(keyof typeof reasonText)[]]);
const reasons = z.array(reason).max(30);
const value = <T extends string>(unit: T) => z.strictObject({ value: finite.nullable(), unit: z.literal(unit), reasons });
export const reachResultSchema = z.strictObject({
  id: text, sessionId: text, configurationId: text, analysisVersion: text,
  exerciseId: z.literal('seated_forward_reach'), mode: z.enum(['rehabilitation','wellness']), side: z.enum(['left','right']),
  startMs: time, targetMs: time.nullable(), endMs: time, classification: z.enum(['measurable','excluded']), reasons, explanations: z.array(text),
  metrics: z.strictObject({ elbowPeakDeg: value('degrees'), torsoForwardPeakDeg: value('degrees'), wristForwardPeak: value('reference lengths'), reachDurationSec: value('seconds') }),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: time, observationCount: z.number().int().nonnegative() }),
  flags: z.array(z.strictObject({ metric: z.enum(['elbowPeakDeg','torsoForwardPeakDeg','wristForwardPeak','reachDurationSec']), operator: z.enum(['<','>']),
    threshold: finite, observed: finite, replay: z.strictObject({ startMs: time, endMs: time }), explanation: text })),
}).superRefine((a,ctx) => {
  const fail = (message: string) => ctx.addIssue({code:'custom',message});
  if(a.endMs<a.startMs || (a.targetMs!==null && (a.targetMs<a.startMs || a.targetMs>a.endMs))) fail('Invalid recording-relative attempt range');
  if(new Set(a.reasons).size!==a.reasons.length) fail('Duplicate exclusion reasons');
  if(a.explanations.length!==a.reasons.length) fail('Each exclusion reason needs an explanation');
  if(a.classification==='excluded' && (!a.reasons.length || a.flags.length)) fail('Excluded attempts need reasons and no flags');
  if(a.classification==='measurable' && (a.reasons.length || a.targetMs===null)) fail('Measurable attempts require all phases');
  for(const m of Object.values(a.metrics)) {
    if(m.value===null ? !m.reasons.length || a.classification==='measurable' : m.reasons.length>0 || m.value<0 || (m.unit==='degrees' && m.value>180)) fail('Invalid measurement or null reasons');
    if(a.classification==='excluded' && m.value!==null) fail('Excluded diagnostic values cannot become reported metrics');
  }
  if(a.metrics.reachDurationSec.value!==null && (a.targetMs===null || Math.abs(a.metrics.reachDurationSec.value-(a.targetMs-a.startMs)/1000)>1e-9)) fail('Duration differs from phase timestamps');
  for(const f of a.flags) {
    if(f.observed!==a.metrics[f.metric].value || !(f.operator==='>'?f.observed>f.threshold:f.observed<f.threshold)) fail('Flag differs from measured comparison');
    if(f.replay.startMs<a.startMs || f.replay.endMs>a.endMs || f.replay.endMs<f.replay.startMs) fail('Flag range outside attempt');
  }
});
export type ReachResult = z.infer<typeof reachResultSchema>;
/** Producer handoff only. Replay decode and save states belong to the consumer. */
export const reachProducerSchema = z.strictObject({
  schemaVersion: z.literal('sr01-producer.v1'), timebase: z.literal('recording-relative-ms'),
  provenance: z.enum(['synthetic_fixture','developer_camera']), participantReady: z.literal(false),
  configuration: reachConfigSchema, attempts: z.array(reachResultSchema).max(1000),
  recording: z.strictObject({ durationMs: time, mimeType: z.string().max(100), complete: z.boolean(), reason: text.nullable(),
    timing: z.literal('estimated-recorder-start'), replay: z.literal('not_checked') }),
}).superRefine((r,ctx) => {
  const fail = (message: string) => ctx.addIssue({code:'custom',message});
  try { new SeatedReachAnalyzer(r.configuration); } catch { fail('Invalid fixed reach configuration'); }
  if(r.recording.complete && r.recording.reason!==null) fail('Complete recording cannot carry a failure reason');
  if(!r.recording.complete && r.recording.reason===null) fail('Incomplete recording needs a reason');
  if(new Set(r.attempts.map(a=>a.id)).size!==r.attempts.length) fail('Duplicate attempt IDs');
  const c = r.configuration;
  for(const a of r.attempts) {
    if(a.sessionId!==c.sessionId || a.configurationId!==c.configurationId || a.analysisVersion!==c.version || a.mode!==c.mode || a.side!==c.side) fail('Attempt/configuration mismatch');
    // A shorter or failed recording limits replay, never the independently measured attempt.
    if(a.classification==='measurable' && (a.quality.coverage<c.settings.minCoverage || a.quality.longestGapMs>c.settings.maxGapMs || a.quality.observationCount<c.settings.minObservations)) fail('Measurable attempt failed quality settings');
    const expected = a.classification==='measurable' ? c.criteria.filter(f=> {
      const measured=a.metrics[f.metric].value;
      return measured!==null && (f.operator==='>'?measured>f.threshold:measured<f.threshold);
    }) : [];
    if(expected.length!==a.flags.length || expected.some((e,i)=>e.metric!==a.flags[i]?.metric || e.operator!==a.flags[i]?.operator || e.threshold!==a.flags[i]?.threshold)) fail('Flags differ from configured criteria');
  }
});
export type ReachProducerOutput = z.infer<typeof reachProducerSchema>;

export function createReachProducerOutput(config: ReachConfig, attempts: ReachAttempt[], recording: Recording, provenance: ReachProducerOutput['provenance']): ReachProducerOutput {
  if(![recording.startMs,recording.endMs].every(Number.isFinite) || recording.startMs<0 || recording.endMs<recording.startMs) throw new Error('Invalid recording clock');
  if(recording.complete && (!(recording.blob instanceof Blob) || !recording.blob.size || recording.blob.type!==recording.mimeType)) throw new Error('Complete recording needs a nonempty Blob with matching MIME type');
  return reachProducerSchema.parse({schemaVersion:'sr01-producer.v1',timebase:'recording-relative-ms',provenance,participantReady:false,configuration:config,
    attempts:attempts.map(a=>{
      const {observations,evidence,...result}=a; void observations; void evidence; return result;
    }),recording:{durationMs:recording.endMs-recording.startMs,mimeType:recording.mimeType,complete:recording.complete,reason:recording.reason,timing:'estimated-recorder-start',replay:'not_checked'}});
}

/** Estimated seek range with context. Decode capability and actual duration are supplied by the consumer. */
export function attemptReplayRange(rawAttempt: unknown, recordedDurationMs: number, decodedDurationMs: number, contextMs=500): {startMs:number;endMs:number;timing:'estimated-recorder-start'} | null {
  const parsed=reachResultSchema.safeParse(rawAttempt);
  if(!parsed.success || ![recordedDurationMs,decodedDurationMs,contextMs].every(Number.isFinite) || recordedDurationMs<=0 || decodedDurationMs<=0 || contextMs<0) return null;
  const duration=Math.min(recordedDurationMs,decodedDurationMs), a=parsed.data;
  if(a.endMs>duration || a.endMs<=a.startMs) return null;
  return {startMs:Math.max(0,a.startMs-contextMs),endMs:Math.min(duration,a.endMs+contextMs),timing:'estimated-recorder-start'};
}
