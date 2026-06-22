import type { ReviewFile } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';

interface ImageDiffProps {
  file: ReviewFile;
  diff: FileDiff;
  fontWarning?: boolean;
  baseWidth?: number;
  baseHeight?: number;
}

export function ImageDiff({ file, diff, fontWarning, baseWidth, baseHeight }: ImageDiffProps) {
  const fileId = file.id;
  const isAdded = diff.status === 'added';
  const isDeleted = diff.status === 'deleted';
  const hasOld = !isAdded;
  const hasNew = !isDeleted;
  const hasComparison = hasOld && hasNew;

  return (
    <div className="image-diff" data-file-id={fileId} data-file-path={file.file_path}
      data-has-old={String(hasOld)} data-has-new={String(hasNew)}
      {...(baseWidth !== undefined ? { 'data-base-width': String(baseWidth) } : {})}
      {...(baseHeight !== undefined ? { 'data-base-height': String(baseHeight) } : {})}>

      {fontWarning === true && (
        <div className="image-font-warning">
          This SVG uses text that may render differently depending on locally installed fonts.
        </div>
      )}

      {/* Metadata mode */}
      <div className="image-diff-panel image-diff-metadata" data-panel="metadata">
        <div className="image-metadata-loading">Loading metadata...</div>
      </div>

      {/* Side-by-side mode (doc 24): old (A) and new (B) shown next to each
          other. Orientation (left-right vs over-under) is set on the panel by
          the client from the persisted preference. Each pane is its own
          zoom/pan canvas; the two share one zoom state (synced). */}
      {hasComparison && (
        <div className="image-diff-panel image-diff-sxs" data-panel="side-by-side" data-sxs-orientation="left-right">
          <div className="image-sxs-pane" data-sxs-pane="old">
            <div className="image-sxs-label">Old (A)</div>
            <div className="image-visual-canvas" data-zoomable="true">
              <div className="image-zoom-wrap">
                <img className="image-layer image-layer-old" src={`/api/image/${fileId}/old`} alt="Old version" />
                <div className="region-overlay" data-region-overlay data-region-side="old"></div>
              </div>
            </div>
          </div>
          <div className="image-sxs-pane" data-sxs-pane="new">
            <div className="image-sxs-label">New (B)</div>
            <div className="image-visual-canvas" data-zoomable="true">
              <div className="image-zoom-wrap">
                <img className="image-layer image-layer-new" src={`/api/image/${fileId}/new`} alt="New version" />
                <div className="region-overlay" data-region-overlay data-region-side="new"></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Difference mode (blend) */}
      {hasComparison && (
        <div className="image-diff-panel image-diff-visual" data-panel="difference">
          <div className="image-visual-canvas" data-zoomable="true">
            <div className="image-zoom-wrap">
              <img className="image-layer image-layer-old" src={`/api/image/${fileId}/old`} alt="Old version" />
              <img className="image-layer image-layer-new image-blend" src={`/api/image/${fileId}/new`} alt="New version" />
              <div className="region-overlay" data-region-overlay></div>
            </div>
          </div>
        </div>
      )}

      {/* Slice mode */}
      {hasComparison && (
        <div className="image-diff-panel image-diff-visual" data-panel="slice">
          <div className="image-visual-canvas" data-zoomable="true">
            <div className="image-zoom-wrap">
              <img className="image-layer image-layer-old" src={`/api/image/${fileId}/old`} alt="Old version" />
              <img className="image-layer image-layer-new image-slice-clipped" src={`/api/image/${fileId}/new`} alt="New version" />
              <div className="region-overlay" data-region-overlay></div>
            </div>
            <div className="slice-line"></div>
            <div className="slice-handle slice-handle-a"></div>
            <div className="slice-handle slice-handle-b"></div>
          </div>
        </div>
      )}

      {/* Image viewer for added/deleted files (zoom/pan enabled) */}
      {!hasComparison && (
        <div className="image-diff-panel image-diff-visual" data-panel="image">
          <div className="image-visual-canvas" data-zoomable="true">
            <div className="image-zoom-wrap">
              <img className="image-layer image-layer-old" src={`/api/image/${fileId}/${isAdded ? 'new' : 'old'}`}
                alt={isAdded ? 'New image' : 'Deleted image'} />
              <div className="region-overlay" data-region-overlay></div>
            </div>
          </div>
        </div>
      )}

      {/* Image feedback (doc 23): general comments + drawn rectangle regions.
          Populated client-side by initImageFeedback(). */}
      <div className="image-feedback" data-image-feedback></div>
    </div>
  );
}
