---
title: Linking & Auto-Creating Test Cases
---

# Linking & Auto-Creating Test Cases

## Linking Tests to Test Cases

Link your automated tests to existing TestPlanIt test cases by including case IDs in your test titles. By default, the reporter looks for case IDs in square brackets like `[1234]`:

```javascript
describe('User Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // This test links to TestPlanIt case #12345
    await LoginPage.login('user@example.com', 'password');
    await expect(DashboardPage.heading).toBeDisplayed();
  });

  it('[12346] [12347] should show error for invalid password', async () => {
    // This test links to BOTH case #12346 and #12347
    await LoginPage.login('user@example.com', 'wrongpassword');
    await expect(LoginPage.errorMessage).toHaveText('Invalid credentials');
  });

  it('should logout successfully', async () => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
    // With autoCreateTestCases: true, this links to or creates a case named "should logout successfully"
    await DashboardPage.logout();
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regular expression to match case IDs in your test titles. The pattern **must include a capturing group** `(\d+)` to extract the numeric ID.

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Choose a pattern that matches your test naming convention:
      caseIdPattern: /C(\d+)/g,  // Matches: C12345
    }]
  ],
};
```

### When No Case ID Is Found

If the pattern doesn't match any case ID in a test title, the behavior depends on the `autoCreateTestCases` setting:

| `autoCreateTestCases` | Behavior |
| ----------------------- | ---------- |
| `false` (default) | The test result is **skipped** and not reported to TestPlanIt. A warning is logged if `verbose` is enabled. |
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

You can also pass the pattern as a string (useful for JSON config files):

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      caseIdPattern: 'TC-(\\d+)',  // Note: double backslash in strings
    }]
  ],
};
```

## Auto-Creating Test Cases

Automatically create test cases in TestPlanIt for tests without case IDs:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,     // Required: folder for new cases
      templateId: 1,          // Required: template for new cases
    }]
  ],
};
```

When `autoCreateTestCases` is enabled:
- Tests with case IDs still link to existing cases
- Tests without case IDs are looked up by name and suite (className)
- If a matching case is found, results are linked to it
- If no match is found, a new case is created in TestPlanIt
- The test title becomes the case name
- The suite name becomes the case's `className` for grouping

This means on first run, test cases are created automatically. On subsequent runs, the same test cases are reused based on matching name and suite.

### Creating Folder Hierarchies

When you have nested Mocha suites (describe blocks), you can automatically create a matching folder structure in TestPlanIt:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,          // Root folder for created hierarchy
      templateId: 1,
      createFolderHierarchy: true, // Enable folder hierarchy creation
    }]
  ],
};
```

With `createFolderHierarchy` enabled, nested describe blocks create nested folders:

```javascript
// test/specs/login.spec.js
describe('Authentication', () => {           // Creates folder: "Authentication"
  describe('Login', () => {                  // Creates folder: "Authentication > Login"
    describe('@smoke', () => {               // Creates folder: "Authentication > Login > @smoke"
      it('should login with valid credentials', async () => {
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

## Capturing Gherkin steps as case steps

When you run with [`@wdio/cucumber-framework`](https://webdriver.io/docs/frameworks/) and `autoCreateTestCases: true`, the reporter creates **one case per scenario** and (with `captureSteps: true`, the default) writes the scenario's Gherkin steps as the case's **Steps**:

- **`Given`** → a leading step (no expected result)
- **`When`** → a Step (action)
- **`Then`** → the **Expected Result** of the preceding `When` step
- **`And` / `But` / `*`** inherit the role of the nearest preceding primary keyword

This is the same mapping TestPlanIt uses when importing automated results, so a Cucumber scenario produces the **same** Steps whether it is imported or reported via WDIO.

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    // ...domain / apiToken / projectId...
    autoCreateTestCases: true,
    parentFolderId: 10,
    templateId: 1,
    captureSteps: true,     // default
    overwriteSteps: false,  // true re-syncs steps every run (destructive)
  }]
]
```

`overwriteSteps: true` soft-deletes a case's existing steps and rewrites them from the scenario every run — **destructive**: manual edits are discarded (a scenario with no steps never clears existing steps). Leave it `false` (default) to never overwrite human-edited steps.

### Limitations

- **Mocha and Jasmine produce no _deterministic_ steps.** They have no native step structure, so there's nothing to map directly. Instead, when `captureSteps` is on (the default) **and an [LLM provider is configured for the project](../user-guide/llm-step-derivation.md)**, the reporter captures the **commands each test actually ran** (navigation, clicks, input, assertions) and requests opt-in **AI-derived** steps from them — generated by a background job, with a notification for the run owner to review. Configuring a provider **is** the opt-in; if none is configured, it's a silent no-op. `overwriteSteps` extends this to re-derive matched cases that already have steps (destructive).
- **`scenarioLevelReporter: true` is not supported for step capture.** That Cucumber mode suppresses per-step events, so the individual Gherkin steps are not visible to the reporter. Use the default `scenarioLevelReporter: false` to capture steps.
