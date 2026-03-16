import type { ReviewFile } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';

interface ImageDiffProps {
  file: ReviewFile;
  diff: FileDiff;
}

export function ImageDiff({ file, diff }: ImageDiffProps) {
  const fileId = file.id;
  const isAdded = diff.status === 'added';
  const isDeleted = diff.status === 'deleted';
  const hasOld = !isAdded;
  const hasNew = !isDeleted;
  const hasComparison = hasOld && hasNew;

  return (
    <div className="image-diff" data-file-id={fileId} data-file-path={file.file_path}
      data-has-old={String(hasOld)} data-has-new={String(hasNew)}>

      {/* Metadata mode */}
      <div className="image-diff-panel image-diff-metadata active" data-panel="metadata">
        <div className="image-metadata-loading">Loading metadata...</div>
      </div>

      {/* Difference mode (blend) */}
      {hasComparison && (
        <div className="image-diff-panel image-diff-visual" data-panel="difference">
          <div className="image-visual-canvas" data-zoomable="true">
            <div className="image-zoom-wrap">
              <img className="image-layer image-layer-old" src={`/api/image/${fileId}/old`} alt="Old version" />
              <img className="image-layer image-layer-new image-blend" src={`/api/image/${fileId}/new`} alt="New version" />
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
