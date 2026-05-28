# 12. Demo Mode

Requirements for the built-in demonstration scenarios.

## Functional Requirements

### 12.1 Demo Scenarios

- The system shall support pre-configured demo scenarios invoked via `--demo:N` (where N is the scenario ID).
- Six demo scenarios shall be available:
  1. Main UI with guided review notes
  2. Risk mode with inline risk notes
  3. Narrative mode with walkthrough notes
  4. Annotations with different categories
  5. Settings dialog with guided review
  6. Direct comparison (`--diff`) of two folders — a fabricated direct-comparison review whose `mode` is `diff:[…]` and whose `repo_name` is an `"A ↔ B"` label, so a screenshot captures the `compare: A ↔ B` sidebar label and the no-git-history layout (doc 18). The diff payloads are the standard shared demo files.
- Invalid demo scenario IDs shall produce an error listing available scenarios.
- The shared demo file set shall include representative diff kinds: text diffs, a large single-line minified SVG (the GB-821 truncation guard), and a binary **image diff** (so the metadata / difference / slice image-comparison modes are exercisable). The image diff is modeled as a rename between two real repo images; since demo mode resolves to "uncommitted" (or, for scenario 6, the direct-comparison branch), the old/new bytes are read from git HEAD and the working tree.

### 12.2 Demo Isolation

- Demo mode shall bypass git repository detection (no real repo required).
- Demo mode shall bypass instance locking (multiple demos can run simultaneously).
- Demo data shall be self-contained and not affect real review data.

## Non-Functional Requirements

### 12.3 Purpose

- Demo mode shall serve as a way to showcase application features without requiring a real git repository or code changes.
