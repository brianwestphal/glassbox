/**
 * Synchronize line heights between left and right columns in split-columns layout.
 * When wrapping is enabled, lines can wrap to different heights on each side.
 * This sets min-height on each line so both sides stay vertically aligned.
 */
export function syncSplitColumnHeights() {
  document.querySelectorAll('.split-columns').forEach(block => {
    const leftCol = block.querySelector('.split-col-left');
    const rightCol = block.querySelector('.split-col-right');
    if (leftCol === null || rightCol === null) return;

    const leftLines = leftCol.children;
    const rightLines = rightCol.children;
    const count = Math.min(leftLines.length, rightLines.length);

    // First pass: clear previous min-heights so we measure natural sizes
    for (let i = 0; i < count; i++) {
      (leftLines[i] as HTMLElement).style.minHeight = '';
      (rightLines[i] as HTMLElement).style.minHeight = '';
    }

    // Second pass: measure and sync
    for (let i = 0; i < count; i++) {
      const lh = (leftLines[i] as HTMLElement).offsetHeight;
      const rh = (rightLines[i] as HTMLElement).offsetHeight;
      if (lh !== rh) {
        const max = Math.max(lh, rh) + 'px';
        (leftLines[i] as HTMLElement).style.minHeight = max;
        (rightLines[i] as HTMLElement).style.minHeight = max;
      }
    }
  });
}
