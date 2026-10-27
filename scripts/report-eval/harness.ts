import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generatedReportSchema, reportResponseSchema, type ReportErrorCode } from '../../src/contracts/provider-report.js';
import { clinicianReportSchema, videoReportResponseSchema } from '../../src/contracts/video-report.js';
import { reportFacts } from '../../src/report/report-input.js';
import { VERIFIED_TEXT_MODELS, type GeminiConfig } from '../../server/gemini/config.js';
import { InstanceBudget } from '../../server/gemini/limits.js';
import { createReportEndpoint } from '../../server/gemini/report-endpoint.js';
import { measuredSpec, quickSpec } from '../../server/gemini/langchain/specs.js';
import type { PipelineMetrics, PipelineName } from '../../server/gemini/langchain/types.js';
import { fakeFetch } from './fake.js';
import type { EvalFixture } from './fixtures.js';

export type EvalOptions = { runs: number; maxCalls: number; live: boolean; yes: boolean; trace: boolean; fixture: string | null };
export type EvalRow = { fixtureId: string; repetition: number; pipeline: PipelineName; metrics: PipelineMetrics; wallDurationMs: number; calls: number; responseCode: string | null; caveats: string[] };
export type EvalRun = { mode: 'fake' | 'live'; date: string; modelId: string; runs: number; maxCalls: number; maximumPossibleCalls: number; calls: number;
  settings: { maxOutputTokens: number; thinkingLevel: string; timeoutMs: number; automaticProviderRetries: number }; rows: EvalRow[] };

export function parseOptions(args: string[]): EvalOptions {
  const options: EvalOptions = { runs: 3, maxCalls: 200, live: false, yes: false, trace: false, fixture: null };
  const number = (value: string | undefined, max: number): number => {
    if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error('Invalid numeric evaluation option.');
    return Number(value);
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--live': options.live = true; break;
      case '--yes': options.yes = true; break;
      case '--trace': options.trace = true; break;
      case '--runs': options.runs = number(args[++i], 100); break;
      case '--max-calls': options.maxCalls = number(args[++i], 100_000); break;
      case '--fixture': {
        const id = args[++i];
        if (!id || !/^[a-z0-9_-]+$/.test(id)) throw new Error('Invalid fixture selector.');
        options.fixture = id; break;
      }
      default: throw new Error('Unknown evaluation option.');
    }
  }
  return options;
}

export function assertRunAllowed(options: EvalOptions, env: Record<string, string | undefined>): void {
  if (options.live && !options.yes) throw new Error('Live evaluation requires --yes after reviewing the printed call bound.');
  if (options.live && !env.GEMINI_API_KEY?.trim()) throw new Error('Live evaluation requires server-side GEMINI_API_KEY.');
  if (options.trace && (!options.yes || !env.LANGSMITH_API_KEY?.trim())) throw new Error('Synthetic tracing requires --yes and LANGSMITH_API_KEY.');
}

const codeSchema = z.enum(['METHOD_NOT_ALLOWED', 'ORIGIN_DENIED', 'ACCESS_DENIED', 'PROTECTION_UNCONFIGURED', 'PROVIDER_DISABLED', 'INVALID_INPUT',
  'CONTEXT_NOT_PERMITTED', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'BUDGET_EXHAUSTED', 'TIMEOUT', 'CANCELLED', 'PROVIDER_ERROR', 'REFUSED',
  'MALFORMED_RESPONSE', 'REJECTED_CONTENT', 'NETWORK_ERROR', 'STALE_RESPONSE']);

function acceptedCaveats(fixture: EvalFixture, report: unknown): string[] {
  const notes = [...fixture.notes];
  if (fixture.branch === 'measured') {
    const parsed = generatedReportSchema.parse(report);
    const all = reportFacts(fixture.input).filter((f) => f.kind === 'metric' || f.kind === 'flag' || f.kind === 'exclusion');
    if (all.length > parsed.observations.length) notes.push(`Accepted report contains ${parsed.observations.length} observations for ${all.length} metric/flag/exclusion facts; completeness is not validated.`);
  } else {
    const parsed = clinicianReportSchema.parse(report);
    if ((fixture.input.overall !== 'controlled' && /\bcontrolled\b/i.test(parsed.headline)) ||
      (fixture.input.overall === 'controlled' && /insufficient data/i.test(parsed.headline)))
      notes.push('Accepted headline contradicts the supplied overall status; existing quick validator does not enforce status fidelity.');
  }
  return [...new Set(notes)];
}

/** Exercises the actual protected endpoint for BOTH arms, including all preflight/budget gates. */
export async function runEvaluation(fixtures: EvalFixture[], options: EvalOptions, env: Record<string, string | undefined> = {}, liveFetch: typeof fetch = fetch): Promise<EvalRun> {
  assertRunAllowed(options, env);
  const modelId = z.enum(VERIFIED_TEXT_MODELS).parse(env.GEMINI_TEXT_MODEL ?? VERIFIED_TEXT_MODELS[0]);
  const selected = options.fixture ? fixtures.filter((f) => f.id === options.fixture) : fixtures;
  if (!selected.length) throw new Error('No matching synthetic fixture.');
  const run: EvalRun = { mode: options.live ? 'live' : 'fake', date: new Date().toISOString(), modelId, runs: options.runs, maxCalls: options.maxCalls,
    maximumPossibleCalls: selected.length * options.runs * 3, calls: 0,
    settings: { maxOutputTokens: 2048, thinkingLevel: 'low', timeoutMs: 20_000, automaticProviderRetries: 0 }, rows: [] };
  const origin = 'https://synthetic-eval.invalid', access = 'fictional-evaluation-access-0123456789';
  const config: GeminiConfig = { mode: 'live', apiKey: options.live ? (env.GEMINI_API_KEY?.trim() ?? '') : 'offline-fake-key', textModel: modelId,
    ttsModel: 'gemini-3.8-flash-lite-tts', ttsVoice: 'Kore', accessCodeSha256: createHash('sha256').update(access).digest('hex'), allowedOrigins: [origin],
    limits: { reportPerHour: 100_000, ttsPerHour: 1, maxPerInstance: options.maxCalls } };
  const budget = new InstanceBudget(options.maxCalls);
  for (const [index, fixture] of selected.entries()) for (let repetition = 1; repetition <= options.runs; repetition++) for (const pipeline of ['direct', 'langchain'] as const) {
    const spec = fixture.branch === 'measured' ? await measuredSpec(fixture.input) : await quickSpec(fixture.input);
    let metrics: PipelineMetrics | null = null, calls = 0;
    const provider = options.live ? liveFetch : fakeFetch(fixture, spec.fallback(), (index + repetition - 1) % 6);
    const boundedFetch: typeof fetch = async (url, init) => {
      if (run.calls >= options.maxCalls) return new Response('{}', { status: 429 });
      run.calls++; calls++;
      return provider(url, init);
    };
    const endpoint = createReportEndpoint({ config, budget, fetch: boundedFetch, env: { SCOOT_LLM_PIPELINE: pipeline }, onMetrics: (event) => { metrics = event; } });
    const body = fixture.branch === 'measured' ? { input: fixture.input } : { videoInput: fixture.input };
    const started = performance.now();
    const response = await endpoint(new Request(`${origin}/api/gemini-report`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const raw: unknown = await response.json();
    const wallDurationMs = performance.now() - started;
    const parsed = fixture.branch === 'measured' ? reportResponseSchema.parse(raw) : videoReportResponseSchema.parse(raw);
    const responseCode: ReportErrorCode | null = parsed.ok ? null : codeSchema.parse(parsed.error.code);
    // Preflight/initial-budget rejection does not enter either provider pipeline.
    const measured: PipelineMetrics = metrics ?? { pipeline, branch: fixture.branch, exerciseId: fixture.input.exercise.id, promptVersion: spec.promptVersion,
      validatorVersion: spec.validatorVersion, modelId, inputDigest: spec.inputDigest, steps: [{ step: 'fallback', outcome: 'pass', durationMs: 0, attempt: 0, codes: [] }],
      attempts: 0, repaired: false, outcome: 'fallback_provider_error', failureClass: responseCode, durationMs: performance.now() - started };
    if (calls > (pipeline === 'direct' ? 1 : 2)) throw new Error('Pipeline exceeded provider call bound.');
    run.rows.push({ fixtureId: fixture.id, repetition, pipeline, metrics: measured, wallDurationMs, calls, responseCode,
      caveats: parsed.ok ? acceptedCaveats(fixture, parsed.report) : [] });
  }
  return run;
}
