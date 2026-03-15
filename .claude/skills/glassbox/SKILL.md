---
name: glassbox
description: Read the latest Glassbox code review and apply all feedback annotations
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
<!-- glassbox-skill-version: 1 -->

Read `.glassbox/latest-review.md` and apply the feedback.

For each annotation, follow the instruction type:

1. **bug** and **fix** — These indicate code that needs to be changed. Apply the suggested fixes.
2. **style** — These indicate stylistic preferences. Apply them to the indicated lines and similar patterns nearby.
3. **pattern-follow** — These highlight good patterns. Continue using these patterns in new code.
4. **pattern-avoid** — These highlight anti-patterns. Refactor the indicated code and avoid the pattern elsewhere.
5. **remember** — These are rules/preferences to persist. Update the project's AI configuration file (e.g., CLAUDE.md) with these.
6. **note** — These are informational context. Consider them but they may not require code changes.

Work through all annotated files methodically. For each file, read the source code first, then apply the feedback.
