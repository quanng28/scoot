import { describe, expect, it } from 'vitest';
import { CUE_CATALOG, CUE_CATALOG_VERSION, CUE_IDS, cueDefinition, MAX_CUE_TEXT_CHARS, ttsRequestSchema } from './cue.js';

describe('approved cue catalog', () => {
  it('is versioned, bounded and has unique exact sentences', () => {
    expect(CUE_CATALOG_VERSION).toBe('seated-cues.v2');
    const texts = CUE_IDS.map((id) => CUE_CATALOG[id].text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(MAX_CUE_TEXT_CHARS);
  });

  it('contains no pain/disease inference, safety guarantee, farther-reach or treatment wording', () => {
    const banned = /\b(pain|hurt|disease|diagnos|stroke|weak|safe|unsafe|correct|good|perfect|farther|further|more|harder|push|keep going|treat|therap|medic|dose|recover|improv)\w*/i;
    for (const id of CUE_IDS) expect(CUE_CATALOG[id].text, id).not.toMatch(banned);
  });

  it('gives stop cues the highest priority and lets them play while the Stop handler runs', () => {
    for (const id of CUE_IDS) {
      const cue = cueDefinition(id);
      if (cue.category === 'stop') { expect(cue.priority).toBe(3); expect(cue.allowedPhases).toContain('recording'); expect(cue.allowedPhases).toContain('closed'); }
      else expect(cue.priority).toBeLessThan(3);
      expect(cue.expiryMs).toBeGreaterThan(0);
    }
  });

  it('accepts only known cue IDs for the current catalog version and never free text', () => {
    expect(ttsRequestSchema.safeParse({ catalogVersion: CUE_CATALOG_VERSION, cueId: 'tracking.wrist' }).success).toBe(true);
    expect(ttsRequestSchema.safeParse({ catalogVersion: CUE_CATALOG_VERSION, cueId: 'tracking.wrist', text: 'Reach farther' }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ catalogVersion: CUE_CATALOG_VERSION, cueId: 'say.anything' }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ catalogVersion: 'seated-cues.v0', cueId: 'tracking.wrist' }).success).toBe(false);
  });
});
