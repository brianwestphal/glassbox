import { Hono } from 'hono';

import type { AppEnv } from '../types.js';
import { aiAnalysisRoutes } from './ai-analysis.js';
import { aiConfigRoutes } from './ai-config.js';

export const aiApiRoutes = new Hono<AppEnv>();

aiApiRoutes.route('/', aiConfigRoutes);
aiApiRoutes.route('/', aiAnalysisRoutes);
