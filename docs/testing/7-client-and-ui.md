# 7. Client and UI

Test coverage for the JSX runtime, client-side modules, and browser interactions.

Client tests should use a DOM environment (jsdom or happy-dom via Vitest) for testing DOM manipulation and event handling. The JSX runtime can be tested in a plain Node environment since it produces strings.

## Unit Tests

### JSX Runtime (`src/jsx-runtime.ts`)

The custom JSX runtime is shared between server and client. It renders JSX to HTML strings via the `SafeHtml` class. This is a high-value, low-effort test target.

- **Simple element** — `<div>hello</div>` produces `<div>hello</div>`.
- **String escaping** — `<p>{"<script>alert(1)</script>"}</p>` escapes the angle brackets and quotes.
- **Attribute rendering** — `<input type="text" disabled />` produces correct attribute syntax.
- **className mapping** — `<div className="foo">` produces `<div class="foo">`.
- **htmlFor mapping** — `<label htmlFor="bar">` produces `<label for="bar">`.
- **Boolean attributes** — `<input disabled />` produces `disabled` without a value. `<input disabled={false} />` omits the attribute.
- **Void tags** — `<br />`, `<img />`, `<input />` render as self-closing without a closing tag.
- **Fragments** — `<><span>a</span><span>b</span></>` renders both children without a wrapper element.
- **Nested children** — Deeply nested elements render correctly with proper nesting.
- **Null/undefined children** — `<div>{null}{undefined}</div>` produces `<div></div>` (children are skipped).
- **Array children** — `<ul>{items.map(i => <li>{i}</li>)}</ul>` renders all items.
- **`raw()` helper** — `raw('<b>bold</b>')` injects the HTML string without escaping.
- **SafeHtml toString** — `.toString()` returns the HTML string for use with `innerHTML`.

### HTML Escaping (`src/utils/escapeHtml.ts`)

- **Ampersand** — `&` becomes `&amp;`.
- **Less than** — `<` becomes `&lt;`.
- **Greater than** — `>` becomes `&gt;`.
- **Double quote** — `"` becomes `&quot;`.
- **Single quote** — `'` becomes `&#x27;`.
- **Mixed** — A string with all special characters is fully escaped.
- **No special chars** — A plain string is returned unchanged.
- **Empty string** — Returns empty string.
- **Already escaped** — `&amp;` is not double-escaped (this depends on the implementation — verify the actual behavior).

### Outline Parser (`src/outline/parser.ts`)

The outline parser extracts code symbols (functions, classes, methods) from source files. It supports 16+ languages.

- **JavaScript/TypeScript functions** — `function foo() {}`, `const foo = () => {}`, `export function bar()`.
- **JavaScript/TypeScript classes** — `class Foo {}`, `class Foo extends Bar {}`.
- **Class methods** — Methods inside class bodies, including `constructor`, `get`/`set` accessors.
- **Python functions and classes** — `def foo():`, `class Foo:`, `async def bar():`.
- **Go functions** — `func foo()`, `func (r *Receiver) Method()`.
- **Rust functions** — `fn foo()`, `pub fn bar()`, `impl Struct { fn method() }`.
- **Nested symbols** — Methods inside classes should be reported as children with correct indentation/nesting.
- **Line range accuracy** — Start and end line numbers should correctly span the symbol's body.
- **Brace depth tracking** — ✅ Verify that braces inside strings, comments, and template literals don't confuse the parser. Template literal `${}` interpolations with nested braces are covered.
- **Unsupported languages** — Files with unknown extensions return an empty symbol list.
- **Empty files** — Returns empty symbol list.

### DOM Helper (`src/client/dom.ts`)

- **`toElement` basic** — `toElement(<div className="test">text</div>)` produces a `div` DOM element with class `test` and text content.
- **`toElement` with children** — Nested elements produce the correct DOM tree.
- **`toElement` returns single element** — The JSX expression must have a single root; verify the return type is a single `HTMLElement`.

## Integration Tests

### Sidebar Behavior

These require a DOM environment with the sidebar HTML structure mounted.

- **File tree rendering** — Given a list of files, verify the folder tree is rendered with correct nesting and file names.
- **File filter** — Typing in the filter input hides non-matching files and shows matching ones.
- **Sort mode switching** — Clicking the risk/narrative/folder segments updates the file list rendering.
- **Annotation count badges** — After loading files with annotation counts, verify badges show correct numbers.
- **Keyboard navigation** — Simulating `j` and `k` key presses moves the selection indicator through the file list.

### Diff Viewer

- **Split mode rendering** — Verify split view shows old and new columns side by side with correct line numbers.
- **Unified mode rendering** — Verify unified view shows a single column with +/- prefixed lines.
- **Mode toggle** — Switching between split and unified updates the diff display.
- **Wrap toggle** — Enabling line wrap applies the correct CSS class.
- **Context expansion** — Clicking the expand button fetches additional lines and inserts them into the diff.

### Annotation Interactions

- **Click to create** — Clicking a diff line opens the annotation form at the correct position.
- **Form submission** — Filling in content and submitting creates an annotation via the API and renders it inline.
- **Category selection** — Clicking the category badge opens the picker; selecting a category updates the annotation.
- **Edit mode** — Double-clicking or clicking edit opens the content for editing.
- **Delete** — Clicking delete removes the annotation from the DOM and calls the delete API.
- **Drag and drop** — Dragging an annotation to a new line calls the move API and re-renders at the new position.
- **Cmd/Ctrl+Enter** — Verify the keyboard shortcut submits the annotation form.
- **Escape** — Verify Escape closes the annotation form without saving.

### Settings Dialog

- **Render** — Opening the settings dialog shows platform, model, and key configuration.
- **Platform switching** — Clicking a platform segment updates the model dropdown and key status display.
- **Key save** — Entering a key and clicking Save calls the key save API.
- **Guided review toggle** — Checking/unchecking the guided review checkbox shows/hides the topic selection.
- **Topic tag toggle** — Clicking a language tag toggles its selection state.
- **Programming auto-select** — Selecting "Programming" with no languages selected auto-selects all languages.
- **Tauri sections** — When `window.__TAURI__` exists, the Desktop App section (app name, updates) is visible. When absent, it is hidden.
- **Cancel** — Clicking Cancel closes the dialog without saving.
- **Click outside** — Clicking the overlay closes the dialog.

### Review Completion Modal

- **Open modal** — Clicking "Complete Review" shows the confirmation dialog.
- **Confirm completion** — Clicking confirm calls the complete API and shows the gitignore prompt.
- **Gitignore prompt** — When `.glassbox/` is not ignored, the prompt offers to add it.
- **Dismiss prompt** — Dismissing the prompt calls the dismiss API.

## Edge Cases

- **XSS prevention** — Annotation content containing `<script>` tags is rendered as escaped text, not executable HTML.
- **Long file paths** — Very long paths in the sidebar truncate gracefully without breaking layout.
- **Empty file list** — A review with no files shows an appropriate empty state.
- **Rapid clicks** — Double-clicking the Complete Review button doesn't trigger duplicate completions.
- **Stale annotation display** — Stale annotations render with the visual strikethrough indicator and show keep/delete actions.
