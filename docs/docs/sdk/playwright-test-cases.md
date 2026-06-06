---
title: Linking & Auto-Creating Test Cases
---

# Linking & Auto-Creating Test Cases

## Linking Tests to Test Cases

Link your automated tests to existing TestPlanIt test cases by including case IDs in your test titles. By default, the reporter looks for case IDs in square brackets like `[1234]`:

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
