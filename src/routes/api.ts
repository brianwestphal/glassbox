import { Hono } from 'hono';

import type { AppEnv } from '../types.js';
import { annotationsRoutes } from './api/annotations.js';
import { contextRoutes } from './api/context.js';
import { filesRoutes } from './api/files.js';
import { imageRoutes } from './api/image.js';
import { outlineRoutes } from './api/outline.js';
import { projectSettingsRoutes } from './api/project-settings.js';
import { reviewsRoutes } from './api/reviews.js';
import { sharePromptRoutes } from './api/share-prompt.js';
import { systemRoutes } from './api/system.js';

/**
 * Aggregator for the core JSON API mounted at `/api/*` in `server.ts`. Each
 * concern lives in its own focused sub-router under `routes/api/`; this
 * file just composes them.
 */
export const apiRoutes = new Hono<AppEnv>();

apiRoutes.route('/', reviewsRoutes);
apiRoutes.route('/', filesRoutes);
apiRoutes.route('/', annotationsRoutes);
apiRoutes.route('/', outlineRoutes);
apiRoutes.route('/', contextRoutes);
apiRoutes.route('/', projectSettingsRoutes);
apiRoutes.route('/', imageRoutes);
apiRoutes.route('/', sharePromptRoutes);
apiRoutes.route('/', systemRoutes);
