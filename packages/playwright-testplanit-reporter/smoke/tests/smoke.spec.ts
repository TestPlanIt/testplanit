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
      // test.step() calls are captured as authored steps on the case the
      // reporter creates (nested steps are flattened and depth-prefixed).
      await test.step('Navigate to the login page', async () => {
        expect(1 + 1).toBe(2);
      });
      await test.step('Submit valid credentials', async () => {
        await test.step('Enter username', async () => {
          expect('user').toHaveLength(4);
        });
        await test.step('Enter password and submit', async () => {
          expect(true).toBe(true);
        });
      });
      await test.step('Land on the dashboard', async () => {
        expect(1).toBeGreaterThan(0);
      });
    });

    test(`${tag('TPI_CASE_FAIL')}fails and attaches a screenshot`, async ({}, testInfo) => {
      await test.step('Open the form', async () => {
        expect(1 + 1).toBe(2);
      });
      await testInfo.attach('screenshot', { body: ONE_PX_PNG, contentType: 'image/png' });
      expect(1 + 1, 'deliberate failure to exercise FAILURE + attachment upload').toBe(3);
    });
  });

  test(`${tag('TPI_CASE_SKIP')}is skipped`, async () => {
    test.skip(true, 'deliberately skipped to exercise SKIPPED reporting');
  });
});
