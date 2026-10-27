import { FakeListChatModel } from '@langchain/core/utils/testing';
import { RunTree } from 'langsmith/run_trees';
import { withRunTree } from 'langsmith/traceable';
import { z } from 'zod';
import type { EvalFixture } from './fixtures.js';

const requestSchema = z.object({ contents: z.array(z.object({ parts: z.array(z.object({ text: z.string() })) })) });

/** Repeatable fault schedule, same first output for both arms; never measures real model quality. */
export function fakeFetch(fixture: EvalFixture, good: unknown, scenario: number): typeof fetch {
  let calls = 0;
  let misleading: unknown = good;
  if (typeof good === 'object' && good !== null) misleading = fixture.branch === 'measured' ? { ...good, observations: [] }
    : { ...good, headline: fixture.input.overall === 'controlled' ? '**Insufficient data**.' : 'Movements stayed **controlled**.' };
  const first = scenario === 0 ? JSON.stringify(good) : scenario === 3 ? JSON.stringify(misleading) : '{}';
  const model = new FakeListChatModel({ responses: [first, scenario === 2 ? '{}' : JSON.stringify(good)], maxRetries: 0 });
  return async (_url, init) => {
    calls++;
    if (scenario === 4) return new Response('{}', { status: 429 });
    if (scenario === 5) return new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
    if (calls > 2) throw new Error('Fake call bound exceeded');
    const parsed = requestSchema.parse(JSON.parse(String(init?.body)));
    const prompt = parsed.contents[0]?.parts[0]?.text ?? '';
    const output = await withRunTree(new RunTree({ name: 'offline-fake-no-tracing', tracingEnabled: false }), () =>
      model.invoke(prompt, { ...(init?.signal ? { signal: init.signal } : {}), callbacks: [] }));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: output.text }] }, finishReason: 'STOP' }] }));
  };
}
