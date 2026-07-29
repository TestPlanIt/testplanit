# @testplanit/playwright-reporter

Playwright reporter for [TestPlanIt](https://github.com/testplanit/testplanit) - report test results directly to your TestPlanIt instance.

This is the Playwright counterpart to [`@testplanit/wdio-reporter`](https://github.com/testplanit/testplanit/tree/main/packages/wdio-testplanit-reporter). Because Playwright runs the reporter in a single main process (and forwards events from every worker to it), there is **no separate launcher service** and no `oneReport` coordination to configure — one reporter instance sees every result and reports it to a single test run.

## Installation

```bash
npm install --save-dev @testplanit/playwright-reporter
# or
pnpm add -D @testplanit/playwright-reporter
# or
yarn add -D @testplanit/playwright-reporter
```

## Quick Start

### 1. Generate an API Token

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (it starts with `tpi_`)

### 2. Add the reporter to your Playwright config

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'], // keep your existing reporters
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
    }],
  ],
});
```

Playwright supports multiple reporters at once, so you can keep `list`, `html`, or `junit` alongside this one.

## Linking Test Cases

Embed TestPlanIt case IDs in your test titles using brackets (configurable via `caseIdPattern`):

```typescript
import { test } from '@playwright/test';

test.describe('Authentication', () => {
  test('[12345] should login with valid credentials', async ({ page }) => {
    // Linked to case ID 12345
  });

  test('[12346] [12347] should show an error for invalid password', async ({ page }) => {
    // Linked to multiple cases: 12346 and 12347
  });

  test('should redirect to the dashboard', async ({ page }) => {
    // No case ID — skipped unless autoCreateTestCases is enabled
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regex with a capturing group for the numeric ID:

```typescript
caseIdPattern: /\[(\d+)\]/g  // Default — brackets:  "[12345] should work"
caseIdPattern: /C(\d+)/g      // C-prefix:           "C12345 should work"
caseIdPattern: /TC-(\d+)/g    // TC- prefix:         "TC-12345 should work"
caseIdPattern: /TEST-(\d+)/g  // JIRA-style:         "TEST-12345 should work"
```

## Reporter Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `testRunId` | `number \| string` | No | `$TESTPLANIT_RUN_ID` | Existing test run ID or name to append results to. Never created or completed by the reporter — see [Sharing One Run Across Shards, Machines or Retries](#sharing-one-run-across-shards-machines-or-retries) |
| `runName` | `string` | No | `'{suite} - {date} {time}'` | Name for new test runs. Placeholders: `{date}`, `{time}`, `{browser}` (project name), `{platform}`, `{spec}`, `{shard}`, `{suite}` |
| `testSuiteName` | `string` | No | `runName` | Name of the JUnit suite created for this execution. Same placeholders as `runName`. Defaults to `'{suite} - {browser}/{platform} - {spec}'` when the run is externally managed |
| `testRunType` | `string` | No | `'JUNIT'` | Test framework type stored on the run |
| `configId` | `number \| string` | No | - | Configuration ID or name for the test run |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name for the test run |
| `stateId` | `number \| string` | No | - | Workflow state ID or name for the test run |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names). Non-existent tags are created automatically |
| `caseIdPattern` | `RegExp \| string` | No | `/\[(\d+)\]/g` | Regex to extract case IDs from test titles. Must include a capturing group |
| `autoCreateTestCases` | `boolean` | No | `false` | Auto-create test cases matched by describe path + test title |
| `captureSteps` | `boolean` | No | `true` | Capture `test.step()` calls as authored steps on newly created cases (nested steps flattened, in order, prefixed by depth). Requires `autoCreateTestCases`; applies only to created cases — existing cases are never modified |
| `overwriteSteps` | `boolean` | No | `false` | Overwrite an **existing** case's steps with the captured `test.step()` calls every run (linked-by-ID and auto-matched cases), keeping the case in sync as the script changes. **Destructive** — discards manual step edits. A test with no `test.step()` calls never clears existing steps |
| `createFolderHierarchy` | `boolean` | No | `false` | Create nested folders from `test.describe` structure. Requires `autoCreateTestCases` and `parentFolderId` |
| `parentFolderId` | `number \| string` | No | - | Parent folder for auto-created cases (ID or name) |
| `templateId` | `number \| string` | No | - | Template for auto-created cases (ID or name) |
| `uploadAttachments` | `boolean` | No | `true` | Upload Playwright attachments (screenshots, videos, traces) to the result |
| `attachmentTypes` | `string[]` | No | all | Restrict which attachments upload. Matches the attachment `name` or a `contentType` prefix, e.g. `['image/']` for screenshots only |
| `runLinks` | `RunLinkInput[]` | No | - | Links to attach to the run (e.g. CI build URL). Supports `{env:VAR}` — see [Run-Level Attachments](#run-level-attachments-and-metadata) |
| `runAttachments` | `RunAttachmentInput[]` | No | - | Files to attach to the run (logs, reports, videos). Supports `{env:VAR}` |
| `runMetadata` | `Record<string, string \| number \| boolean>` | No | - | Key/value metadata rendered into the run's documentation. Supports `{env:VAR}` |
| `includeStackTrace` | `boolean` | No | `true` | Include stack traces in results |
| `excludeSkipped` | `boolean` | No | `false` | Don't report skipped tests to TestPlanIt |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark the test run as completed when the run finishes |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed API requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Tip:** Options like `configId`, `milestoneId`, `stateId`, `parentFolderId`, and `templateId` accept either numeric IDs or string names. When a string is provided, the resource is looked up by exact name match.

## Attachments

Playwright collects screenshots, videos, and traces automatically based on your `use` settings:

```typescript
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
});
```

Every attachment on a test result — including anything you add with `testInfo.attach()` — is uploaded to the corresponding JUnit result. To limit uploads, set `attachmentTypes`:

```typescript
// Screenshots only (matches the WebdriverIO reporter's behaviour)
attachmentTypes: ['image/']

// Screenshots and videos, but not traces
attachmentTypes: ['image/', 'video/']
```

## Run-Level Attachments and Metadata

Attach links, files, and metadata to the **test run itself** (not to individual
results) — they show up on the run detail page. No `@testplanit/api` import
needed.

### Declarative (playwright.config)

Applied exactly once, right after the reporter creates the run. Every string
value supports `{env:VAR}` placeholders resolved from `process.env`:

```typescript
reporter: [
  ['@testplanit/playwright-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,

    // Clickable link attachments (e.g. the CI build that ran the tests)
    runLinks: [
      { url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' },
    ],

    // File attachments. A path that can't be read yet (an artifact produced
    // by the tests) is retried once after all tests finish.
    runAttachments: [
      { path: './playwright-report/index.html', name: 'HTML Report' },
    ],

    // Key/value metadata, rendered as "**key:** value" lines in the run's
    // documentation field
    runMetadata: {
      version: '{env:APP_VERSION}',
      triggeredBy: 'jenkins',
    },
  }],
],
```

Skip rules: a link whose `url` references an unset environment variable is
skipped (no broken links), as is a metadata entry whose value resolves to
nothing. All failures are logged and swallowed — run-level attachments never
fail the test run. Declarative options only apply when the reporter **creates**
the run; when appending to an existing run via `testRunId` they are skipped so
re-runs don't attach duplicates.

### Runtime helpers (`attachToRun` / `setRunMetadata`)

For values that aren't known until the tests run. The helpers ride Playwright's
attachment transport (reserved `testplanit:run-*` attachment names) from the
test worker to the reporter, which applies them to the run — they are never
uploaded to the test's own result:

```typescript
import { test } from '@playwright/test';
import { attachToRun, setRunMetadata } from '@testplanit/playwright-reporter';

test('deploys the build', async ({ page }, testInfo) => {
  // Attach a link
  await attachToRun(testInfo, { url: deployUrl, name: 'Deployed build' });

  // Attach a file by path (name + MIME type derived from the file)…
  await attachToRun(testInfo, { path: './output/diff.png' });

  // …or from an in-memory buffer (name required)
  await attachToRun(testInfo, { buffer: pdfBuffer, name: 'summary.pdf' });

  // Merge metadata into the run's documentation
  await setRunMetadata(testInfo, { seed: usedSeed, shard: shardIndex });
});
```

Identical operations are deduped per session (links by URL + name, files by
display name, metadata by content), so retried tests don't create duplicate
run attachments. Failures are logged and swallowed — they never fail your
tests.

Repeated `setRunMetadata` calls merge: existing keys are updated in place, new
keys are appended, and hand-written content in the run's documentation is
preserved.

## Sharing One Run Across Shards, Machines or Retries

Each Playwright execution runs its own reporter process, so `--shard=1/5` across
five machines — or a rerun of the failures afterwards — creates five or six
separate test runs, all named the same thing.

To collect them in one run, create the run in the pipeline and let every
execution attach to it:

```bash
RUN_ID=$(testplanit run create --project 9 --name "E2E - DEV #984" --type JUNIT)
export TESTPLANIT_RUN_ID="$RUN_ID"

# Every shard, machine and retry wave attaches to $TESTPLANIT_RUN_ID
npx playwright test --shard=1/5
npx playwright test --shard=2/5
# ...on other machines, plus any reruns...

testplanit run complete --id "$RUN_ID"
```

`testplanit` is the [`@testplanit/cli`](https://www.npmjs.com/package/@testplanit/cli)
package (`npm i -g @testplanit/cli`). It reads `TESTPLANIT_URL` and
`TESTPLANIT_API_TOKEN`, or credentials stored once with
`testplanit config set --url ... --token ...`; run `testplanit run --help` for
the full list of options. No reporter config has to change — the env var is
enough.

### What Changes When a Run Is Externally Managed

A run supplied through `TESTPLANIT_RUN_ID` or the `testRunId` option is
externally managed. For such a run the reporter:

- **Never creates a run.** If the run cannot be read, the failure is logged and
  results are still attached to the given ID rather than to a replacement run.
- **Never completes it**, regardless of `completeRunOnFinish` — the pipeline
  closes it with `testplanit run complete` once every execution has finished. A shard that
  completed the run would push the ones behind it onto a new run.
- **Never changes its settings.** `configId`, `milestoneId`, `stateId` and
  `tagIds` are ignored, since those belong to whoever created the run. Case
  creation options (`parentFolderId`, `templateId`, and the rest) still apply.
- **Never applies `runLinks` or `runMetadata`**, which describe the run as a
  whole — every shard would otherwise attach duplicates.

### Suites Within the Run

Each execution creates its own JUnit suite under the shared run, named
`{suite} - {browser}/{platform} - {spec}` by default. Results roll up at the run
level across every suite. When sharding, `{shard}` is the precise label —
it resolves to Playwright's own `--shard` value:

```typescript
['@testplanit/playwright-reporter', {
  // ...
  testSuiteName: 'Shard {shard} - {browser}',   // "Shard 2/5 - chromium"
}]
```

`{shard}` resolves to `1/1` when running without `--shard`.

### Resolution Order

The first of these that yields a run wins:

1. `testRunId` given as a number
2. `TESTPLANIT_RUN_ID` (ignored unless it is a positive integer, so an
   unresolved shell variable falls through instead of failing)
3. `testRunId` given as a name, looked up by exact match
4. a new run

Options 1–3 are externally managed. With none of them set, behaviour is
unchanged: the run is created and completed as before.

## Retries

Playwright calls the reporter once per retry attempt. **Each attempt is reported as its own result**, so a test that fails and then passes on retry produces both a `FAILURE` and a `PASSED` result against the same case — giving you the full attempt history. The case is added to the run only once.

## Examples

### Auto-Create Test Cases with Folder Hierarchy

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  autoCreateTestCases: true,
  createFolderHierarchy: true,
  parentFolderId: 'Automated Tests',
  templateId: 'Default Template',
}]
```

With `createFolderHierarchy`, nested `test.describe` blocks create matching folders:

```typescript
test.describe('Authentication', () => {        // Folder: Automated Tests > Authentication
  test.describe('Login', () => {               // Folder: Automated Tests > Authentication > Login
    test('should accept valid credentials');   // Case placed in the Login folder
  });
});
```

### Append to an Existing Test Run

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  testRunId: 123,            // by ID
  // testRunId: 'Nightly',   // …or by name
}]
```

### Environment-Based Configuration

```typescript
['@testplanit/playwright-reporter', {
  domain: process.env.TESTPLANIT_URL,
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
  runName: `CI Build ${process.env.GITHUB_RUN_NUMBER} - ${process.env.GITHUB_REF_NAME}`,
  milestoneId: process.env.TESTPLANIT_MILESTONE_ID,
}]
```

## Output

When the run completes, the reporter prints a summary:

```console
[TestPlanIt] ═══════════════════════════════════════════════════════
[TestPlanIt] Results Summary
[TestPlanIt] ═══════════════════════════════════════════════════════
[TestPlanIt]   Test Run ID: 456
[TestPlanIt]   Duration: 12.4s
[TestPlanIt]
[TestPlanIt]   Test Results:
[TestPlanIt]     ✓ Passed:  18
[TestPlanIt]     ✗ Failed:  2
[TestPlanIt]     ○ Skipped: 1
[TestPlanIt]     Total:     21
[TestPlanIt]
[TestPlanIt]   View results: https://testplanit.example.com/projects/runs/1/456
[TestPlanIt] ═══════════════════════════════════════════════════════
```

## Error Handling

- Reporter errors are logged but never fail your test suite
- Failed API requests are retried (configurable via `maxRetries`)
- A failure on one result doesn't stop other results from being reported
- Tests without a case ID are skipped with a warning unless `autoCreateTestCases` is enabled

## Compatibility

| Playwright Version | Supported |
| ------------------ | --------- |
| 1.44+ | Yes |

Requires `@playwright/test` 1.44 or later (the reporter uses the `Suite.type` API) and Node.js 20 or later.

## Related Packages

- [@testplanit/api](https://github.com/TestPlanIt/testplanit/tree/main/packages/api) - The underlying API client used by this reporter
- [@testplanit/wdio-reporter](https://github.com/TestPlanIt/testplanit/tree/main/packages/wdio-testplanit-reporter) - The WebdriverIO equivalent

## License

MIT
