import { readFileSync } from 'fs';
import { join } from 'path';

const EVENTS_SRC = join(__dirname, '..', '..', '..', 'src', 'client', 'annotations', 'events.tsx');

// GB-796 regression guard. The earlier shape of this delegate was
// `'.annotation-form-container[data-edit-for] .form-category-badge'`,
// which only matched the *edit* form — so opening the *create* form
// (which uses `[data-form-key]`), clicking the category badge, did
// nothing. Both forms render the same `.form-category-badge` and the
// shared picker (`showCategoryPickerForBadge`) writes back through
// `editFormSignal` either way, so the selector should not constrain
// the wrapper attribute. If a future edit narrows the selector back
// to a single form variant, this test fails to flag it.
describe('GB-796: form category badge delegate matches both form types', () => {
  it('events.tsx delegate selector covers create + edit forms', () => {
    const src = readFileSync(EVENTS_SRC, 'utf-8');

    // Find each `delegate(...)` call that mentions `.form-category-badge`.
    // The delegate signature is `delegate(root, eventName, selector, handler)`,
    // and the call spans multiple lines, so we walk balanced parens rather
    // than relying on a single-line regex.
    const calls: string[] = [];
    const starts = [...src.matchAll(/delegate\s*\(/g)].map(m => m.index!);
    for (const start of starts) {
      let depth = 0;
      let i = start;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      const call = src.slice(start, i);
      if (call.includes('form-category-badge')) calls.push(call);
    }

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const selector = [...call.matchAll(/'([^']*\.form-category-badge[^']*)'/g)][0]?.[1];
      expect(selector).toBeDefined();
      // Must NOT pin the wrapper to a single form variant.
      expect(selector).not.toMatch(/\[data-edit-for\]\s+\.form-category-badge/);
      expect(selector).not.toMatch(/\[data-form-key\]\s+\.form-category-badge/);
      // Sanity — still scoped under the form container.
      expect(selector).toMatch(/\.annotation-form-container.*\.form-category-badge/);
    }
  });
});
