# 12. Demo Mode

Requirements for the built-in demonstration scenarios.

## Functional Requirements

### 12.1 Demo Scenarios

- The system shall support pre-configured demo scenarios invoked via `--demo:N` (where N is the scenario ID).
- Five demo scenarios shall be available:
  1. Main UI with guided review notes
  2. Risk mode with inline risk notes
  3. Narrative mode with walkthrough notes
  4. Annotations with different categories
  5. Settings dialog with guided review
- Invalid demo scenario IDs shall produce an error listing available scenarios.

### 12.2 Demo Isolation

- Demo mode shall bypass git repository detection (no real repo required).
- Demo mode shall bypass instance locking (multiple demos can run simultaneously).
- Demo data shall be self-contained and not affect real review data.

## Non-Functional Requirements

### 12.3 Purpose

- Demo mode shall serve as a way to showcase application features without requiring a real git repository or code changes.
