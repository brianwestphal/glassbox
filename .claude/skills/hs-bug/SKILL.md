---
name: hs-bug
description: Create a new bug ticket in Hot Sheet
allowed-tools: Bash
---
<!-- hotsheet-skill-version: 2 -->

Create a new Hot Sheet **bug** ticket. Bugs that should be fixed in the codebase.

**Parsing the input:**
- If the input starts with "next", "up next", or "do next" (case-insensitive), set `up_next` to `true` and use the remaining text as the title
- Otherwise, use the entire input as the title

**Create the ticket** by running:
```bash
curl -s -X POST http://localhost:4175/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"title": "<TITLE>", "defaults": {"category": "bug", "up_next": <true|false>}}'
```

Report the created ticket number and title to the user.
