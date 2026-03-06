import { api } from '../api.js';
import { toElement } from '../dom.js';

interface OutlineSymbol {
  name: string;
  kind: 'class' | 'function';
  line: number;
  endLine: number;
  children: OutlineSymbol[];
}

interface OutlineContainer extends HTMLElement {
  _outlineScrollHandler?: () => void;
}

let currentSymbols: OutlineSymbol[] = [];
let scrollRafId = 0;

export async function loadOutline(fileId: string) {
  currentSymbols = [];

  // Remove any existing outline bar
  document.querySelectorAll('.outline-bar').forEach(el => { el.remove(); });

  try {
    const data = await api<{ symbols: OutlineSymbol[] }>('/outline/' + fileId);
    if (data.symbols.length === 0) return;
    currentSymbols = data.symbols;
  } catch {
    return;
  }

  // Inject outline bar after the diff-header inside diff-container
  const container = document.getElementById('diff-container');
  const header = container?.querySelector('.diff-header');
  if (header === undefined || header === null) return;

  const bar = toElement(<div className="outline-bar" id="outline-bar"></div>);
  header.after(bar);

  updateBreadcrumb();
  bindScrollTracking();
}

function findSymbolPath(symbols: OutlineSymbol[], line: number): OutlineSymbol[] {
  for (const s of symbols) {
    if (line >= s.line && line <= s.endLine) {
      const childPath = findSymbolPath(s.children, line);
      return [s, ...childPath];
    }
  }
  return [];
}

function getTopVisibleLine(): number | null {
  const container = document.getElementById('diff-container');
  if (container === null) return null;

  const lines = container.querySelectorAll('.diff-line[data-line]');
  const containerRect = container.getBoundingClientRect();
  const headerEl = container.querySelector<HTMLElement>('.diff-header');
  const headerHeight = headerEl?.offsetHeight ?? 0;
  const outlineBar = container.querySelector('.outline-bar');
  const outlineHeight = (outlineBar as HTMLElement | null)?.offsetHeight ?? 0;
  const topOffset = containerRect.top + headerHeight + outlineHeight;

  for (const el of lines) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > topOffset && rect.top < containerRect.bottom) {
      const lineNum = parseInt((el as HTMLElement).dataset.line ?? '0', 10);
      if (lineNum > 0) return lineNum;
    }
  }
  return null;
}

function updateBreadcrumb() {
  const bar = document.getElementById('outline-bar');
  if (bar === null || currentSymbols.length === 0) return;

  const line = getTopVisibleLine();
  const path = line !== null ? findSymbolPath(currentSymbols, line) : [];

  bar.innerHTML = '';

  const breadcrumb = toElement(
    <div className="outline-breadcrumb">
      <span className="outline-icon">&#9776;</span>
      {path.length > 0 ? (
        path.map((s, i) => (
          <span>
            {i > 0 ? <span className="outline-separator">&rsaquo;</span> : null}
            <span className={`outline-crumb outline-kind-${s.kind}`}>{s.name}</span>
          </span>
        ))
      ) : (
        <span className="outline-crumb outline-crumb-empty">Top level</span>
      )}
    </div>
  );

  breadcrumb.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  bar.appendChild(breadcrumb);
}

function toggleDropdown() {
  const existing = document.querySelector('.outline-dropdown');
  if (existing !== null) {
    existing.remove();
    return;
  }
  showDropdown();
}

function showDropdown() {
  document.querySelectorAll('.outline-dropdown').forEach(el => { el.remove(); });

  const bar = document.getElementById('outline-bar');
  if (bar === null || currentSymbols.length === 0) return;

  const dropdown = toElement(
    <div className="outline-dropdown">
      {renderSymbolList(currentSymbols, 0)}
    </div>
  );

  dropdown.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.outline-item');
    if (item === null) return;
    const line = parseInt(item.dataset.line ?? '0', 10);
    if (line > 0) {
      scrollToLine(line);
      dropdown.remove();
    }
  });

  bar.appendChild(dropdown);

  const close = (e: Event) => {
    if (!dropdown.contains(e.target as Node) && (bar.querySelector('.outline-breadcrumb')?.contains(e.target as Node) !== true)) {
      dropdown.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => { document.addEventListener('click', close, true); }, 0);
}

function renderSymbolList(symbols: OutlineSymbol[], depth: number): JSX.Element {
  return (
    <div>
      {symbols.map(s => (
        <div>
          <div className={`outline-item outline-kind-${s.kind}`} data-line={String(s.line)} style={`padding-left: ${String(12 + depth * 16)}px`}>
            <span className="outline-item-icon">{s.kind === 'class' ? 'C' : 'f'}</span>
            {s.name}
            <span className="outline-item-line">:{s.line}</span>
          </div>
          {s.children.length > 0 ? renderSymbolList(s.children, depth + 1) : null}
        </div>
      ))}
    </div>
  );
}

function scrollToLine(lineNum: number) {
  const container = document.getElementById('diff-container');
  if (container === null) return;

  const target =
    container.querySelector(`.diff-line[data-line="${String(lineNum)}"][data-side="new"]`) ??
    container.querySelector(`.diff-line[data-line="${String(lineNum)}"]`);
  if (target === null) return;

  const headerEl = container.querySelector<HTMLElement>('.diff-header');
  const headerHeight = headerEl?.offsetHeight ?? 0;
  const outlineBar = container.querySelector('.outline-bar');
  const outlineHeight = (outlineBar as HTMLElement | null)?.offsetHeight ?? 0;

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = targetRect.top - containerRect.top + container.scrollTop - headerHeight - outlineHeight;

  container.scrollTo({ top: offset, behavior: 'smooth' });
}

function bindScrollTracking() {
  const container = document.getElementById('diff-container') as OutlineContainer | null;
  if (container === null) return;

  const prev = container._outlineScrollHandler;
  if (prev !== undefined) container.removeEventListener('scroll', prev);

  const handler = () => {
    if (scrollRafId !== 0) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0;
      updateBreadcrumb();
    });
  };

  container._outlineScrollHandler = handler;
  container.addEventListener('scroll', handler, { passive: true });
}
