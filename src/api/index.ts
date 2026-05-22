// Aggregated entry point for the typed API layer.
//
// Two ways to use it:
//
//   // Named import (tree-shakes cleanly):
//   import { createAnnotation } from '../../api/index.js';
//   await createAnnotation({ ... });
//
//   // Flat namespace (matches the GB-798 ticket shape):
//   import { apis } from '../../api/index.js';
//   await apis.createAnnotation({ ... });
//
// Both forms map to the same runtime functions; pick whichever is more
// discoverable in the surrounding code. The flat namespace requires every
// caller name to be globally unique across modules — see the per-resource
// files for the catalog.
//
// Types: every Req/Resp type from each resource module is re-exported, so
// server code can `import type { CreateAnnotationReq } from '../api/index.js'`
// to stay in lockstep with the client.

import * as ai from './ai.js';
import * as annotations from './annotations.js';
import * as channel from './channel.js';
import * as context from './context.js';
import * as files from './files.js';
import * as image from './image.js';
import * as outline from './outline.js';
import * as projectSettings from './project-settings.js';
import * as reviews from './reviews.js';
import * as sharePrompt from './share-prompt.js';
import * as themes from './themes.js';

export * from './ai.js';
export * from './annotations.js';
export * from './channel.js';
export * from './context.js';
export * from './files.js';
export * from './image.js';
export * from './outline.js';
export * from './project-settings.js';
export * from './reviews.js';
export * from './share-prompt.js';
export * from './themes.js';

/** Flat namespace combining every typed caller across the resource
 *  modules. Names are globally unique by convention — see each module for
 *  the catalog of `xResource` style names. */
export const apis = {
  ...ai,
  ...annotations,
  ...channel,
  ...context,
  ...files,
  ...image,
  ...outline,
  ...projectSettings,
  ...reviews,
  ...sharePrompt,
  ...themes,
};
