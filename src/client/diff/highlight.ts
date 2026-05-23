import hljs from 'highlight.js';

import { asEl } from '../dom.js';
import { diffViewStore } from '../stores/index.js';

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
  const lang = diffViewStore.state.value.highlightLang;
  if (!lang || lang === 'plaintext') {
    clearHighlighting();
    return;
  }

  const container = document.getElementById('diff-container');
  if (!container) return;

  container.querySelectorAll('.code').forEach(el => {
    const codeEl = asEl(el);
    const charChangeSpans = codeEl.querySelectorAll('.char-change');

    if (charChangeSpans.length === 0) {
      // No char-change spans — highlight the whole thing
      const text = codeEl.textContent || '';
      if (!text.trim()) return;
      try {
        const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        codeEl.innerHTML = result.value;
      } catch { /* leave as-is */ }
    } else {
      // Has char-change spans — highlight each segment individually,
      // using hljs continuation to maintain syntax state across segments.
      const segments: Array<{ text: string; isChange: boolean }> = [];
      for (const child of Array.from(codeEl.childNodes)) {
        if (child instanceof HTMLElement && child.classList.contains('char-change')) {
          segments.push({ text: child.textContent, isChange: true });
        } else {
          segments.push({ text: child.textContent ?? '', isChange: false });
        }
      }
      try {
        let newHtml = '';
        // hljs continuation state — uses internal API not in public types
        let continuation: object | undefined = undefined;
        for (const seg of segments) {
          const opts: Record<string, unknown> = { language: lang, ignoreIllegals: true, continuation };
          const result = hljs.highlight(seg.text, opts as { language: string; ignoreIllegals: boolean });
          continuation = (result as unknown as { top?: object }).top;
          if (seg.isChange) {
            newHtml += `<span class="char-change">${result.value}</span>`;
          } else {
            newHtml += result.value;
          }
        }
        codeEl.innerHTML = newHtml;
      } catch { /* leave as-is */ }
    }
  });
}

function clearHighlighting() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  container.querySelectorAll('.code').forEach(el => {
    const codeEl = asEl(el);
    // Preserve char-change spans when clearing
    const charChangeSpans = codeEl.querySelectorAll('.char-change');
    if (charChangeSpans.length === 0) {
      codeEl.textContent = codeEl.textContent || '';
    } else {
      // Strip highlight spans but keep char-change structure
      const segments: Array<{ text: string; isChange: boolean }> = [];
      for (const child of Array.from(codeEl.childNodes)) {
        if (child instanceof HTMLElement && child.classList.contains('char-change')) {
          segments.push({ text: child.textContent, isChange: true });
        } else {
          segments.push({ text: child.textContent ?? '', isChange: false });
        }
      }
      codeEl.innerHTML = segments.map(s =>
        s.isChange ? `<span class="char-change">${escapeForHtml(s.text)}</span>` : escapeForHtml(s.text)
      ).join('');
    }
  });
}

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

