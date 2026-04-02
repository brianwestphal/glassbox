import { test as base, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const coverageDir = process.env.E2E_BROWSER_COVERAGE;
const projectRoot = resolve(process.cwd());

const urlToFile: Record<string, string> = {
  '/static/app.js': join(projectRoot, 'dist/client/app.global.js'),
  '/static/history.js': join(projectRoot, 'dist/client/history.global.js'),
};

export const test = coverageDir
  ? base.extend({
      page: async ({ page }, use) => {
        await page.coverage.startJSCoverage();
        await use(page);
        const coverage = await page.coverage.stopJSCoverage();

        const entries = coverage.flatMap(entry => {
          const match = Object.entries(urlToFile).find(([path]) => entry.url.includes(path));
          if (!match) return [];
          const { source: _, ...rest } = entry;
          return [{ ...rest, url: `file://${match[1]}` }];
        });

        if (entries.length > 0) {
          mkdirSync(coverageDir, { recursive: true });
          const file = join(coverageDir, `coverage-browser-${process.pid}-${Date.now()}.json`);
          writeFileSync(file, JSON.stringify({ result: entries }));
        }
      },
    })
  : base;

export { expect };
