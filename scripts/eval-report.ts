import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'langsmith';
import { VERIFIED_TEXT_MODELS } from '../server/gemini/config.js';
import { traceable } from 'langsmith/traceable';
import { evalFixturesSchema } from './report-eval/fixtures.js';
import { parseOptions, runEvaluation, type EvalRun } from './report-eval/harness.js';
import { summarizeRun } from './report-eval/summary.js';

/** Explicit synthetic-only metadata tracing; server modules have no path to this opt-in. */
async function traceSyntheticMetrics(run: EvalRun): Promise<void> {
  const client = new Client({ hideInputs: true, hideOutputs: true });
  for (const row of run.rows) {
    const emit = traceable(async () => {
      for (const step of row.metrics.steps) {
        await traceable(async () => ({}), { name: `report.${step.step}`, tracingEnabled: true, client,
          metadata: { ...step, exportedRetrospectively: true }, processInputs: () => ({}), processOutputs: () => ({}) })();
      }
      return {};
    }, { name: 'scoot.synthetic-report-evaluation', tracingEnabled: true, client,
      metadata: { exportedRetrospectively: true, pipeline: row.pipeline, branch: row.metrics.branch, outcome: row.metrics.outcome, attempts: row.metrics.attempts,
        modelId: row.metrics.modelId, promptVersion: row.metrics.promptVersion, validatorVersion: row.metrics.validatorVersion },
      processInputs: () => ({}), processOutputs: () => ({}) });
    await emit();
  }
  await client.awaitPendingTraceBatches();
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args);
  // This executable is a separate process; inherited SDK debug logging must never print fixtures.
  process.env.LANGCHAIN_VERBOSE = 'false';
  const raw: unknown = JSON.parse(await readFile(resolve('fixtures/report-eval/cases.json'), 'utf8'));
  const fixtures = evalFixturesSchema.parse(raw);
  const selected = options.fixture ? fixtures.filter((f) => f.id === options.fixture) : fixtures;
  const modelId = VERIFIED_TEXT_MODELS.find((model) => model === (process.env.GEMINI_TEXT_MODEL ?? VERIFIED_TEXT_MODELS[0]));
  if (!modelId) throw new Error('Unsupported evaluation model configuration.');
  process.stdout.write(`${JSON.stringify({ modelId, mode: options.live ? 'live' : 'fake', fixtures: selected.length, repetitions: options.runs,
    maximumPossibleCalls: selected.length * options.runs * 3, hardMaxCalls: options.maxCalls,
    maxOutputTokens: 2048, thinkingLevel: 'low', timeoutMs: 20_000, automaticProviderRetries: 0,
    notice: 'Live mode requires --live, GEMINI_API_KEY and --yes; no cost estimate is invented.' })}\n`);
  const run = await runEvaluation(fixtures, options, process.env);
  const directory = resolve('eval-results');
  await mkdir(directory, { recursive: true });
  const stamp = run.date.replace(/[:.]/g, '-');
  const base = resolve(directory, `${stamp}-${run.mode}`);
  await writeFile(`${base}.json`, JSON.stringify(run, null, 2) + '\n');
  await writeFile(`${base}.md`, summarizeRun(run));
  process.stdout.write(`Saved ${run.rows.length} outcomes; ${run.calls} calls. Results: ${base}.json and ${base}.md\n`);
  if (options.trace) await traceSyntheticMetrics(run);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {
    // Never print an exception: SDK/provider errors may contain payloads or credentials.
    process.stderr.write('Evaluation stopped. Check options, synthetic fixture schemas, required keys and --yes. No exception payload was logged.\n');
    process.exitCode = 1;
  });
}
