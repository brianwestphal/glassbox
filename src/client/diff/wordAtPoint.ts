/** Read a complete code identifier, including across highlight elements. */
export function getWordAtPoint(x: number, y: number): string | null {
  // Resolve the click using the WebKit/Blink caret API.
  let node: Node | null = null;
  let offset = 0;

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no cross-browser alternative exists
  const range = document.caretRangeFromPoint(x, y);
  if (range !== null) {
    node = range.startContainer;
    offset = range.startOffset;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const code = node.parentElement?.closest('.code');
  if (!code) return null;

  // Search marks and syntax spans split identifiers into multiple text nodes.
  const prefix = document.createRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(node, offset);
  offset = prefix.toString().length;
  const text = code.textContent;
  if (offset >= text.length) return null;

  // Expand to identifier boundaries
  let start = offset, end = offset;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w$]/.test(text[end])) end++;

  const word = text.slice(start, end);
  // Skip pure numbers and very short words
  if (!word || word.length < 2 || /^\d+$/.test(word)) return null;
  // Skip common keywords
  if (SKIP_WORDS.has(word)) return null;

  return word;
}

const SKIP_WORDS = new Set([
  // JS/TS keywords
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'this', 'super', 'class', 'extends', 'implements',
  'interface', 'enum', 'const', 'let', 'var', 'function', 'async', 'await',
  'import', 'export', 'from', 'default', 'true', 'false', 'null', 'undefined',
  'in', 'of', 'as', 'is', 'type', 'declare', 'module', 'namespace',
  // Common types
  'string', 'number', 'boolean', 'object', 'any', 'unknown', 'never',
  'int', 'float', 'double', 'char', 'bool', 'void',
  // Python
  'def', 'self', 'cls', 'None', 'True', 'False', 'and', 'or', 'not',
  'with', 'pass', 'raise', 'yield', 'lambda', 'print',
  // Go
  'func', 'package', 'defer', 'go', 'chan', 'select', 'range',
  'map', 'make', 'append', 'len', 'cap', 'nil', 'err',
  // Rust
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'impl', 'trait', 'where',
  'match', 'Some', 'None', 'Ok', 'Err', 'Self',
]);
