---
title: Linking & Auto-Creating Test Cases
---

# Linking & Auto-Creating Test Cases

## Linking Tests to Test Cases

There are three ways to link an automated test to existing TestPlanIt case IDs. They can be combined, and the resulting IDs are de-duplicated:

1. **Annotations** — `{ annotation: { type: 'testplanit', description: '1234' } }` (recommended)
2. **Tags** — `{ tag: '@C1234' }`, matched by `caseIdPattern`
3. **Test title** — `[1234] my test`, matched by `caseIdPattern`

### Using annotations (recommended)

For established suites, embedding IDs in titles means renaming every test. Playwright [annotations](https://playwright.dev/docs/test-annotations) let you attach the case ID as metadata instead — your titles stay clean:

```typescript
import { test, expect } from '@playwright/test';

test('should login with valid credentials', {
  annotation: { type: 'testplanit', description: '1234' },
}, async ({ page }) => {
  // Links to TestPlanIt case #1234 — no case ID in the title
});

// Link one test to multiple cases with multiple annotations:
test('covers two requirements', {
  annotation: [
    { type: 'testplanit', description: '1234' },
    { type: 'testplanit', description: '1235' },
  ],
}, async ({ page }) => {});
```

The annotation `description` holds the case ID(s); any non-digit characters are ignored, so `'1234'`, `'C1234'`, and `'1234, 1235'` all work. Change the annotation `type` the reporter looks for with the [`caseIdAnnotation`](./playwright-configuration.md) option (default `'testplanit'`); set it to an empty string to disable annotation linking.

You can also add the annotation at runtime:

```typescript
test('logs in', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'testplanit', description: '1234' });
});
```

### Using tags

If your team already tags tests, the reporter applies `caseIdPattern` to each [tag](https://playwright.dev/docs/test-annotations#tag-tests) too. For example, with `caseIdPattern: /C(\d+)/g` a `@C1234` tag links case #1234:

```typescript
test('should login', { tag: '@C1234' }, async ({ page }) => {
  // Links to case #1234 via the tag (caseIdPattern: /C(\d+)/g)
});
```

### Using the test title

You can also include case IDs directly in test titles. By default, the reporter looks for IDs in square brackets like `[1234]`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('User Authentication', () => {
  test('[12345] should login with valid credentials', async ({ page }) => {
    // This test links to TestPlanIt case #12345
    await page.goto('/login');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('[12346] [12347] should show error for invalid password', async ({ page }) => {
    // This test links to BOTH case #12346 and #12347
    await page.goto('/login');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
    await page.getByRole('button', { name: 'Log out' }).click();
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regular expression to match case IDs in your test titles. The pattern **must include a capturing group** `(\d+)` to extract the numeric ID.

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Choose a pattern that matches your test naming convention:
      caseIdPattern: /C(\d+)/g,  // Matches: C12345
    }],
  ],
});
```

### When No Case ID Is Found

If the pattern doesn't match any case ID in a test title, the behavior depends on the `autoCreateTestCases` setting:

| `autoCreateTestCases` | Behavior |
| ----------------------- | ---------- |
| `false` (default) | The test result is **skipped** and not reported to TestPlanIt. A warning is logged. |
| `true` | The reporter looks up or creates a test case by matching on the test name and suite (className). See [Auto-Creating Test Cases](#auto-creating-test-cases). |

This means if you're using case IDs exclusively (without auto-creation), tests without valid case IDs in their titles won't appear in your TestPlanIt results.

### Common Pattern Examples

| Pattern | Matches | Example Test Title |
| --------- | --------- | ------------------- |
| `/\[(\d+)\]/g` (default) | `[1234]` | `[1234] should load the page` |
| `/C(\d+)/g` | `C1234` | `C1234 should load the page` |
| `/TC-(\d+)/g` | `TC-1234` | `TC-1234 should load the page` |
| `/TEST-(\d+)/g` | `TEST-1234` | `TEST-1234 should load the page` |
| `/CASE-(\d+)/g` | `CASE-1234` | `CASE-1234 should load the page` |
| `/^(\d+)\s/g` | Plain number at start | `1234 should load the page` |
| `/#(\d+)/g` | `#1234` | `#1234 should load the page` |

### Using Pattern as String

You can also pass the pattern as a string:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      caseIdPattern: 'TC-(\\d+)',  // Note: double backslash in strings
    }],
  ],
});
```

## Auto-Creating Test Cases

Automatically create test cases in TestPlanIt for tests without case IDs:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,     // Required: folder for new cases (ID or name)
      templateId: 1,          // Required: template for new cases (ID or name)
    }],
  ],
});
```

When `autoCreateTestCases` is enabled:
- Tests with case IDs still link to existing cases
- Tests without case IDs are looked up by name and suite (the `describe` path becomes the `className`)
- If a matching case is found, results are linked to it
- If no match is found, a new case is created in TestPlanIt
- The test title becomes the case name

This means on first run, test cases are created automatically. On subsequent runs, the same test cases are reused based on matching name and suite.

:::note
`parentFolderId` and `templateId` are required when `autoCreateTestCases` is enabled. If either is missing, results for unlinked tests can't be reported. Set both (a string name is fine — `parentFolderId` is created if it doesn't exist).
:::

### Creating Folder Hierarchies

When you have nested `test.describe` blocks, you can automatically create a matching folder structure in TestPlanIt:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 'Automated Tests',  // Root folder for created hierarchy
      templateId: 'Default Template',
      createFolderHierarchy: true,         // Enable folder hierarchy creation
    }],
  ],
});
```

With `createFolderHierarchy` enabled, nested describe blocks create nested folders:

```typescript
// tests/login.spec.ts
test.describe('Authentication', () => {       // Creates folder: "Authentication"
  test.describe('Login', () => {              // Creates folder: "Authentication > Login"
    test.describe('@smoke', () => {           // Creates folder: "Authentication > Login > @smoke"
      test('should login with valid credentials', async ({ page }) => {
        // Test case placed in "Authentication > Login > @smoke" folder
      });
    });
  });
});
```

This creates:

```text
parentFolderId (e.g., "Automated Tests")
└── Authentication
    └── Login
        └── @smoke
            └── "should login with valid credentials" (test case)
```

**Requirements:**

- `autoCreateTestCases` must be `true`
- `parentFolderId` must be set (this becomes the root of the hierarchy)
- `templateId` must be set for new test cases

Folder paths are cached during the test run to avoid redundant API calls, making large test suites efficient.

## Capturing test.step() as case steps

When the reporter creates a new test case, it can seed that case's steps from your Playwright [`test.step()`](https://playwright.dev/docs/api/class-test#test-step) calls. This is on by default whenever `autoCreateTestCases` is enabled — set `captureSteps: false` to turn it off.

```typescript
import { test } from '@playwright/test';

test('checkout flow', async ({ page }) => {
  await test.step('Add item to cart', async () => {
    // ...
  });
  await test.step('Proceed to checkout', async () => {
    await test.step('Enter shipping address', async () => {
      // ...
    });
    await test.step('Enter payment details', async () => {
      // ...
    });
  });
});
```

On the **first** run (when the case is created), the reporter writes these as ordered, authored steps on the case:

```text
1. Add item to cart
2. Proceed to checkout
3. › Enter shipping address
4. › Enter payment details
```

How it works:

- Each `test.step()` title becomes one step, in execution order.
- Nested steps are flattened and prefixed with `›` per level of depth, so the hierarchy is preserved as readable text.
- Only your `test.step()` calls are captured — auto-instrumented actions (`expect`, locator/`page` API calls, hooks, fixtures) are skipped.
- Expected results are left blank (Playwright steps have no expected-result concept); you can fill them in afterward in TestPlanIt.

:::note
By default, steps are written **only when a case is created** — existing or restored cases are never modified, so edits you make in TestPlanIt are never overwritten on later runs. To keep existing cases in sync instead, see [Keeping steps in sync](#keeping-steps-in-sync) below. For the steps to render without an "orphaned steps" warning, the case's `templateId` should use a template that includes a **Steps** field.
:::

### Keeping steps in sync

When you change a test script, the case in TestPlanIt can drift from what the automation actually does. Enable `overwriteSteps` to re-sync an **existing** case's steps from its `test.step()` calls on every run:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      overwriteSteps: true,   // replace existing case steps each run
    }],
  ],
});
```

This applies to cases linked by ID (annotation, tag, or title) **and** to cases matched by `autoCreateTestCases`. On each run the case's existing steps are cleared and rewritten from the current `test.step()` calls.

:::warning
`overwriteSteps` is **destructive**: any manual edits to a case's steps in TestPlanIt are discarded the next time the test runs. Use it when the automation is the source of truth for the steps.

As a safeguard, a test with **no** `test.step()` calls never clears an existing case's steps — so a test that simply doesn't use `test.step()` can't accidentally wipe a manually authored case. Cleared steps are soft-deleted (recoverable), not permanently removed, and step changes are not recorded as a new case version.
:::
