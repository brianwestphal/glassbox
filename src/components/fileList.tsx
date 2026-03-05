import type { ReviewFile } from '../db/queries.js';

export function FileList({ files, annotationCounts }: { files: ReviewFile[]; annotationCounts: Record<string, number> }) {
  return (
    <div className="file-list">
      <div className="file-list-items">
        {files.map(f => {
          const diff = JSON.parse(f.diff_data || '{}');
          const count = annotationCounts[f.id] || 0;
          return (
            <div className="file-item" data-file-id={f.id}>
              <span className={`status-dot ${f.status}`}></span>
              <span className="file-name" title={f.file_path}>{shortPath(f.file_path)}</span>
              <span className={`file-status ${diff.status || ''}`}>{diff.status || ''}</span>
              {count > 0 ? <span className="annotation-count">{count}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}
