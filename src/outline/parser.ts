export interface OutlineSymbol {
  name: string;
  kind: 'class' | 'function';
  line: number;
  endLine: number;
  children: OutlineSymbol[];
}

const BRACE_LANGS = new Set([
  'javascript', 'typescript', 'java', 'go', 'rust', 'c', 'cpp', 'csharp',
  'swift', 'php', 'kotlin', 'scala', 'dart', 'groovy', 'objectivec',
]);

const INDENT_LANGS = new Set(['python', 'ruby']);

const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.mts': 'typescript', '.cts': 'typescript',
  '.java': 'java', '.go': 'go', '.rs': 'rust',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp', '.swift': 'swift', '.php': 'php',
  '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
  '.dart': 'dart', '.groovy': 'groovy', '.gvy': 'groovy',
  '.m': 'objectivec', '.mm': 'objectivec',
  '.py': 'python', '.pyw': 'python',
  '.rb': 'ruby', '.rake': 'ruby',
};

function langFromPath(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return EXT_TO_LANG[filePath.slice(dot).toLowerCase()] || null;
}

export function parseOutline(content: string, filePath: string): OutlineSymbol[] {
  const lang = langFromPath(filePath);
  if (lang === null) return [];
  if (BRACE_LANGS.has(lang)) return parseBraces(content, lang);
  if (INDENT_LANGS.has(lang)) return parseIndent(content, lang);
  return [];
}

// --- Brace-based parser (C-family languages) ---

// Patterns to detect class-like declarations (shared across languages)
const CLASS_PATTERNS = [
  /^(?:export\s+)?(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|sealed\s+|final\s+)*(?:class|struct|enum|interface|trait|impl|namespace)\s+(\w+)/,
];

// Language-specific function patterns
// For JS/TS: only match explicit `function` keyword, arrow assignments, or methods inside classes
const JS_TS_FUNC_PATTERNS = [
  // function name(, async function name(, export function name(
  /^(?:export\s+)?(?:export\s+default\s+)?(?:async\s+)?function\s*\*?\s+(\w+)/,
  // Arrow function assigned to const/let/var: const name = (...) => or const name = async (
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+\s*)?=>/,
];

// Method patterns only apply inside a class (braceDepth > 0 with a class parent)
const JS_TS_METHOD_PATTERNS = [
  // Method: [modifiers] name( — but require at least one modifier OR that we're in a class
  /^(?:(?:public|private|protected|static|async|override|abstract|readonly|get|set)\s+)+(\w+)\s*(?:<[^>]*>)?\s*\(/,
  // Plain method name( inside class body — no modifiers needed
  /^(\w+)\s*(?:<[^>]*>)?\s*\(/,
];

const GO_FUNC_PATTERNS = [
  /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*(?:\[.*?\])?\s*\(/,
];

const RUST_FUNC_PATTERNS = [
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
];

const SWIFT_FUNC_PATTERNS = [
  /^(?:public\s+|private\s+|internal\s+|open\s+|static\s+|class\s+|override\s+|@\w+\s+)*func\s+(\w+)/,
];

// Java/C#/Kotlin/Scala/Dart/Groovy: require a return type before the name
const TYPED_FUNC_PATTERNS = [
  /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|override\s+|virtual\s+|inline\s+|suspend\s+|open\s+)*(?:\w+(?:<[^>]*>)?(?:\[\])*\s+)+(\w+)\s*(?:<[^>]*>)?\s*\(/,
];

const PHP_FUNC_PATTERNS = [
  /^(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+)*function\s+(\w+)/,
];

function getFuncPatterns(lang: string): { top: RegExp[]; method: RegExp[] } {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return { top: JS_TS_FUNC_PATTERNS, method: JS_TS_METHOD_PATTERNS };
    case 'go':
      return { top: GO_FUNC_PATTERNS, method: [] };
    case 'rust':
      return { top: RUST_FUNC_PATTERNS, method: RUST_FUNC_PATTERNS };
    case 'swift':
      return { top: SWIFT_FUNC_PATTERNS, method: SWIFT_FUNC_PATTERNS };
    case 'php':
      return { top: PHP_FUNC_PATTERNS, method: PHP_FUNC_PATTERNS };
    case 'c':
    case 'cpp':
    case 'objectivec':
      return { top: TYPED_FUNC_PATTERNS, method: TYPED_FUNC_PATTERNS };
    default: // java, csharp, kotlin, scala, dart, groovy
      return { top: TYPED_FUNC_PATTERNS, method: TYPED_FUNC_PATTERNS };
  }
}

// Names that are not actual functions
const SKIP_NAMES = new Set([
  'if', 'else', 'for', 'while', 'switch', 'catch', 'return', 'throw',
  'new', 'delete', 'typeof', 'instanceof', 'void', 'import', 'export',
  'from', 'require', 'case', 'default', 'break', 'continue', 'do',
  'try', 'finally', 'with', 'yield', 'await', 'super', 'this',
]);

function parseBraces(content: string, lang: string): OutlineSymbol[] {
  const lines = content.split('\n');
  const root: OutlineSymbol[] = [];
  const stack: { symbol: OutlineSymbol; depth: number }[] = [];
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';
  let inBlockComment = false;
  let inTemplateLiteral = false;

  const { top: topFuncPatterns, method: methodFuncPatterns } = getFuncPatterns(lang);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const lineNum = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Try to match a symbol declaration on this line
    const currentDepth = braceDepth;
    let matched = false;

    // Method patterns only apply when the immediate parent symbol is a class
    const directParent = stack.length > 0 ? stack[stack.length - 1].symbol : null;
    const insideClass = directParent?.kind === 'class';

    // Check class patterns first (higher priority)
    if (!inBlockComment) {
      for (const pat of CLASS_PATTERNS) {
        const m = trimmed.match(pat);
        if (m && m[1]) {
          const sym: OutlineSymbol = { name: m[1], kind: 'class', line: lineNum, endLine: lineNum, children: [] };
          pushSymbol(root, stack, sym, currentDepth);
          matched = true;
          break;
        }
      }

      // Check function patterns — use top-level patterns always, method patterns only inside classes
      if (!matched) {
        const patterns = insideClass ? [...topFuncPatterns, ...methodFuncPatterns] : topFuncPatterns;
        for (const pat of patterns) {
          const m = trimmed.match(pat);
          if (m && m[1] && !SKIP_NAMES.has(m[1])) {
            const sym: OutlineSymbol = { name: m[1], kind: 'function', line: lineNum, endLine: lineNum, children: [] };
            pushSymbol(root, stack, sym, currentDepth);
            matched = true;
            break;
          }
        }
      }
    }

    // Track brace depth through the line
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }

      if (inString) {
        if (ch === '\\') { j++; continue; }
        if (ch === stringChar) { inString = false; }
        continue;
      }

      if (inTemplateLiteral) {
        if (ch === '\\') { j++; continue; }
        if (ch === '`') { inTemplateLiteral = false; }
        continue;
      }

      if (ch === '/' && next === '/') { break; }
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
      if (ch === '`' && (lang === 'javascript' || lang === 'typescript')) { inTemplateLiteral = true; continue; }

      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        // Close symbols that end at this depth
        while (stack.length > 0 && stack[stack.length - 1].depth >= braceDepth) {
          const closed = stack.pop();
          if (closed !== undefined) {
            closed.symbol.endLine = lineNum;
          }
        }
      }
    }

  }

  // Close any remaining open symbols
  const lastLine = lines.length;
  for (const item of stack) {
    item.symbol.endLine = lastLine;
  }

  return root;
}

function pushSymbol(root: OutlineSymbol[], stack: { symbol: OutlineSymbol; depth: number }[], sym: OutlineSymbol, depth: number) {
  // Find the parent: the most recent stack item whose depth is less than current
  while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
    stack.pop();
  }

  if (stack.length > 0) {
    stack[stack.length - 1].symbol.children.push(sym);
  } else {
    root.push(sym);
  }

  stack.push({ symbol: sym, depth });
}

// --- Indentation-based parser (Python, Ruby) ---

function parseIndent(content: string, lang: string): OutlineSymbol[] {
  const lines = content.split('\n');
  const root: OutlineSymbol[] = [];
  const stack: { symbol: OutlineSymbol; indent: number }[] = [];

  const classRe = lang === 'python'
    ? /^(\s*)class\s+(\w+)/
    : /^(\s*)(?:class|module)\s+(\w+)/;

  const funcRe = lang === 'python'
    ? /^(\s*)(?:async\s+)?def\s+(\w+)/
    : /^(\s*)def\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let m = line.match(classRe);
    if (m) {
      const indent = m[1].length;
      const sym: OutlineSymbol = { name: m[2], kind: 'class', line: lineNum, endLine: lineNum, children: [] };
      pushIndentSymbol(root, stack, sym, indent, lines, i);
      continue;
    }

    m = line.match(funcRe);
    if (m) {
      const indent = m[1].length;
      const sym: OutlineSymbol = { name: m[2], kind: 'function', line: lineNum, endLine: lineNum, children: [] };
      pushIndentSymbol(root, stack, sym, indent, lines, i);
    }
  }

  return root;
}

function pushIndentSymbol(
  root: OutlineSymbol[],
  stack: { symbol: OutlineSymbol; indent: number }[],
  sym: OutlineSymbol,
  indent: number,
  lines: string[],
  lineIdx: number,
) {
  // Close stack items at same or deeper indent
  while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
    const closed = stack.pop();
    if (closed !== undefined) {
      closed.symbol.endLine = lineIdx; // previous line
    }
  }

  // Calculate endLine by scanning forward for the next line at same or lesser indent
  let endLine = lines.length;
  for (let j = lineIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === '') continue;
    const nextIndent = l.length - l.trimStart().length;
    if (nextIndent <= indent) {
      endLine = j; // line before this one (0-indexed)
      break;
    }
  }
  sym.endLine = endLine;

  if (stack.length > 0) {
    stack[stack.length - 1].symbol.children.push(sym);
  } else {
    root.push(sym);
  }

  stack.push({ symbol: sym, indent });
}
