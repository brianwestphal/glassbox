import type { FileDiff } from './git/diff.js';
import type { Annotation, ReviewFile } from './db/queries.js';
import {
  getReviewFiles, getAnnotationsForFile,
  updateFileDiff, deleteReviewFile, addReviewFile,
  markAnnotationStale, markAnnotationCurrent, moveAnnotation,
  updateReviewHead,
} from './db/queries.js';

function findLineContent(diff: FileDiff, lineNumber: number, side: string): string | null {
  for (const hunk of diff.hunks || []) {
    for (const line of hunk.lines) {
      if (side === 'old' && line.oldNum === lineNumber) return line.content;
      if (side === 'new' && line.newNum === lineNumber) return line.content;
    }
  }
  return null;
}

function findMatchingLine(diff: FileDiff, content: string, origLineNum: number, side: string, radius: number = 10): { lineNumber: number; side: string } | null {
  let bestMatch: { lineNumber: number; side: string } | null = null;
  let bestDistance = Infinity;

  for (const hunk of diff.hunks || []) {
    for (const line of hunk.lines) {
      if (line.content !== content) continue;
      const lineNum = side === 'old' ? line.oldNum : line.newNum;
      if (lineNum == null) continue;
      const distance = Math.abs(lineNum - origLineNum);
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = { lineNumber: lineNum, side };
      }
    }
  }

  return bestMatch;
}

async function migrateAnnotations(annotations: Annotation[], oldDiff: FileDiff, newDiff: FileDiff): Promise<number> {
  let staleCount = 0;

  for (const annotation of annotations) {
    const oldContent = findLineContent(oldDiff, annotation.line_number, annotation.side);
    if (!oldContent) {
      if (!annotation.is_stale) {
        await markAnnotationStale(annotation.id, null);
        staleCount++;
      }
      continue;
    }

    const match = findMatchingLine(newDiff, oldContent, annotation.line_number, annotation.side);
    if (match) {
      if (match.lineNumber !== annotation.line_number || match.side !== annotation.side) {
        await moveAnnotation(annotation.id, match.lineNumber, match.side);
      } else if (annotation.is_stale) {
        await markAnnotationCurrent(annotation.id);
      }
    } else {
      if (!annotation.is_stale) {
        await markAnnotationStale(annotation.id, oldContent);
        staleCount++;
      }
    }
  }

  return staleCount;
}

export async function updateReviewDiffs(
  reviewId: string,
  newDiffs: FileDiff[],
  headCommit: string
): Promise<{ updated: number; added: number; stale: number }> {
  const existingFiles = await getReviewFiles(reviewId);
  const existingByPath = new Map<string, ReviewFile>();
  for (const f of existingFiles) {
    existingByPath.set(f.file_path, f);
  }

  const newDiffsByPath = new Map<string, FileDiff>();
  for (const d of newDiffs) {
    newDiffsByPath.set(d.filePath, d);
  }

  let updated = 0;
  let added = 0;
  let stale = 0;

  // Update existing files
  for (const [path, existingFile] of existingByPath) {
    const newDiff = newDiffsByPath.get(path);
    if (newDiff) {
      const oldDiff: FileDiff = JSON.parse(existingFile.diff_data || '{}');
      const annotations = await getAnnotationsForFile(existingFile.id);
      if (annotations.length > 0) {
        stale += await migrateAnnotations(annotations, oldDiff, newDiff);
      }
      await updateFileDiff(existingFile.id, JSON.stringify(newDiff));
      updated++;
    } else {
      // File no longer in diff
      const annotations = await getAnnotationsForFile(existingFile.id);
      if (annotations.length === 0) {
        await deleteReviewFile(existingFile.id);
      } else {
        // Mark all non-stale annotations as stale
        const oldDiff: FileDiff = JSON.parse(existingFile.diff_data || '{}');
        for (const a of annotations) {
          if (!a.is_stale) {
            const content = findLineContent(oldDiff, a.line_number, a.side);
            await markAnnotationStale(a.id, content);
            stale++;
          }
        }
      }
    }
  }

  // Add new files
  for (const [path, diff] of newDiffsByPath) {
    if (!existingByPath.has(path)) {
      await addReviewFile(reviewId, path, JSON.stringify(diff));
      added++;
    }
  }

  await updateReviewHead(reviewId, headCommit);

  return { updated, added, stale };
}
