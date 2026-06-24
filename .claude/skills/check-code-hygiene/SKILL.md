---
name: check-code-hygiene
description: Check code for standardization, readability, maintenance complexity, and defensive coding
allowed-tools: Read, Grep, Glob, Bash, Agent
---

Analyze the codebase for code hygiene issues. Generate a report highlighting problems with standardization, human readability, maintenance complexity, and defensive coding.

## Process

1. **Read CLAUDE.md** to understand the project's documented conventions and architecture.

2. **Scan the source code** (`src/`) for these categories of issues:

### Standardization
- Inconsistent naming conventions (camelCase vs snake_case, abbreviations)
- Inconsistent patterns for similar operations (e.g., error handling done differently in similar contexts)
- Inconsistent import ordering or module organization
- Mixed paradigms without clear justification

### Human Readability
- Functions that are too long or do too many things (>50 lines of logic)
- Deeply nested code (>3 levels of nesting)
- Unclear variable/function names that require reading the implementation to understand
- Missing or misleading comments on complex logic
- Magic numbers or strings without named constants
- Complex boolean expressions that should be extracted to named variables

### Maintenance Complexity
- Tight coupling between modules that should be independent
- Circular dependencies
- God objects or functions that know too much about other modules
- Duplicated logic that should be shared
- Files that mix multiple unrelated concerns (check against the "one primary export per file" convention in CLAUDE.md)

### Defensive Coding
- Unvalidated external input (API request bodies, query params, file contents)
- Missing error handling on I/O operations (file reads, network calls, database queries)
- Unsafe type assertions (`as any`, `as unknown as T`) that bypass type safety
- Non-null assertions (`!`) on values that could legitimately be null
- Race conditions in async code (missing await, unhandled promise rejections)

3. **Generate the report** organized by category. For each finding:
   - File path and line number(s)
   - Description of the issue
   - Severity: **high** (likely to cause bugs), **medium** (maintenance burden), **low** (style/consistency)
   - Suggested fix (brief)

4. **Summary** at the end with:
   - Total findings by severity
   - Top 5 files that need the most attention
   - Overall assessment

Present the report directly to the user. Focus on genuine issues — don't flag things that are intentional patterns documented in CLAUDE.md.
