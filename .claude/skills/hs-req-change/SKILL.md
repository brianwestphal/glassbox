---
name: hs-req-change
description: Create a new requirement change ticket in Hot Sheet
allowed-tools: Bash
---
<!-- hotsheet-skill-version: 1 port: 4176 -->

Create a new Hot Sheet **requirement change** ticket. Changes to existing requirements.

**Parsing the input:**
- If the input starts with "next", "up next", or "do next" (case-insensitive), set `up_next` to `true` and use the remaining text as the title
- Otherwise, use the entire input as the title

**Create the ticket** by running:
```bash
curl -s -X POST http://localhost:4176/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"title": "<TITLE>", "defaults": {"category": "requirement_change", "up_next": <true|false>}}'
```

Report the created ticket number and title to the user.
