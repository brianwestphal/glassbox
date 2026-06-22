import type { SafeHtml } from 'kerfjs';
import { delegate } from 'kerfjs';

import type { Attachment } from '../../api/index.js';
import {
  deleteAttachment as deleteAttachmentApi,
  listAllAttachments,
  quicklookAttachment,
  uploadAttachment,
} from '../../api/index.js';
import { IconFile, IconTrash } from '../../icons.js';
import { asEl, asElOrNull, toElement } from '../dom.js';

/**
 * Reviewer file attachments on a feedback item (doc 25). Each annotation row
 * carries an attach button (in its actions) and a `[data-att-list]` container;
 * this module renders the chips, handles upload (button + drag-drop), preview
 * (OS Quick Look via the local server), and removal.
 *
 * Runs imperatively under the diff's `data-morph-skip` subtree, so it owns the
 * chip DOM directly (like the image-feedback layer) rather than via `mount()`.
 */

function chipJsx(att: Attachment): SafeHtml {
  return (
    <div className="attachment-chip" tabIndex={0} role="button"
      data-att-id={att.id} data-filename={att.original_filename}
      title={`${att.original_filename} — click or press Space to preview`}>
      <IconFile />
      <span className="attachment-chip-name">{att.original_filename}</span>
      <button className="attachment-chip-remove" data-action="remove-attachment" title="Remove attachment"><IconTrash /></button>
    </div>
  );
}

function listContainer(root: ParentNode, annotationId: string): HTMLElement | null {
  return asElOrNull(root.querySelector(`[data-att-list="${cssEscape(annotationId)}"]`));
}

/** CSS.escape isn't on every target; ids are base36 so a minimal escape is
 *  enough, but guard anyway. */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function appendChip(container: HTMLElement, att: Attachment): void {
  container.appendChild(toElement(chipJsx(att)));
}

/** Fetch every attachment in the review once and fill the matching annotation
 *  containers. Idempotent: clears each container first. */
export async function hydrateAttachments(root: ParentNode): Promise<void> {
  let all: Attachment[];
  try {
    all = await listAllAttachments();
  } catch {
    return; // a load failure shouldn't break the diff
  }
  const byAnnotation = new Map<string, Attachment[]>();
  for (const att of all) {
    const list = byAnnotation.get(att.annotation_id) ?? [];
    list.push(att);
    byAnnotation.set(att.annotation_id, list);
  }
  for (const container of Array.from(root.querySelectorAll<HTMLElement>('[data-att-list]'))) {
    const id = container.dataset.attList ?? '';
    container.replaceChildren();
    for (const att of byAnnotation.get(id) ?? []) appendChip(container, att);
  }
}

async function uploadFiles(annotationId: string, files: FileList | File[]): Promise<void> {
  const container = listContainer(document, annotationId);
  for (const file of Array.from(files)) {
    try {
      const att = await uploadAttachment(annotationId, file);
      if (container !== null) appendChip(container, att);
    } catch {
      // Surface nothing intrusive; a failed upload just doesn't add a chip.
    }
  }
}

function openFilePicker(annotationId: string): void {
  const input = toElement(<input type="file" multiple style="display:none" />) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files !== null && input.files.length > 0) void uploadFiles(annotationId, input.files);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

async function previewChip(chip: HTMLElement): Promise<void> {
  const id = chip.dataset.attId;
  if (id === undefined || id === '') return;
  try {
    await quicklookAttachment(id);
  } catch {
    /* preview is best-effort */
  }
}

async function removeChip(chip: HTMLElement): Promise<void> {
  const id = chip.dataset.attId;
  if (id === undefined || id === '') return;
  try {
    await deleteAttachmentApi(id);
    chip.remove();
  } catch {
    /* leave the chip if the delete failed */
  }
}

/** The annotation id for a drop target: the dropped-on row's annotation, found
 *  via its `[data-att-list]` container (every annotation row has one). */
function annotationIdForRow(el: Element): string | null {
  const row = el.closest<HTMLElement>('.annotation-item');
  const container = row?.querySelector<HTMLElement>('[data-att-list]');
  return container?.dataset.attList ?? null;
}

/** Register attachment delegates on the diff container. Called once from
 *  `bindAnnotationEvents()`. */
export function bindAttachmentEvents(root: HTMLElement): void {
  // Attach button → file picker.
  void delegate(root, 'click', '.annotation-item [data-action="attach"]', (e, btn) => {
    e.stopPropagation();
    const id = annotationIdForRow(asEl(btn));
    if (id !== null) openFilePicker(id);
  });

  // Chip click → preview. The × button has its own delegate + stopPropagation,
  // so a click on it never reaches here.
  void delegate(root, 'click', '.attachment-chip', (e, chip) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.attachment-chip-remove') != null) return;
    void previewChip(asEl(chip));
  });

  // Spacebar / Enter on a focused chip → preview (Finder-like).
  void delegate(root, 'keydown', '.attachment-chip', (e, chip) => {
    const ke = e as KeyboardEvent;
    if (ke.key === ' ' || ke.key === 'Enter') {
      ke.preventDefault();
      void previewChip(asEl(chip));
    }
  });

  // Remove (×) → delete.
  void delegate(root, 'click', '.attachment-chip-remove', (e, btn) => {
    e.stopPropagation();
    const chip = asEl(btn).closest<HTMLElement>('.attachment-chip');
    if (chip !== null) void removeChip(chip);
  });

  // Drag-and-drop a file onto an annotation row → upload to that annotation.
  void delegate(root, 'dragover', '.annotation-item', (e, row) => {
    const de = e as DragEvent;
    if (de.dataTransfer?.types.includes('Files') !== true) return;
    de.preventDefault();
    de.dataTransfer.dropEffect = 'copy';
    asEl(row).classList.add('annotation-drop-target');
  });
  void delegate(root, 'dragleave', '.annotation-item', (_e, row) => {
    asEl(row).classList.remove('annotation-drop-target');
  });
  void delegate(root, 'drop', '.annotation-item', (e, row) => {
    const de = e as DragEvent;
    const files = de.dataTransfer?.files;
    asEl(row).classList.remove('annotation-drop-target');
    if (files === undefined || files.length === 0) return;
    de.preventDefault();
    const id = annotationIdForRow(asEl(row));
    if (id !== null) void uploadFiles(id, files);
  });
}
