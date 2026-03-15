/**
 * Generates AI tool skills/rules for the user's project so that
 * AI coding tools can apply Glassbox review feedback via a slash command.
 *
 * Follows the same multi-platform pattern as Hot Sheet:
 * - Claude Code:    .claude/skills/glassbox/SKILL.md
 * - Cursor:         .cursor/rules/glassbox.mdc
 * - GitHub Copilot: .github/prompts/glassbox.prompt.md
 * - Windsurf:       .windsurf/rules/glassbox.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const SKILL_VERSION = 1;

// --- Version tracking ---

function versionHeader(): string {
  return `<!-- glassbox-skill-version: ${SKILL_VERSION} -->`;
}

function parseVersionHeader(content: string): number | null {
  const match = content.match(/<!-- glassbox-skill-version: (\d+) -->/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function updateFile(path: string, content: string): boolean {
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8');
    const version = parseVersionHeader(existing);
    if (version !== null && version >= SKILL_VERSION) {
      return false;
    }
  }
  writeFileSync(path, content, 'utf-8');
  return true;
}

// --- Skill content ---

function skillBody(): string {
  return [
    'Read `.glassbox/latest-review.md` and apply the feedback.',
    '',
    'For each annotation, follow the instruction type:',
    '',
    '1. **bug** and **fix** — These indicate code that needs to be changed. Apply the suggested fixes.',
    '2. **style** — These indicate stylistic preferences. Apply them to the indicated lines and similar patterns nearby.',
    '3. **pattern-follow** — These highlight good patterns. Continue using these patterns in new code.',
    '4. **pattern-avoid** — These highlight anti-patterns. Refactor the indicated code and avoid the pattern elsewhere.',
    '5. **remember** — These are rules/preferences to persist. Update the project\'s AI configuration file (e.g., CLAUDE.md) with these.',
    '6. **note** — These are informational context. Consider them but they may not require code changes.',
    '',
    'Work through all annotated files methodically. For each file, read the source code first, then apply the feedback.',
  ].join('\n');
}

// --- Claude Code (.claude/skills/glassbox/SKILL.md) ---

function ensureClaudeSkills(cwd: string): boolean {
  const dir = join(cwd, '.claude', 'skills', 'glassbox');
  mkdirSync(dir, { recursive: true });
  const content = [
    '---',
    'name: glassbox',
    'description: Read the latest Glassbox code review and apply all feedback annotations',
    'allowed-tools: Read, Grep, Glob, Edit, Write, Bash',
    '---',
    versionHeader(),
    '',
    skillBody(),
    '',
  ].join('\n');
  return updateFile(join(dir, 'SKILL.md'), content);
}

// --- Cursor (.cursor/rules/glassbox.mdc) ---

function ensureCursorRules(cwd: string): boolean {
  const rulesDir = join(cwd, '.cursor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  const content = [
    '---',
    'description: Read the latest Glassbox code review and apply all feedback annotations',
    'alwaysApply: false',
    '---',
    versionHeader(),
    '',
    skillBody(),
    '',
  ].join('\n');
  return updateFile(join(rulesDir, 'glassbox.mdc'), content);
}

// --- GitHub Copilot (.github/prompts/glassbox.prompt.md) ---

function ensureCopilotPrompts(cwd: string): boolean {
  const promptsDir = join(cwd, '.github', 'prompts');
  mkdirSync(promptsDir, { recursive: true });
  const content = [
    '---',
    'description: Read the latest Glassbox code review and apply all feedback annotations',
    '---',
    versionHeader(),
    '',
    skillBody(),
    '',
  ].join('\n');
  return updateFile(join(promptsDir, 'glassbox.prompt.md'), content);
}

// --- Windsurf (.windsurf/rules/glassbox.md) ---

function ensureWindsurfRules(cwd: string): boolean {
  const rulesDir = join(cwd, '.windsurf', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  const content = [
    '---',
    'trigger: manual',
    'description: Read the latest Glassbox code review and apply all feedback annotations',
    '---',
    versionHeader(),
    '',
    skillBody(),
    '',
  ].join('\n');
  return updateFile(join(rulesDir, 'glassbox.md'), content);
}

// --- Public API ---

export function ensureSkills(): string[] {
  const cwd = process.cwd();
  const platforms: string[] = [];

  if (existsSync(join(cwd, '.claude'))) {
    if (ensureClaudeSkills(cwd)) platforms.push('Claude Code');
  }

  if (existsSync(join(cwd, '.cursor'))) {
    if (ensureCursorRules(cwd)) platforms.push('Cursor');
  }

  if (existsSync(join(cwd, '.github', 'prompts')) || existsSync(join(cwd, '.github', 'copilot-instructions.md'))) {
    if (ensureCopilotPrompts(cwd)) platforms.push('GitHub Copilot');
  }

  if (existsSync(join(cwd, '.windsurf'))) {
    if (ensureWindsurfRules(cwd)) platforms.push('Windsurf');
  }

  return platforms;
}
