---
name: hs-requirement-change
description: Create a new req change ticket in Hot Sheet
allowed-tools: Bash
---
<!-- hotsheet-skill-version: 20 -->

Create a new Hot Sheet **req change** ticket. Changes to existing requirements.

**Parsing the input:**
- If the input starts with "next", "up next", or "do next" (case-insensitive), set `up_next` to `true` and use the remaining text as the title
- Otherwise, use the entire input as the title

**Create the ticket — MCP tool (preferred when the channel is connected):**
Call the `hotsheet_create_ticket` tool with `{ "title": "<TITLE>", "category": "requirement_change", "up_next": <true|false> }`. The tool is schema-validated and routes to the channel server's `--data-dir` so there's no chance of cross-project misrouting.

**Fallback (curl):**
```bash
curl -s -X POST http://localhost:4174/api/tickets \
  -H "Content-Type: application/json" \
  -H "X-Hotsheet-Secret: 23780cba3d23d4980a569de5b0af0bd2" \
  -d '{"title": "<TITLE>", "defaults": {"category": "requirement_change", "up_next": <true|false>}}'
```

If the request fails (connection refused or 403), re-read `.hotsheet/settings.json` for the current `port` and `secret` values — you may be connecting to the wrong Hot Sheet instance.

Report the created ticket number and title to the user.
