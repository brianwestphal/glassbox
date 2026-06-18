/**
 * GB-895 (P1) — SARIF mapping for review notes. Pins the note → SARIF `result`
 * contract: standard fields everywhere, with the single namespaced custom
 * property `ext-ai-tool-confidence`.
 */
import { describe, expect, it } from 'vitest';

import { buildResult, emptyLog } from '../../../src/review-notes/sarif.js';
import { ANCHOR_FINGERPRINT_KEY, CONFIDENCE_PROPERTY_KEY } from '../../../src/review-notes/types.js';

describe('buildResult', () => {
  const base = { file: 'src/x.ts', startLine: 10, endLine: 12, body: 'because reasons', kind: 'rationale' as const };

  it('maps anchor, body, and snippet to standard SARIF fields', () => {
    const r = buildResult(base, { guid: 'g1', snippet: 'const x = 1;', fingerprint: 'fp1' }) as Record<string, unknown>;
    expect(r.ruleId).toBe('review-note');
    expect(r.kind).toBe('informational');
    expect(r.guid).toBe('g1');
    const message = r.message as { text: string; markdown: string };
    expect(message.markdown).toBe('because reasons');
    expect(message.text).toBe('because reasons');
    const region = (r.locations as { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; endLine: number; snippet: { text: string } } } }[])[0].physicalLocation;
    expect(region.artifactLocation.uri).toBe('src/x.ts');
    expect(region.region.startLine).toBe(10);
    expect(region.region.endLine).toBe(12);
    expect(region.region.snippet.text).toBe('const x = 1;');
  });

  it('stores kind as a standard SARIF tag and confidence in the one namespaced property', () => {
    const r = buildResult({ ...base, confidence: 0.8 }, { guid: 'g2' }) as { properties: Record<string, unknown> };
    expect(r.properties.tags).toEqual(['rationale']);
    expect(r.properties[CONFIDENCE_PROPERTY_KEY]).toBe(0.8);
  });

  it('maps ticket to standard workItemUris, rank, and fingerprint', () => {
    const r = buildResult({ ...base, rank: 70, ticket: 'GB-895' }, { guid: 'g3', fingerprint: 'fp3' }) as Record<string, unknown>;
    expect(r.rank).toBe(70);
    expect(r.workItemUris).toEqual(['GB-895']);
    expect(r.partialFingerprints).toEqual({ [ANCHOR_FINGERPRINT_KEY]: 'fp3' });
  });

  it('escalates level for risk notes only', () => {
    expect((buildResult({ ...base, kind: 'risk' }, { guid: 'r' }) as { level: string }).level).toBe('warning');
    expect((buildResult({ ...base, kind: 'proof' }, { guid: 'p' }) as { level: string }).level).toBe('none');
  });

  it('omits optional fields when not provided', () => {
    const r = buildResult(base, { guid: 'g' }) as Record<string, unknown>;
    expect(r.rank).toBeUndefined();
    expect(r.workItemUris).toBeUndefined();
    expect((r.properties as Record<string, unknown>)[CONFIDENCE_PROPERTY_KEY]).toBeUndefined();
  });
});

describe('emptyLog', () => {
  it('is a valid SARIF 2.1.0 log with the producer as tool.driver.name', () => {
    const log = emptyLog('Claude Code', { producerVersion: '2.1', revisionId: 'abc123', branch: 'main' });
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe('Claude Code');
    expect(log.runs[0].tool.driver.version).toBe('2.1');
    expect(log.runs[0].versionControlProvenance).toEqual([{ revisionId: 'abc123', branch: 'main' }]);
    expect(log.runs[0].results).toEqual([]);
  });
});
