import { test as base, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const coverageDir = process.env.E2E_BROWSER_COVERAGE;
const projectRoot = resolve(process.cwd());

const urlToFile: Record<string, string> = {
  '/static/app.js': join(projectRoot, 'dist/client/app.global.js'),
  '/static/history.js': join(projectRoot, 'dist/client/history.global.js'),
};

// Page-error tracking: every test page must end the run without any
// `pageerror` (uncaught JS exceptions / unhandled promise rejections) or
// `console.error()` calls. GB-800 — switching diff files threw inside a
// fire-and-forget `void loadOutline(...)`, which surfaced only as
// `unhandledrejection` on `window`; tests previously had no error listeners,
// so every diff-switch test was silently green while production was broken.
//
// `allowedPageErrors` (a `test.use()` option) lets a test that DELIBERATELY
// provokes a failure — e.g. fulfilling an API route with a 500 to drive the
// completion modal's failed stage — allowlist the expected browser noise
// (matched errors are dropped; anything else still fails the test).
const collectPageErrors = base.extend<{ failOnPageError: void; allowedPageErrors: RegExp[] }>({
  allowedPageErrors: [[], { option: true }],
  failOnPageError: [async ({ page, allowedPageErrors }, use, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', err => { errors.push(`pageerror: ${err.message}`); });
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await use();
    const unexpected = errors.filter(e => !allowedPageErrors.some(re => re.test(e)));
    if (unexpected.length > 0 && testInfo.errors.length === 0) {
      throw new Error(`Browser surfaced ${unexpected.length} error(s) during this test:\n  - ${unexpected.join('\n  - ')}`);
    }
  }, { auto: true }],
});

export const test = coverageDir
  ? collectPageErrors.extend({
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
  : collectPageErrors;

export { expect };
