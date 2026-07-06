/**
 * The in-memory content-plugin registry + dispatcher (doc 29 §29.3). Holds the
 * renderers/differs contributed by every loaded plugin and, for a given
 * file/artifact, picks the best-matching handler by (priority, specificity).
 *
 * Pure and dependency-free (only `path.extname`) so it is unit-testable in
 * isolation from the loader and the filesystem.
 */
import { extname } from 'path';

import type { ContentDiffer, ContentMatch, ContentRenderer, DiffInput, RenderInput } from './types.js';

/**
 * Specificity of a match for tie-breaking: a content sniff (3) is more specific
 * than a MIME match (2), which beats an extension match (1). `0` = no match.
 */
export function matchSpecificity(match: ContentMatch, input: RenderInput): number {
  if (match.sniff && input.bytes.length > 0) {
    try { if (match.sniff(input.bytes)) return 3; } catch { /* a throwing sniff never matches */ }
  }
  if (match.mimeTypes && input.mime !== undefined && match.mimeTypes.includes(input.mime)) return 2;
  const ext = extname(input.path).toLowerCase();
  if (ext !== '' && match.extensions?.some((e) => e.toLowerCase() === ext) === true) return 1;
  return 0;
}

/** True when `match` handles `input` on any declared axis. */
export function matches(match: ContentMatch, input: RenderInput): boolean {
  return matchSpecificity(match, input) > 0;
}

interface Handler { match: ContentMatch; priority?: number }

/** Highest (priority, specificity) wins; ties resolve to registration order. */
function pickBest<T extends Handler>(handlers: readonly T[], input: RenderInput): T | undefined {
  let best: T | undefined;
  let bestScore = 0;
  for (const h of handlers) {
    const spec = matchSpecificity(h.match, input);
    if (spec === 0) continue;
    const score = (h.priority ?? 0) * 10 + spec;
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best;
}

export class ContentPluginRegistry {
  private renderers: ContentRenderer[] = [];
  private differs: ContentDiffer[] = [];

  addRenderers(rs: ContentRenderer[] | undefined): void { if (rs) this.renderers.push(...rs); }
  addDiffers(ds: ContentDiffer[] | undefined): void { if (ds) this.differs.push(...ds); }

  /** The best-matching renderer for a single content blob, or undefined. */
  findRenderer(input: RenderInput): ContentRenderer | undefined {
    return pickBest(this.renderers, input);
  }

  /** The best-matching differ for a pair; matching keys off the new side. */
  findDiffer(input: DiffInput): ContentDiffer | undefined {
    return pickBest(this.differs, input.new);
  }

  get rendererCount(): number { return this.renderers.length; }
  get differCount(): number { return this.differs.length; }
}
