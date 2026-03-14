import { describe, it, expect } from 'vitest';
import { parseOutline } from '../../../src/outline/parser.js';
import type { OutlineSymbol } from '../../../src/outline/parser.js';

describe('parseOutline', () => {

  // --- JavaScript/TypeScript ---

  describe('JavaScript/TypeScript', () => {
    it('parses a simple function declaration', () => {
      const result = parseOutline('function foo() { return 1; }', 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('foo');
      expect(result[0].kind).toBe('function');
      expect(result[0].line).toBe(1);
    });

    it('parses an async function', () => {
      const result = parseOutline('async function bar() { }', 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('bar');
      expect(result[0].kind).toBe('function');
    });

    it('parses an exported function', () => {
      const result = parseOutline('export function baz() { }', 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('baz');
      expect(result[0].kind).toBe('function');
    });

    it('parses an arrow function assigned to const', () => {
      const result = parseOutline('const fn = () => { return 1; }', 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('fn');
      expect(result[0].kind).toBe('function');
    });

    it('parses a class with methods', () => {
      const content = [
        'class MyClass {',
        '  constructor() { }',
        '  method() { }',
        '}',
      ].join('\n');
      const result = parseOutline(content, 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyClass');
      expect(result[0].kind).toBe('class');
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].name).toBe('constructor');
      expect(result[0].children[0].kind).toBe('function');
      expect(result[0].children[1].name).toBe('method');
      expect(result[0].children[1].kind).toBe('function');
    });

    it('nests class inside function as non-top-level', () => {
      const content = [
        'function outer() {',
        '  class Inner {',
        '    run() { }',
        '  }',
        '}',
      ].join('\n');
      const result = parseOutline(content, 'test.ts');

      // Only the outer function should be top-level
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('outer');
      expect(result[0].kind).toBe('function');
      // Inner class should be a child of the function
      const inner = result[0].children.find(c => c.name === 'Inner');
      expect(inner).toBeDefined();
      expect(inner!.kind).toBe('class');
    });
  });

  // --- Python ---

  describe('Python', () => {
    it('parses a simple function', () => {
      const content = 'def foo():\n    pass';
      const result = parseOutline(content, 'test.py');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('foo');
      expect(result[0].kind).toBe('function');
    });

    it('parses a class with methods', () => {
      const content = [
        'class MyClass:',
        '    def __init__(self):',
        '        pass',
        '    def method(self):',
        '        pass',
      ].join('\n');
      const result = parseOutline(content, 'test.py');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyClass');
      expect(result[0].kind).toBe('class');
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].name).toBe('__init__');
      expect(result[0].children[0].kind).toBe('function');
      expect(result[0].children[1].name).toBe('method');
      expect(result[0].children[1].kind).toBe('function');
    });

    it('parses async def', () => {
      const content = 'async def bar():\n    pass';
      const result = parseOutline(content, 'test.py');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('bar');
      expect(result[0].kind).toBe('function');
    });
  });

  // --- Go ---

  describe('Go', () => {
    it('parses a standalone function', () => {
      const content = 'func main() {\n}';
      const result = parseOutline(content, 'test.go');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('main');
      expect(result[0].kind).toBe('function');
    });

    it('parses a method with receiver', () => {
      const content = 'func (s *Server) Start() {\n}';
      const result = parseOutline(content, 'test.go');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Start');
      expect(result[0].kind).toBe('function');
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('returns empty array for unsupported extension', () => {
      const result = parseOutline('some content', 'test.txt');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty content', () => {
      const result = parseOutline('', 'test.ts');
      expect(result).toEqual([]);
    });

    it('does not create symbols for control-flow keywords', () => {
      const content = [
        'function outer() {',
        '  if (true) { }',
        '  for (let i = 0; i < 10; i++) { }',
        '  while (true) { }',
        '  switch (x) { }',
        '}',
      ].join('\n');
      const result = parseOutline(content, 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('outer');
      // None of the control-flow keywords should appear as children
      const childNames = result[0].children.map(c => c.name);
      expect(childNames).not.toContain('if');
      expect(childNames).not.toContain('for');
      expect(childNames).not.toContain('while');
      expect(childNames).not.toContain('switch');
    });

    it('handles strings containing braces without breaking brace tracking', () => {
      const content = [
        'function wrapper() {',
        '  const s = "{ }";',
        '  const t = \'}\';',
        '  return s + t;',
        '}',
      ].join('\n');
      const result = parseOutline(content, 'test.ts');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('wrapper');
      expect(result[0].kind).toBe('function');
      // endLine should be the closing brace line (line 5), not confused by string braces
      expect(result[0].endLine).toBe(5);
    });

    it('handles template literals with ${} interpolations containing braces', () => {
      // Template literal interpolations like `${fn({a: 1})}` contain braces that
      // must not confuse the brace-depth tracker. The parser skips all characters
      // inside backtick strings, so interpolation braces are correctly ignored.
      // Note: braces in TypeScript type annotations (e.g. `opts: { limit: number }`)
      // are not distinguished from body braces by the regex-based parser, which is
      // a known limitation — but template-literal braces themselves are handled correctly.
      const content = [
        'function buildQuery(table: string) {',
        '  return `SELECT * FROM ${table} WHERE id = ${`(${table})`}`;',
        '}',
        '',
        'function other() {',
        '  console.log(`result: ${JSON.stringify({a: 1, b: 2})}`);',
        '}',
      ].join('\n');
      const result = parseOutline(content, 'test.ts');

      // Both functions should be found despite braces inside template literal interpolations
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('buildQuery');
      expect(result[0].kind).toBe('function');
      expect(result[0].line).toBe(1);
      expect(result[0].endLine).toBe(3);
      expect(result[1].name).toBe('other');
      expect(result[1].kind).toBe('function');
      expect(result[1].line).toBe(5);
      expect(result[1].endLine).toBe(7);
    });
  });
});
