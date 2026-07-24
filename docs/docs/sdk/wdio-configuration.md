---
title: Configuration Options
---

# Configuration Options

These options apply to the **reporter**. If you're using the [Launcher Service](./wdio-launcher-service.md), see [Choosing Your Setup](./wdio-overview.md#choosing-your-setup) for which options apply where.

## Required

| Option | Type                     | Description |
| -------- | -------------------------- | ------------- |
| `domain` | `string` | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | API token for authentication (starts with `tpi_`) |
| `projectId` | `number` | Project ID where results will be reported (find this on the [Project Overview](../user-guide/project-overview.md) page) |

## Optional

| Option | Type                     | Default | Description |
| -------- | -------------------------- | --------- | ------------- |
| `testRunId` | `number \| string` | - | Existing test run to add results to (ID or name). If set, `runName` is ignored |
| `runName` | `string` | `'{suite} - {date} {time}'` | Name for new test runs (ignored if `testRunId` is set). Supports placeholders |
| `testRunType` | `string` | Auto-detected | Test framework type. Auto-detected from WebdriverIO config (`mocha` → `'MOCHA'`, `cucumber` → `'CUCUMBER'`, others → `'REGULAR'`). Override manually if needed. |
| `configId` | `number \| string` | - | Configuration for the test run (ID or name) |
| `milestoneId` | `number \| string` | - | Milestone for the test run (ID or name) |
| `stateId` | `number \| string` | - | Workflow state for the test run (ID or name) |
| `caseIdPattern` | `RegExp \| string` | `/\[(\d+)\]/g` | Regex pattern for extracting case IDs from test titles |
| `matchByCustomField` | `object` | - | Resolve an existing case by a **custom field value** parsed from the title, before the name/create fallback. See [Matching by a Custom Field](#matching-by-a-custom-field) |
| `autoCreateTestCases` | `boolean` | `false` | Auto-create test cases if they don't exist |
| `captureSteps` | `boolean` | `true` | Populate a case's Steps. **Cucumber:** captures the scenario's Given/When/Then deterministically. **Mocha/Jasmine (and other low-structure frameworks):** requests opt-in **AI-derived** steps — but only when an LLM provider is [configured for the project](../user-guide/llm-step-derivation.md); otherwise it is a silent no-op. |
| `overwriteSteps` | `boolean` | `false` | Re-sync steps on **every** run, replacing existing ones — **destructive** (discards manual edits). Applies to both paths: the Cucumber deterministic steps and the AI-derived steps for low-structure frameworks. |
| `createFolderHierarchy` | `boolean` | `false` | Create folder hierarchy based on Mocha suite structure (requires `autoCreateTestCases` and `parentFolderId`) |
| `parentFolderId` | `number \| string` | - | Folder for auto-created test cases (ID or name) |
| `templateId` | `number \| string` | - | Template for auto-created test cases (ID or name) |
| `tagIds` | `(number \| string)[]` | - | Tags to apply to the test run (IDs or names). Tags that don't exist are created automatically |
| `uploadScreenshots` | `boolean` | `true` | Upload intercepted screenshots to TestPlanIt (requires screenshot capture — see [Screenshot Uploads](./wdio-screenshots.md)) |
| `includeStackTrace` | `boolean` | `true` | Include stack traces for failures |
| `completeRunOnFinish` | `boolean` | `true` | Mark run as complete when tests finish |
| `oneReport` | `boolean` | `true` | Combine parallel workers from the same spec file into a single test run. Does not persist across spec file batches — use the [Launcher Service](./wdio-launcher-service.md) for that |
| `timeout` | `number` | `30000` | API request timeout in ms |
| `maxRetries` | `number` | `3` | Retry attempts for failed requests |
| `verbose` | `boolean` | `false` | Enable debug logging |

## Run Name Placeholders

Customize your test run names with these placeholders:

| Placeholder | Description | Example |
| ------------- | ------------- | --------- |
| `{suite}` | Root suite name (first describe block) | `Login Tests` |
| `{spec}` | Spec file name (without extension) | `login` |
| `{date}` | Current date in ISO format | `2024-01-15` |
| `{time}` | Current time | `14:30:00` |
| `{browser}` | Browser name from capabilities | `chrome` |
| `{platform}` | Platform/OS name | `darwin`, `linux`, `win32` |

The default run name is `'{suite} - {date} {time}'`, which uses the root describe block name to identify your test runs.

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Default: '{suite} - {date} {time}'
      // Custom example:
      runName: 'E2E Tests - {browser} - {date} {time}',
    }]
  ],
};
```

## Appending to Existing Test Runs

Add results to an existing test run instead of creating a new one:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      testRunId: 456,  // Add results to this existing run
    }]
  ],
};
```

This is useful for:
- Aggregating results from multiple CI jobs
- Running tests in parallel across machines
- Re-running failed tests without creating new runs

## Associating with Configurations and Milestones

Track test results against specific configurations (browser/OS combinations) and milestones:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      configId: 5,      // e.g., "Chrome / macOS"
      milestoneId: 10,  // e.g., "Sprint 15"
      stateId: 2,       // e.g., "In Progress" workflow state
    }]
  ],
};
```

## Matching by a Custom Field

By default, the reporter resolves each test to a case by an **exact match** on name + suite (className) + source. Automated runs always create/match cases with `source: API`, so they can never attach to a manually-authored case (`source: MANUAL`) — even with an identical name.

`matchByCustomField` solves this for suites migrated from another tool, where each test title carries a **legacy external identifier** (e.g. an ID from your previous test manager) that was backfilled onto the migrated manual cases as a custom field. It resolves an existing case by that custom field value **before** the standard name/create flow:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      matchByCustomField: {
        fieldName: 'External ID',   // custom field display name to match on
        // idPattern: /^(\d+)/       // default: a bare leading number in the title
      },
      // Optional fallback: create cases for titles with no match.
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
    }]
  ],
};
```

Given a test titled:

```javascript
it("89434 Verify 'Relevance' is the default sort order for search results", () => { /* ... */ });
```

the reporter extracts `89434` with `idPattern`, looks up the case whose **External ID** custom field equals `89434`, and attaches the result **directly** to that case — regardless of its source (typically `MANUAL`). No new case, folder, or [case link](./wdio-test-cases.md) is created. If the matched case isn't already flagged **automated**, the reporter flips it (so a case that started manual but now receives automated results reflects that); it skips the write when the case is already automated.

### Options

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `fieldName` | `string` | *(required)* | Display name of the custom field to match on (e.g. `External ID`) |
| `idPattern` | `RegExp \| string` | `/^(\d+)/` | Pattern to extract the identifier from the title. The first capturing group (or the whole match) is looked up against `fieldName` |

### Behavior

- **Opt-in.** Omit `matchByCustomField` and resolution behaves exactly as before.
- **Runs first.** It is tried before name + className + source matching and before `autoCreateTestCases`.
- **Independent of `caseIdPattern`.** `caseIdPattern` treats the number it captures as a literal TestPlanIt case ID; `matchByCustomField` treats it as a value to look up. An explicit `caseIdPattern` match in the title still takes precedence.
- **Graceful fallthrough.** On no match — or if the named field doesn't exist on the project — the reporter falls through to the standard flow (name/create) without error. When `autoCreateTestCases` is off and nothing matches, the result is skipped, exactly as today.
- **Value matching.** The value is compared against the stored field value in both its number and string forms, so it works whether the field is an Integer/Number (stored as a number) or Text (stored as a string).
- **Marks the case automated.** A matched case that isn't already automated is flipped to `automated: true` (skipped when already automated, so there's no redundant write per run). This failing never aborts result reporting. The same flip now also applies when `autoCreateTestCases` *finds* an existing non-automated case by name.
