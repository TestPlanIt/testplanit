---
title: Run Attachments & Metadata
---

# Run Attachments & Metadata

Attach **links, files, and key/value metadata to the test run itself** — not to an individual test result — so they appear on the run detail page in TestPlanIt. Typical uses: the CI build that produced the run, a consolidated log or HTML report, the application version under test.

Two surfaces are available, and neither requires importing `@testplanit/api`:

- **Declarative options** on the [launcher service](./wdio-launcher-service.md) — applied exactly once, right after the run is created.
- **A runtime API** (`browser.testplanit`) — for values that aren't known until the tests run.

:::info Requires the launcher service
Both surfaces are provided by `TestPlanItService`. The declarative options run in the launcher process, and the runtime API resolves the run from the service's shared state — so all workers reach the same managed run. See [Launcher Service](./wdio-launcher-service.md) for setup.
:::

## Declarative Options

Set `runLinks`, `runAttachments`, and `runMetadata` on the service in `wdio.conf.js`:

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,

      // Clickable link attachments (e.g. the CI build that ran the tests)
      runLinks: [
        { url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' },
      ],

      // File attachments — logs, HTML reports, videos
      runAttachments: [
        { path: './logs/wdio.log' },
        { path: './reports/report.html', name: 'HTML Report' },
      ],

      // Key/value metadata rendered into the run's documentation
      runMetadata: {
        version: '{env:APP_VERSION}',
        triggeredBy: 'jenkins',
      },
    }]
  ],
};
```

### Environment placeholders

Every string value supports `{env:VAR}` placeholders resolved from `process.env` when the run is created. This lets CI values flow in without writing any hook code.

Entries that would be broken are **skipped with a logged warning** instead of being created:

- a link whose `url` references an unset (or empty) environment variable — e.g. `BUILD_URL` when running locally
- a metadata entry whose value resolves to nothing
- a file attachment whose `path` references an unset environment variable

### File attachments produced by the run

A `runAttachments` entry whose `path` doesn't exist yet when the run is created — typical for logs, reports, or videos generated **by** the tests — is not an error. The service retries it once after all workers finish, just before the run is completed. If the file still doesn't exist, it is skipped with a logged warning.

### Option reference

| Option | Type | Description |
| -------- | ------ | ------------- |
| `runLinks` | `RunLinkInput[]` | `{ url, name?, note? }` — rendered as clickable link attachments. `name` defaults to the URL |
| `runAttachments` | `RunAttachmentInput[]` | `{ path?, buffer?, name?, mimeType? }` — file attachments. `name` defaults to the file's basename (required with `buffer`); `mimeType` is guessed from the extension |
| `runMetadata` | `Record<string, string \| number \| boolean>` | Key/value pairs rendered as `**key:** value` lines in the run's documentation field |

:::note Failures never fail the run
All run-level operations log and swallow errors. A missing file, an unreachable server, or a bad URL can never fail your test run.
:::

## Runtime API (`browser.testplanit`)

The service installs a `testplanit` object on the WebdriverIO `browser` in every worker. Use it from any test or hook when the value isn't known until the tests run:

```javascript
// Attach a link
await browser.testplanit.attachToRun({ url: deployUrl, name: 'Deployed build' });

// Attach a file by path — name and MIME type derived from the file
await browser.testplanit.attachToRun({ path: './output/diff.png' });

// Attach in-memory content — name is required
await browser.testplanit.attachToRun({ buffer: pdfBuffer, name: 'summary.pdf' });

// Merge metadata into the run's documentation
await browser.testplanit.setRunMetadata({ seed: usedSeed, shard: shardIndex });

// The managed run's ID, if you need it
const runId = browser.testplanit.getRunId();
```

Every call resolves the run from the service's shared state, so it reaches the **single managed run regardless of which worker calls it**. Calls never throw — on failure they log the error and resolve to `null` (`attachToRun`) or `false` (`setRunMetadata`).

TypeScript users get full types on `browser.testplanit` automatically — the package augments the `WebdriverIO.Browser` interface. The API's shape is exported as `TestPlanItRuntimeApi`.

## How Metadata Is Stored

Metadata is rendered into the run's **documentation** field as one line per entry:

> **version:** 1.2.3
> **triggeredBy:** jenkins

Repeated `setRunMetadata` calls (and the declarative `runMetadata` option) **merge**: existing keys are updated in place, new keys are appended, and any hand-written documentation content around them is preserved.

:::note Concurrent metadata writes
The merge is read-modify-write on the run's documentation. Simultaneous `setRunMetadata` calls from different workers can race (last write wins) — set unrelated keys from a single place, or serialize the calls.
:::

## Using the API Client Directly

Outside WebdriverIO — or in custom tooling — the same operations are public methods on `TestPlanItClient`: `addTestRunLink`, `uploadTestRunAttachment`, `setTestRunMetadata`, and `getTestRunMetadata`. See the [API Client reference](./api-client.md#run-level-attachments--metadata). Using Playwright? The same feature exists there too: [Run Attachments & Metadata](./playwright-run-attachments.md).
