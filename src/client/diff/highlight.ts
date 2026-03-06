import hljs from 'highlight.js';

import { state } from '../state.js';

const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.rb': 'ruby', '.rake': 'ruby', '.gemspec': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.scala': 'scala',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.m': 'objectivec', '.mm': 'objectivec',
  '.php': 'php',
  '.r': 'r',
  '.lua': 'lua',
  '.pl': 'perl', '.pm': 'perl',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.css': 'css',
  '.scss': 'scss', '.sass': 'scss',
  '.less': 'less',
  '.html': 'xml', '.htm': 'xml', '.xhtml': 'xml',
  '.xml': 'xml', '.svg': 'xml', '.xsl': 'xml',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'ini', '.ini': 'ini', '.cfg': 'ini',
  '.md': 'markdown', '.mdx': 'markdown',
  '.sql': 'sql',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.dockerfile': 'dockerfile',
  '.tf': 'hcl', '.hcl': 'hcl',
  '.proto': 'protobuf',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure', '.cljs': 'clojure',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.zig': 'zig',
  '.nim': 'nim',
  '.dart': 'dart',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.cmake': 'cmake',
  '.diff': 'diff', '.patch': 'diff',
  '.nginx': 'nginx',
  '.vim': 'vim',
};

const FILENAME_TO_LANG: Record<string, string> = {
  'Makefile': 'makefile', 'makefile': 'makefile', 'GNUmakefile': 'makefile',
  'Dockerfile': 'dockerfile',
  'Jenkinsfile': 'groovy',
  'Vagrantfile': 'ruby',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  '.gitignore': 'plaintext',
  '.env': 'bash',
  '.bashrc': 'bash', '.zshrc': 'bash', '.bash_profile': 'bash',
};

export function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? '';
  if (fileName in FILENAME_TO_LANG) return FILENAME_TO_LANG[fileName];
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = fileName.substring(dotIdx).toLowerCase();
    if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
  }
  return 'plaintext';
}

export function getLanguageList(): string[] {
  return hljs.listLanguages().sort();
}

export function applyHighlighting() {
  const lang = state.highlightLang;
  if (!lang || lang === 'plaintext') {
    clearHighlighting();
    return;
  }

  const container = document.getElementById('diff-container');
  if (!container) return;

  container.querySelectorAll('.code').forEach(el => {
    const codeEl = el as HTMLElement;
    // Get raw text (strips any existing highlight spans)
    const text = codeEl.textContent || '';
    if (!text.trim()) return;

    try {
      const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
      codeEl.innerHTML = result.value;
    } catch {
      // Language not registered or error — leave as-is
    }
  });
}

function clearHighlighting() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  container.querySelectorAll('.code').forEach(el => {
    const codeEl = el as HTMLElement;
    const text = codeEl.textContent || '';
    codeEl.textContent = text;
  });
}
