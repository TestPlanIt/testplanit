---
title: Run Attachments & Metadata
---

# Run Attachments & Metadata

Attach **links, files, and key/value metadata to the test run itself** — not to an individual test result — so they appear on the run detail page in TestPlanIt. Typical uses: the CI build that produced the run, a consolidated HTML report, the application version under test.

Two surfaces are available, and neither requires importing `@testplanit/api`:

- **Declarative options** on the reporter — applied exactly once, right after the reporter creates the run.
- **Runtime helpers** (`attachToRun` / `setRunMetadata`) — for values that aren't known until the tests run.

:::info Result attachments are separate
This page is about attachments on the **run**. For screenshots, videos, and traces uploaded to each test's **result**, see [Attachment Uploads](./playwright-attachments.md).
:::

## Declarative Options

Set `runLinks`, `runAttachments`, and `runMetadata` on the reporter in `playwright.config.ts`:

```typescript
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,

      // Clickable link attachments (e.g. the CI build that ran the tests)
      runLinks: [
        { url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' },
      ],

      // File attachments — logs, HTML reports, videos
      runAttachments: [
        { path: './playwright-report/index.html', name: 'HTML Report' },
      ],

      // Key/value metadata rendered into the run's documentation
      runMetadata: {
        version: '{env:APP_VERSION}',
        triggeredBy: 'jenkins',
      },
    }],
  ],
});
```

### Environment placeholders

Every string value supports `{env:VAR}` placeholders resolved from `process.env` when the run is created, so CI values flow in without any hook code.

Entries that would be broken are **skipped with a logged warning** instead of being created:

- a link whose `url` references an unset (or empty) environment variable — e.g. `BUILD_URL` when running locally
- a metadata entry whose value resolves to nothing
- a file attachment whose `path` references an unset environment variable

### File attachments produced by the run

A `runAttachments` entry whose `path` can't be read yet when the run is created — typical for reports generated **by** the tests — is not an error. The reporter retries it once after all tests finish, just before the run is completed. If it still can't be read, it is skipped with a logged warning.

### Appending to an existing run

Declarative run-level options only apply when the reporter **creates** the run. When appending to an existing run via `testRunId`, they are skipped — otherwise every re-run would attach the same links again. The runtime helpers below work in both modes.

### Option reference

| Option | Type | Description |
| -------- | ------ | ------------- |
| `runLinks` | `RunLinkInput[]` | `{ url, name?, note? }` — rendered as clickable link attachments. `name` defaults to the URL |
| `runAttachments` | `RunAttachmentInput[]` | `{ path?, buffer?, name?, mimeType? }` — file attachments. `name` defaults to the file's basename (required with `buffer`); `mimeType` is guessed from the extension |
| `runMetadata` | `Record<string, string \| number \| boolean>` | Key/value pairs rendered as `**key:** value` lines in the run's documentation field |

:::note Failures never fail the run
All run-level operations log and swallow errors. A missing file, an unreachable server, or a bad URL can never fail your test run.
:::

## Runtime Helpers (`attachToRun` / `setRunMetadata`)

Playwright runs the reporter in the main process while tests run in workers, so the helpers ship the request through Playwright's own attachment transport: they call `testInfo.attach()` with a reserved `testplanit:run-*` name, and the reporter intercepts those attachments and routes them to run-level API calls. They are **never uploaded to the test's own result**.

```typescript
import { test } from '@playwright/test';
import { attachToRun, setRunMetadata } from '@testplanit/playwright-reporter';

test('deploys the build', async ({ page }, testInfo) => {
  // Attach a link
  await attachToRun(testInfo, { url: deployUrl, name: 'Deployed build' });

  // Attach a file by path — name and MIME type derived from the file
  await attachToRun(testInfo, { path: './output/diff.png' });

  // Attach in-memory content — name is required
  await attachToRun(testInfo, { buffer: pdfBuffer, name: 'summary.pdf' });

  // Merge metadata into the run's documentation
  await setRunMetadata(testInfo, { seed: usedSeed, shard: shardIndex });
});
```

They also work from fixtures and hooks — anywhere a `testInfo` object is available.

Identical operations are **deduped per session** — links by URL + name, files by display name, metadata by content — so a retried test that re-runs its `attachToRun` calls doesn't create duplicate run attachments. Failures are logged and swallowed; they never fail your tests.

:::note Reserved attachment names
Attachment names starting with `testplanit:run-` are reserved for this transport and are always intercepted by the reporter. Don't use that prefix for regular `testInfo.attach()` calls.
:::

## How Metadata Is Stored

Metadata is rendered into the run's **documentation** field as one line per entry:

> **version:** 1.2.3
> **triggeredBy:** jenkins

Repeated `setRunMetadata` calls (and the declarative `runMetadata` option) **merge**: existing keys are updated in place, new keys are appended, and any hand-written documentation content around them is preserved.

## Using the API Client Directly

Outside Playwright — or in custom tooling — the same operations are public methods on `TestPlanItClient`: `addTestRunLink`, `uploadTestRunAttachment`, `setTestRunMetadata`, and `getTestRunMetadata`. See the [API Client reference](./api-client.md#run-level-attachments--metadata). Using WebdriverIO? The same feature exists there too: [Run Attachments & Metadata](./wdio-run-attachments.md).
