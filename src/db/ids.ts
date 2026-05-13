/** Generate a short, opaque, sortable-ish ID. Used for every row that
 *  needs a primary key (reviews, files, annotations, AI analyses).
 *  Format: `<base36 ms timestamp><8 random base36 chars>`. Single source of
 *  truth — was previously duplicated verbatim in `queries.ts` and
 *  `ai-queries.ts`. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
