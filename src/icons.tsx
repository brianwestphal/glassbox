/**
 * Shared SVG icon components. Used by both server-side components and client-side code.
 * Returns SafeHtml so they can be used directly as JSX children without raw().
 */
import type { SafeHtml } from './jsx-runtime.js';

// --- Common icon props ---
const S14 = { xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const S12 = { ...S14, width: "12", height: "12" } as const;
const S16 = { ...S14, width: "16", height: "16" } as const;

// --- Action icons ---

export function IconEdit(): SafeHtml {
  return <svg {...S14}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
}

export function IconTrash(): SafeHtml {
  return <svg {...S14}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
}

export function IconTrash16(): SafeHtml {
  return <svg {...S16}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
}

export function IconCheck(): SafeHtml {
  return <svg {...S14}><path d="M20 6 9 17l-5-5"/></svg>;
}

export function IconReveal(): SafeHtml {
  return <svg {...S12}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>;
}

// --- Zoom icons ---

export function IconZoomOut(): SafeHtml {
  return <svg {...S14}><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}

export function IconZoomIn(): SafeHtml {
  return <svg {...S14}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}

export function IconFit(): SafeHtml {
  return <svg {...S14}><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>;
}

export function IconActualSize(): SafeHtml {
  return <svg {...S14}><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none">1:1</text></svg>;
}

// --- Sidebar icons ---

export function IconFolder(): SafeHtml {
  return <svg {...S14}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>;
}

export function IconShield(): SafeHtml {
  return <svg {...S14}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>;
}

export function IconBook(): SafeHtml {
  return <svg {...S14}><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>;
}
