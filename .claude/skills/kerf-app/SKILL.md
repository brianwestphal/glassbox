---
name: kerf-app
description: Build UIs in the kerf reactive framework (https://github.com/brianwestphal/kerf). Use this skill whenever the user is writing or modifying code that imports `kerfjs`, asks to add a feature to a kerf app, or asks "how do I do X in kerf?". Use it proactively the moment you spot a kerf import in the file you're editing.
kerf-skill-version: 1.8.0
---

# Building apps with kerf

> Drop this file into your `~/.claude/skills/kerf-app/SKILL.md` (or your
> project's `.claude/skills/kerf-app/SKILL.md`) so Claude Code activates
> it whenever you work on a kerf app.

kerf is a ~11 KB reactive UI framework (~12 KB with `arraySignal`): signals + DOM morphing + JSX → HTML strings. No virtual DOM, no compiler, no scheduler. The whole public surface fits in 15 exports.

## Setup

- Install: `npm install kerfjs`
- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "kerfjs"`
- Vite / esbuild need no extra config.
- Recommended companion: `npm install --save-dev eslint-plugin-kerfjs` and add `kerfjs.configs.recommended` to the project's eslint config. Enforces five of the hard rules below (no inline JSX event handlers, require `data-key` in `each()`, capture `delegate()` disposers, no nested `mount()`, prefer module JSX augmentation) at edit time — useful as a self-correction signal when authoring kerf code.

## Public API — one import path

```ts
import {
  signal, computed, effect, batch,    // reactivity
  defineStore, resetAllStores,        // stores
  mount, morph, each,                 // render (reactive + one-shot) + keyed list
  delegate, delegateCapture,          // events
  toElement,                          // direct JSX → DOM Element (or DocumentFragment for multi-root)
  SafeHtml, isSafeHtml, raw, Fragment,
} from 'kerfjs';

// Optional, only when you need granular collection updates:
import { arraySignal } from 'kerfjs/array-signal';
```

| Export | Use |
| --- | --- |
| `signal(initial)` | atomic reactive state; `.value` get/set |
| `computed(fn)` | derived value, read-only |
| `effect(fn)` | side effect on signal change; returns disposer |
| `batch(fn)` | coalesce multiple writes into one re-run |
| `defineStore({initial, actions})` | named multi-consumer state |
| `resetAllStores()` | reset every store (test teardown) |
| `mount(el, render)` | bind reactive render to a DOM element; returns disposer |
| `morph(liveRoot, template)` | one-shot reconcile against a populated element (SSR hydration, page-refresh diffs). Template = `Element`, `SafeHtml`, or HTML string |
| `each(items, render, cacheKey?)` | keyed list iteration; per-row memoization on identity (+ optional cacheKey — a passive comparator for external state). Distinct from `data-key` on the rendered element |
| `delegate(root, type, sel, h)` | one listener at the root; `closest(selector)` walk from target |
| `delegateCapture(root, type, sel, h, opts?)` | capture-phase escape hatch; `closest()` walk-up by default (same as `delegate`); pass `{ match: 'direct' }` for strict `target.matches()` |
| `attr(name, value)` | pre-computed `AttrSpec<N,V>` — `.selector` for `delegate()`, `.attrs` to spread into JSX (rename-safe) |
| `attr(name)` | dynamic factory — `attr<N,V=string>(name)` returns `(value: V) => { readonly [name]: V }`; both generics off → N inferred, V defaults to string; specify both to constrain values |
| `toElement(jsx)` | parse JSX into a DOM node (SVG-aware). Single-root → `Element`; multi-root (`<><svg/> label</>`, two icons side by side) → `DocumentFragment` that `appendChild`/`replaceChildren`/`append` inlines into the parent. |
| `raw(html)` | inject pre-escaped HTML |
| `arraySignal(initial?)` | granular keyed-list signal (subpath `kerfjs/array-signal`); `each()` reconciles in O(patches) |
| `` html`…` `` | tagged template (subpath `kerfjs/html`) — JSX-identical runtime semantics with NO build step, for CDN/importmap projects. Real HTML attribute names (`class`, not `className`); holes only in text positions or as a COMPLETE attribute value (`attr=${v}` / `attr="${v}"`) |

## Hard rules — every AI assistant gets these wrong at least once

1. **JSX renders to HTML strings, not DOM nodes.** Don't pass DOM nodes as JSX children — the runtime throws. Need a ref? Build the JSX, then `querySelector` after `mount()` / `toElement()`.
2. **Diff keys: `id` first, then `data-key`.** Lists MUST set `data-key={item.id}` per item — otherwise the diff matches by position and you lose focus, cursor, and identity on insert/delete.
3. **Three escape hatches for the morph:**
   - `data-morph-skip` — element AND subtree preserved verbatim. For library-owned hosts (Monaco, xterm, D3).
   - `data-morph-skip-children` — attrs on the host morph, subtree preserved. For client-hydrated slots whose loading/state classes need to flow through.
   - `data-morph-preserve` — element survives the trailing-removal pass even when the new template doesn't emit it. For imperatively-injected children (autoplay video, tooltip overlay, analytics pixel). Does NOT block a keyed-match move.
4. **Never `addEventListener` inside a `mount()`-managed tree** unless under `data-morph-skip`. A morph re-render may discard the node. Use `delegate` / `delegateCapture` instead.
5. **Capture the `delegate()` / `delegateCapture()` disposer** whenever the registration's scope is shorter than the page. Both helpers return `() => void`; the listener closure pins `rootEl`, `handler`, and everything the handler closes over (stores, signals, app state). Discarding the disposer on a transient root (modal, route view, mount swap, dynamic widget) leaks the listener AND the app graph it captures; re-mount cycles stack listeners linearly. `mount()`'s own disposer does NOT remove delegates for you. Safe to discard only when the registration is truly page-lifetime (root is `document.body` or equivalent, attached once at startup, never torn down).
6. **One `mount()` per root.** Don't nest `mount()` calls. Compose with plain functions returning JSX.
7. **Components are plain functions.** `<MyComponent props />` works — the JSX runtime calls `MyComponent(props)` and uses the returned JSX — but there's no hook system, no lifecycle, and no per-instance state. State lives in module-scope signals or stores, never in component closures.
8. **Values bind, structure re-renders.** For a value hole, pass the signal/computed ITSELF (`<span>{count}</span>`, `class={sig}`) — kerf updates that one node directly, no render re-run. Read `.value` only when the JSX *structure* depends on the signal — and then the read must happen INSIDE the render function to be tracked: `const x = count.value; mount(el, () => <span>{x}</span>)` does NOT re-render. One caveat on bound holes: bind a STABLE signal/computed instance per hole (`class={computed(() => …)}` that switches internally), never `class={cond ? sigA : sigB}` — switching instances can go silently stale (detectable via `KERF_DEV_WARN_STALE_BINDING=1`). The idiom's endpoint: a render that reads NO `.value` runs exactly once — a fully bound mount never re-renders. To find `.value` holes worth migrating, `KERF_DEV_WARN_VALUE_ONLY_RERENDER=1` flags re-renders whose only differences were text/attribute values.
9. **Store actions take `(set, get)`, not `(state)`.** `set(next)` replaces state; mutating `get()` does nothing.
10. **Use `data-action` attributes, not inline `onClick`.** Inline handlers are NOT supported by the JSX → string runtime; delegate from the root.
11. **`arraySignal` is opt-in for long keyed lists** where most updates are pointwise. For short lists / filter+sort pipelines, plain `signal` + `each(items.value, ...)` is simpler and equally fast.
12. **Custom-element types: declaration-merge into `kerfjs/jsx-runtime`**, NOT into a global JSX namespace. Pattern: `declare module 'kerfjs/jsx-runtime' { namespace JSX { interface IntrinsicElements { 'my-tag': KerfCustomElement & { foo?: string } } } }`.
13. **Each `each()` row must produce exactly one top-level element.** Multi-root or empty rows throw a row-precise error. Wrap multiple roots in one parent.
14. **`each()` is for DYNAMIC lists. Use `.map()` for static structural arrays** (constant `COLUMNS` / `TABS` / settings sections) whose row render reads signals. `each()` memoizes per-item HTML by object identity; constant items never change identity, so the cache hits forever, the row render is never re-invoked, and signal reads inside it silently stop tracking. Outer `.map()` for the static frame + inner `each()` for the dynamic sub-list is the idiomatic shape.

## Decision-making axes

When deciding which primitive to reach for, work down the axes:

**Events.**
- Originates inside the mount tree → `delegate(rootEl, type, sel, handler)`. Originates outside (window-level keyboard, online/offline, beforeunload) → native `window.addEventListener` at module top-level.
- Gesture that needs to follow an element after press (drag, draw, resize) → at the start event, `el.setPointerCapture(e.pointerId)`. Subsequent `pointermove` / `pointerup` redirect to the captured element and `delegate(rootEl, 'pointermove', '[data-card]', …)` still picks them up. Don't reach for `window.addEventListener` for in-mount-tree gestures.
- Well-known non-bubbler (`focus`, `blur`, `scroll`, `load`, `error`, `mouseenter`, `mouseleave`) → still `delegate()`; it auto-promotes to capture. Custom non-bubblers or capture-phase interception → `delegateCapture()` (also `closest()`-matched by default). Need strict element-match? Add `{ match: 'direct' }` on either helper.

**Lists.**
- Items change across renders (todos, chat messages, table rows) → `each(items, render)`.
- Static structural enumeration whose row render reads signals → `STATIC.map(item => <jsx/>)`. Inner `each(item.children, …)` still gets keyed reconcile.
- Long list with point-wise mutations → `arraySignal` + `each(arraySig, render)` for O(patches) updates.

**Side effects / imperative DOM.**
- Library-owned subtree survives across renders → `data-morph-skip` on host.
- Host attributes morph but subtree preserved → `data-morph-skip-children`.
- Imperatively-injected element survives the trailing-removal pass → `data-morph-preserve`.
- Focused input / contenteditable caret survives re-renders → automatic; no opt-in.

**Raw HTML.**
- User-controlled HTML → sanitize first (DOMPurify) then `raw(sanitized)`.
- Author-controlled trusted HTML → `raw(html)` directly.

**Dangerous URLs.** `javascript:`/`vbscript:`/script-executing `data:` values on `href`/`src`/`xlink:href`/`formaction`/`action`/`data` are dropped — kerf **throws in dev**, **warns + drops in prod**. Sanitize user URLs upstream; wrap an intentional trusted one in `raw(url)` (bypasses the screen in both modes).

## Canonical patterns

```tsx
// Pattern 1: signal + mount + delegate.
// THE core idiom — values bind, structure re-renders: pass the signal ITSELF
// into a value hole ({count}, class={sig}) so kerf updates that one node
// directly with no render re-run; read `.value` only when the JSX STRUCTURE
// depends on the signal (conditionals, list shape).
const count = signal(0);
const ACTIONS = { inc: attr('data-action', 'inc') } as const satisfies Record<string, AttrSpec<'data-action'>>;

mount(document.getElementById('app')!, () => (
  <div>
    <button {...ACTIONS.inc.attrs}>+</button>
    <span>{count}</span>
  </div>
));
delegate(rootEl, 'click', ACTIONS.inc.selector, () => { count.value += 1; });

// Pattern 2: keyed list with per-row memoization
mount(listEl, () => (
  <ul>
    {each(rows.value, (row) => <li data-key={row.id}>{row.label}</li>)}
  </ul>
));

// Pattern 3: store with reset
const cart = defineStore({
  initial: () => ({ items: [] as string[] }),
  actions: (set, get) => ({
    add:   (id: string) => set({ items: [...get().items, id] }),
    clear: ()           => set({ items: [] }),
  }),
});
// access: cart.state.value.items, cart.actions.add('x'), cart.reset()

// Pattern 4: one-shot reconcile (no signals, no effect)
morph(liveCard, '<article class="card">…</article>');

// Pattern 5: fine-grained binding (opt-in) — pass the signal/computed ITSELF
// into a hole so a change updates ONLY that node (no render re-run, no
// reconcile). For a hot spot driven by an external signal (selection class,
// live status attr) — not everywhere. Use computed(), never a bare () => ….
const selectedId = signal<number | null>(null);
mount(listEl, () => (
  <ul>
    {each(rows.value, (row) => (
      <li class={computed(() => (row.id === selectedId.value ? 'sel' : ''))}>{row.label}</li>
    ), (row) => row.id)}
  </ul>
));
// selectedId.value = 3  → only the ~2 affected <li> class attrs update.

// Pattern 6: no build step (CDN / importmap) — the html tagged template
// instead of JSX. Same runtime semantics; real HTML attribute names; a hole
// must be a text position or a COMPLETE attribute value (partials throw).
import { html } from 'kerfjs/html';
mount(rootEl, () => html`
  <div class="${cls}">Count: ${count}</div>
  <ul>${each(rows.value, (row) => html`<li data-key="${row.id}">${row.label}</li>`)}</ul>
`);
```

## Diagnosing common errors

| Error / symptom | Root cause | Fix |
| --- | --- | --- |
| `JSX: DOM elements cannot be passed as children` | passed a `toElement()` result inside JSX | Build the whole tree in JSX; refs via `querySelector` after rendering |
| Focus / cursor lost on every keystroke | list items lack `data-key` | Add `data-key` (or `id`) to each list item |
| Click handler stops firing after re-render | `el.addEventListener` was used | Replace with `delegate(rootEl, 'click', ACTIONS.foo.selector, ...)` (or a string literal for ad-hoc cases) |
| Render fn never re-runs | signal was read outside the render fn | Move `signal.value` read inside the render fn |
| SVG renders as broken / namespaceless markup | `innerHTML` used directly | Use `mount` or `toElement` (SVG-aware) |
| Library widget destroyed on every render | host reachable by the morph | Wrap host in `data-morph-skip`; mount the library imperatively after first render |
| `<my-tag>` fails to typecheck | declaration merging targeted global JSX | Use `declare module 'kerfjs/jsx-runtime' { namespace JSX { … } }` instead |
| `each(): row render at index N produced K top-level elements` | row returned multiple sibling elements or zero | Wrap them in one parent so the row renders exactly one element |
| Drag/drop / state change has no visible effect; only elements *outside* `each()` update | Used `each(STATIC_ARRAY, …)` whose row render reads signals. Items never change identity → cache hits forever → row render never re-invoked → signal reads stop tracking | Replace outer with `STATIC_ARRAY.map(...)`; keep inner `each()` for the dynamic sub-list. See Hard Rule 14 |
| Row-enter CSS animation no longer replays when only a row's *content* changed (kerf ≥ 0.15.0) | 0.15.0+ morphs a same-identity, same-position row *in place* instead of recreating its node, so a mount-keyed `@keyframes` never re-triggers on a content-only update (≤ 0.14.x recreated the node, so it fired). Intentional flip side: focus, scroll, IME, and in-progress transitions now survive | Key the animation on a state-class toggle, not element creation. To force a remount, churn the row's identity (new object ref / `data-key`) so the reconciler replaces the node |
| Want a hot spot to update without re-running the whole render | Fine-grained binding: pass the signal/`computed` ITSELF into the attr/text hole (`class={computed(() => …)}`), not `.value`. Use `computed()` not a bare `() => …` (memoization keeps a shared-signal flip to ~O(changed nodes)). Opt-in per hole. Limit: a bound hole depending on the row's OWN mutated data goes stale on a granular in-place update — use plain interpolation there |
| `` html`` ``: partial attribute values are not supported | In `kerfjs/html` templates a hole must be the COMPLETE attribute value | Build the full string first (`` class="${`a ${b}`}" ``), or bind `class="${computed(() => `a ${b.value}`)}"` for a reactive one |

## Workflow guidance

When the user asks you to add a feature to a kerf app:

1. **Check what state already exists.** Is there a signal / store you should reuse? Don't create a new one for derived data — use `computed`.
2. **Decide where state lives.** Module-scope signal for ephemeral UI state; `defineStore` for state shared across mounts or that needs `reset()` for tests.
3. **Decide who fires the action.** A handler on a DOM event → `delegate` with a `data-action` attribute. A signal change → `effect()`.
4. **Render output is JSX returning `SafeHtml`.** No JSX-as-DOM-node, no inline handlers. Lists get `data-key`.
5. **Test with `kerfjs/testing`'s `clearStoreRegistry()`** between unit tests if you used `defineStore`.

When you spot user code that violates any of the hard rules above, fix it inline AND explain the rule briefly so the user learns the pattern.

## Server / SSR

`SafeHtml.toString()` returns the HTML string. JSX works in Node with no DOM. `mount`, `morph`, `delegate`, `toElement` all require a DOM and run client-side.

## Where to look next

- API reference: <https://brianwestphal.github.io/kerf/api/>
- Full AI guide: <https://github.com/brianwestphal/kerf/blob/main/docs/ai/usage-guide.md>
- llms.txt index: <https://github.com/brianwestphal/kerf/blob/main/llms.txt>
- Example apps: <https://brianwestphal.github.io/kerf/examples/>

<!-- KERF-APP-CANONICAL-END · your customizations below -->
