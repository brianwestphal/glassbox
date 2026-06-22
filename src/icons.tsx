/**
 * Shared SVG icon components. Used by both server-side components and client-side code.
 * Returns SafeHtml so they can be used directly as JSX children without raw().
 */
import type { SafeHtml } from 'kerfjs';

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

export function IconCircle(): SafeHtml {
  return <svg {...S14}><circle cx="12" cy="12" r="10"/></svg>;
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

export function IconRefresh(): SafeHtml {
  return <svg {...S14}><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>;
}

export function IconGear(): SafeHtml {
  return <svg {...S14}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
}

// --- Settings tab icons ---

export function IconSliders(): SafeHtml {
  return <svg {...S16}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>;
}

export function IconFlask(): SafeHtml {
  return <svg {...S16}><path d="M9 3h6"/><path d="M10 3v7.4a2 2 0 0 1-.6 1.4L4.2 17a2 2 0 0 0 1.4 3.4h12.8a2 2 0 0 0 1.4-3.4l-5.2-5.2a2 2 0 0 1-.6-1.4V3"/></svg>;
}

export function IconDownload(): SafeHtml {
  return <svg {...S16}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}

export function IconUser(): SafeHtml {
  return <svg {...S16}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}

export function IconCopy(): SafeHtml {
  return <svg {...S14}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>;
}

export function IconPalette(): SafeHtml {
  return <svg {...S14}><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>;
}

export function IconMoreHorizontal(): SafeHtml {
  return <svg {...S14}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
}

/** Apple-style share icon (box with arrow up) — for macOS/iOS */
export function IconShareApple(): SafeHtml {
  return <svg {...S14}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}

/** Network-style share icon (nodes with lines) — for Windows/Linux */
export function IconShareGeneric(): SafeHtml {
  return <svg {...S14}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
}

/** Heart icon (lucide) — used for the sponsor link. */
export function IconHeart(): SafeHtml {
  return <svg {...S14}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>;
}

/** Paperclip icon (lucide) — marks an AI review-note artifact (doc 20). */
export function IconPaperclip(): SafeHtml {
  return <svg {...S12}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
}
