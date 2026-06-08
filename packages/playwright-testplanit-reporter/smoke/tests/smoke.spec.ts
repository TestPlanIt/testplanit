import { test, expect } from '@playwright/test';

/**
 * Smoke spec for @testplanit/playwright-reporter.
 *
 * Case-ID tags are injected from env so the SAME spec works in both modes:
 *  - Tag mode: set TPI_CASE_PASS / TPI_CASE_FAIL / TPI_CASE_SKIP to real case IDs.
 *  - Auto-create mode (TPI_AUTOCREATE=1): leave them unset; the reporter creates
 *    cases by title under the configured folder hierarchy.
 */
const tag = (key: string): string => (process.env[key] ? `[${process.env[key]}] ` : '');

// 1x1 transparent PNG — exercises attachment upload without a browser.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Playwright Smoke', () => {
  test.describe('Login', () => {
    test(`${tag('TPI_CASE_PASS')}logs in successfully`, async () => {
      expect(1 + 1).toBe(2);
    });

    test(`${tag('TPI_CASE_FAIL')}fails and attaches a screenshot`, async ({}, testInfo) => {
      await testInfo.attach('screenshot', { body: ONE_PX_PNG, contentType: 'image/png' });
      expect(1 + 1, 'deliberate failure to exercise FAILURE + attachment upload').toBe(3);
    });
  });

  test(`${tag('TPI_CASE_SKIP')}is skipped`, async () => {
    test.skip(true, 'deliberately skipped to exercise SKIPPED reporting');
  });
});
