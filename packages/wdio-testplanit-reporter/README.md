# @testplanit/wdio-reporter

WebdriverIO reporter and service for [TestPlanIt](https://github.com/testplanit/testplanit) - report test results directly to your TestPlanIt instance.

This package includes:

- **Reporter** - Tracks test execution in worker processes and reports results to TestPlanIt
- **Service** - Manages the test run lifecycle in the main process, ensuring all workers report to a single test run

## Installation

```bash
npm install @testplanit/wdio-reporter
# or
pnpm add @testplanit/wdio-reporter
# or
yarn add @testplanit/wdio-reporter
```

## Quick Start

### 1. Generate an API Token

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (it starts with `tpi_`)

### 2. Configure the Reporter and Service

Add both the service and reporter to your `wdio.conf.js` or `wdio.conf.ts`:

```javascript
// wdio.conf.js
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
      captureScreenshots: true,
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }]
  ],
  // ... rest of config
}
```

> **Note:** The service is recommended when running with `maxInstances > 1`. It creates a single test run before workers start, eliminating race conditions. Without the service, the reporter can still manage test runs on its own using file-based coordination (`oneReport: true`).

## Service vs Reporter

| Aspect | Service | Reporter |
| -------- | --------- | --------- |
| **Process** | Main WDIO process | Each worker process |
| **Timing** | Runs once before/after all workers | Runs in each worker |
| **Test run creation** | Creates in `onPrepare` | Fallback: creates if no service |
| **Result reporting** | - | Reports each test result |
| **Screenshot capture** | Optional (`captureScreenshots`) | - |
| **Screenshot upload** | - | Uploads in `onRunnerEnd` |
| **Run completion** | Completes in `onComplete` | Skips if service-managed |

## Sharing One Run Across Sharded, Parallel or Retried Executions

The service and `oneReport` both collapse a single WebdriverIO execution into one
test run. Neither spans separate executions: their shared state lives in a file
in the OS temp directory, so it cannot reach a second CI agent, and it is reset
once a run's workers have all finished. A suite split into shards, spread across
agents, or rerun in retry waves therefore produces one run per invocation — often
several runs with the same name.

To collect all of them in a single run, create the run in the pipeline and let
every invocation attach to it:

```bash
RUN_ID=$(testplanit create-run --project 9 --name "Web Regression Tests - DEV #984" --type MOCHA)
export TESTPLANIT_RUN_ID="$RUN_ID"

# Every shard, agent and retry wave attaches to $TESTPLANIT_RUN_ID
pnpm web:bs --spec ./test/specs/shard-1/**
pnpm web:bs --spec ./test/specs/shard-2/**
# ...deferred retries, other agents...

testplanit complete-run --id "$RUN_ID"
```

`testplanit` ships with [`@testplanit/api`](https://www.npmjs.com/package/@testplanit/api).
Both commands read `TESTPLANIT_URL` and `TESTPLANIT_API_TOKEN`; run
`testplanit --help` for the full list.

Nothing else in the config has to change. Both the service and the reporter read
`TESTPLANIT_RUN_ID`, so the recommended service + reporter setup works as-is —
the service reports into the pinned run instead of creating one in `onPrepare`,
and leaves it open in `onComplete`.

### What Changes When a Run Is Externally Managed

A run supplied through `TESTPLANIT_RUN_ID` or the `testRunId` option is
externally managed. For such a run the reporter:

- **Never creates a run.** If the run cannot be read, the failure is logged and
  results are still attached to the given ID rather than to a replacement run.
- **Never completes it**, regardless of `completeRunOnFinish` — the pipeline
  closes it with `complete-run` once every invocation has finished. A shard that
  completed the run would push the ones behind it onto a new run.
- **Never discards it.** The recovery paths that start a fresh run when the
  shared state is exhausted, completed or deleted do not apply.
- **Never changes its settings.** `configId`, `milestoneId`, `stateId` and
  `tagIds` are ignored, since those belong to whoever created the run. Case
  creation options (`parentFolderId`, `templateId`, and the rest) still apply.

The service behaves the same way, with one addition: `runLinks` and `runMetadata`
describe the run as a whole, so it applies them only to runs it created —
otherwise every shard would duplicate the links and the last one would overwrite
the metadata. `runAttachments` are per-execution artifacts and still upload from
each shard.

### Suites Within the Run

Each execution creates its own JUnit suite under the shared run, named
`{suite} - {browser}/{platform} - {spec}` by default so shards are
distinguishable. Results roll up at the run level across every suite. Override
the naming with `testSuiteName`, which accepts the same placeholders as
`runName`. The service's launcher process runs before any browser exists, so its
`testSuiteName` also resolves `{env:VAR}` — name shards from the pipeline, for
example `testSuiteName: 'Shard {env:SHARD_ID}'`.

### Resolution Order

The first of these that yields a run wins:

1. `testRunId` given as a number
2. `TESTPLANIT_RUN_ID` (ignored unless it is a positive integer, so an
   unresolved shell variable falls through instead of failing)
3. `testRunId` given as a name, looked up by exact match
4. the `oneReport` shared-state file
5. a new run

Options 1–3 are externally managed. With none of them set, behaviour is
unchanged: `oneReport` still dedupes workers within one execution, and the run is
created and completed as before.

## Linking Test Cases

Embed TestPlanIt case IDs in your test titles using brackets (configurable via `caseIdPattern`):

```javascript
describe('Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // This test will be linked to case ID 12345
  });

  it('[12346] [12347] should show error for invalid password', async () => {
    // This test will be linked to multiple cases: 12346 and 12347
  });

  it('should redirect to dashboard after login', async () => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regex with a capturing group for the numeric ID:

```javascript
// Default: brackets - "[12345] should work"
caseIdPattern: /\[(\d+)\]/g

// C-prefix: "C12345 should work"
caseIdPattern: /C(\d+)/g

// TC- prefix: "TC-12345 should work"
caseIdPattern: /TC-(\d+)/g

// JIRA-style: "TEST-12345 should work"
caseIdPattern: /TEST-(\d+)/g
```

### Matching Cases by a Custom Field

`caseIdPattern` treats the number it captures as a **literal TestPlanIt case ID**. If your titles instead carry a **legacy external identifier** — e.g. an ID left over from a previous test manager — that was backfilled onto your migrated cases as a custom field, use `matchByCustomField` to resolve the existing case by that field's value:

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    matchByCustomField: {
      fieldName: 'External ID',   // custom field display name
      // idPattern: /^(\d+)/       // default: bare leading number in the title
    },
    // Optional fallback for titles with no match:
    autoCreateTestCases: true,
    parentFolderId: 10,
    templateId: 1,
  }]
]
```

For a test titled `"89434 Verify 'Relevance' is the default sort order"`, the reporter extracts `89434`, finds the case whose **External ID** field equals `89434`, and attaches the result **directly** to that case — regardless of its source (typically `MANUAL`). No new case or link is created. If that case isn't already flagged automated, the reporter flips it to automated (skipping the write when it already is).

This strategy is opt-in and runs **before** name/create resolution. On no match — or if the field doesn't exist on the project — it falls through to the standard flow without error. It is independent of `caseIdPattern`; an explicit `caseIdPattern` match still takes precedence.

## Reporter Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `testRunId` | `number \| string` | No | `$TESTPLANIT_RUN_ID` | Existing test run ID or name to append results to. A run supplied here is never created or completed by the reporter — see [Sharing One Run Across Sharded, Parallel or Retried Executions](#sharing-one-run-across-sharded-parallel-or-retried-executions) |
| `runName` | `string` | No | `'{suite} - {date} {time}'` | Name for new test runs. Supports placeholders: `{date}`, `{time}`, `{browser}`, `{platform}`, `{spec}`, `{suite}` |
| `testSuiteName` | `string` | No | `runName` | Name of the JUnit suite created for this invocation. Same placeholders as `runName`. Defaults to `'{suite} - {browser}/{platform} - {spec}'` when the run is externally managed |
| `testRunType` | `string` | No | Auto-detected | Test framework type: `'REGULAR'`, `'MOCHA'`, `'CUCUMBER'`, etc. Auto-detected from WDIO config |
| `configId` | `number \| string` | No | - | Configuration ID or name for the test run |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name for the test run |
| `stateId` | `number \| string` | No | - | Workflow state ID or name for the test run |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names). Non-existent tags are created automatically |
| `caseIdPattern` | `RegExp \| string` | No | `/\[(\d+)\]/g` | Regex to extract case IDs from test titles. Must include a capturing group |
| `matchByCustomField` | `{ fieldName: string; idPattern?: RegExp \| string }` | No | - | Resolve an existing case by a custom field value parsed from the title (default `idPattern`: `/^(\d+)/`), before the name/create fallback. See [Matching Cases by a Custom Field](#matching-cases-by-a-custom-field) |
| `autoCreateTestCases` | `boolean` | No | `false` | Auto-create test cases matched by suite name + test title |
| `captureSteps` | `boolean` | No | `true` | Capture a Cucumber scenario's Given/When/Then as the case's Steps. Cucumber only; silent no-op for Mocha/Jasmine |
| `overwriteSteps` | `boolean` | No | `false` | Replace an existing Cucumber case's steps on each run (destructive: discards manual edits). Cucumber only |
| `createFolderHierarchy` | `boolean` | No | `false` | Create nested folders based on suite structure. Requires `autoCreateTestCases` and `parentFolderId` |
| `parentFolderId` | `number \| string` | No | - | Parent folder for auto-created cases (ID or name) |
| `templateId` | `number \| string` | No | - | Template for auto-created cases (ID or name) |
| `uploadScreenshots` | `boolean` | No | `true` | Upload intercepted screenshots |
| `includeStackTrace` | `boolean` | No | `true` | Include stack traces in results |
| `excludeSkipped` | `boolean` | No | `false` | Don't report skipped tests to TestPlanIt |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark test run as completed when done |
| `oneReport` | `boolean` | No | `true` | Combine parallel workers from the same spec file into a single test run. Does not persist across spec file batches — use the service for that |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Tip:** Options like `configId`, `milestoneId`, `stateId`, `parentFolderId`, and `templateId` accept either numeric IDs or string names. When a string is provided, the system looks up the resource by exact name match.

## Capturing Gherkin Steps as Case Steps

When you run with [`@wdio/cucumber-framework`](https://webdriver.io/docs/frameworks/#using-cucumber) and `autoCreateTestCases: true`, the reporter creates **one case per scenario** and (with `captureSteps: true`, the default) writes the scenario's Gherkin steps as the case's **Steps**:

- **`Given`** → a Precondition (leading step, no expected result)
- **`When`** → a Step (action)
- **`Then`** → the **Expected Result** of the preceding `When` step
- **`And` / `But` / `*`** inherit the role of the nearest preceding primary keyword

This uses the same mapping as the TestPlanIt result importer, so a Cucumber scenario yields the **same** case Steps whether it is imported or reported via WDIO.

```javascript
// wdio.conf.js
export const config = {
  framework: 'cucumber', // scenarioLevelReporter must be false (the default)
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
      captureSteps: true,      // default — capture Given/When/Then as Steps
      overwriteSteps: false,   // set true to re-sync steps every run (destructive)
    }]
  ]
}
```

`overwriteSteps: true` soft-deletes a case's existing steps and rewrites them from the scenario every run — **destructive**: any manual edits are discarded. As a safeguard, a scenario with no steps never clears existing steps. Leave it `false` (the default) to never overwrite human-edited steps.

### Limitations

- **Mocha and Jasmine produce no deterministic steps.** They have no native step structure, so `captureSteps`/`overwriteSteps` are silent no-ops for those frameworks (the reporter logs a one-time notice). If an LLM provider is configured for the project, TestPlanIt's LLM enrichment can derive steps for these cases automatically — configuring a provider is the opt-in; no extra reporter option is needed.
- **`scenarioLevelReporter: true` is not supported for step capture.** In that Cucumber mode the framework suppresses per-step events, so the reporter cannot see the individual Gherkin steps. Use the default `scenarioLevelReporter: false` to capture steps.

## Service Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `testRunId` | `number` | No | `$TESTPLANIT_RUN_ID` | Existing test run to report into. Never created or completed by the service — see [Sharing One Run Across Sharded, Parallel or Retried Executions](#sharing-one-run-across-sharded-parallel-or-retried-executions) |
| `runName` | `string` | No | `'Automated Tests - {date} {time}'` | Name for the test run. Supports `{date}`, `{time}`, `{platform}` |
| `testSuiteName` | `string` | No | `runName` | Name of the JUnit suite created for this execution. Same placeholders as `runName`, plus `{env:VAR}` |
| `testRunType` | `string` | No | `'MOCHA'` | Test framework type |
| `configId` | `number \| string` | No | - | Configuration ID or name |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name |
| `stateId` | `number \| string` | No | - | Workflow state ID or name |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names) |
| `captureScreenshots` | `boolean` | No | `false` | Auto-capture screenshots on test failure via `afterTest` hook |
| `runLinks` | `RunLinkInput[]` | No | - | Links to attach to the run (e.g. CI build URL). Supports `{env:VAR}` |
| `runAttachments` | `RunAttachmentInput[]` | No | - | Files to attach to the run (logs, reports, videos). Supports `{env:VAR}` |
| `runMetadata` | `Record<string, string \| number \| boolean>` | No | - | Key/value metadata rendered into the run's documentation. Supports `{env:VAR}` |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark test run as completed when all workers finish |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Note:** The service's `runName` does not support `{browser}`, `{spec}`, or `{suite}` placeholders since it runs before any workers start.

## Run-Level Attachments and Metadata

Attach links, files, and metadata to the **test run itself** (not to individual
results) — they show up on the run detail page in TestPlanIt. Both a declarative
config surface and a runtime API are available; neither requires importing
`@testplanit/api`.

### Declarative (wdio.conf)

Applied exactly once by the service right after the run is created. Every string
value supports `{env:VAR}` placeholders resolved from `process.env`:

```javascript
services: [
  [TestPlanItService, {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,

    // Clickable link attachments (e.g. the CI build that ran the tests)
    runLinks: [
      { url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' },
    ],

    // File attachments. A path that doesn't exist yet (an artifact produced
    // by the tests) is retried once after all workers finish.
    runAttachments: [
      { path: './logs/wdio.log' },
      { path: './reports/report.html', name: 'HTML Report' },
    ],

    // Key/value metadata, rendered as "**key:** value" lines in the run's
    // documentation field
    runMetadata: {
      version: '{env:APP_VERSION}',
      triggeredBy: 'jenkins',
    },
  }]
],
```

Skip rules: a link whose `url` references an unset environment variable is
skipped (no broken links), as is a metadata entry whose value resolves to
nothing. All failures are logged and swallowed — run-level attachments never
fail the test run.

### Runtime API (`browser.testplanit`)

For values that aren't known until the tests run. The service installs a
`testplanit` object on the WebdriverIO `browser` in every worker; all calls
resolve to the single service-managed run no matter which worker makes them:

```javascript
// In a test or hook (e.g. wdio.conf onPrepare is NOT needed — any worker works)
await browser.testplanit.attachToRun({ url: deployUrl, name: 'Deployed build' });

// Attach a file by path (name + MIME type derived from the file)…
await browser.testplanit.attachToRun({ path: './output/diff.png' });

// …or from an in-memory buffer (name required)
await browser.testplanit.attachToRun({ buffer: pdfBuffer, name: 'summary.pdf' });

// Merge metadata into the run's documentation
await browser.testplanit.setRunMetadata({ seed: usedSeed, shard: shardIndex });

// The managed run's ID, if you need it
const runId = browser.testplanit.getRunId();
```

Runtime calls never throw — failures are logged and the call resolves to
`null`/`false`, so an attachment problem can't fail your tests. The runtime API
requires the `TestPlanItService` (it resolves the run from the service's shared
state).

Repeated `setRunMetadata` calls merge: existing keys are updated in place, new
keys are appended, and hand-written content in the run's documentation is
preserved. Note the merge is read-modify-write, so simultaneous calls from
different workers can race — set unrelated keys or serialize the calls.

## Examples

### Recommended: Service + Reporter (Multi-Worker)

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  maxInstances: 5,
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
      captureScreenshots: true,
      milestoneId: 'Sprint 42',
      tagIds: ['regression', 'automated'],
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      createFolderHierarchy: true,
      parentFolderId: 'Automated Tests',
      templateId: 1,
    }]
  ],
}
```

### Reporter Only (Single Worker)

```javascript
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {browser} - {date}',
      configId: 1,
      milestoneId: 2,
    }]
  ],
}
```

### Append to Existing Test Run

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    testRunId: 123, // Existing run ID
  }]
]
```

You can also reference a test run by name:

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    testRunId: 'Nightly Regression', // Looked up by name
  }]
]
```

Or leave it out of the config entirely and set `TESTPLANIT_RUN_ID` in the
environment, which is what lets several invocations share one run. Either way
the reporter appends to the run without completing it — see
[Sharing One Run Across Sharded, Parallel or Retried Executions](#sharing-one-run-across-sharded-parallel-or-retried-executions).

### Auto-Create Test Cases with Folder Hierarchy

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    autoCreateTestCases: true,
    createFolderHierarchy: true,
    parentFolderId: 'Automated Tests',
    templateId: 'Default Template',
  }]
]
```

With `createFolderHierarchy`, nested `describe` blocks create matching folders:

```javascript
describe('Authentication', () => {         // Creates folder: Automated Tests > Authentication
  describe('Login', () => {                // Creates folder: Automated Tests > Authentication > Login
    it('should accept valid credentials');  // Test case placed in Login folder
  });
});
```

### Environment-Based Configuration

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: process.env.TESTPLANIT_URL,
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
      runName: `CI Build ${process.env.CI_BUILD_NUMBER} - ${process.env.CI_BRANCH}`,
      milestoneId: process.env.CI_MILESTONE_ID,
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: process.env.TESTPLANIT_URL,
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
    }]
  ],
}
```

## Output

When tests complete, the service outputs a summary:

```console
[TestPlanIt Service] Test run created: "E2E Tests - 2025-01-15 10:30:00" (ID: 456)

[TestPlanIt Service] ══════════════════════════════════════════
[TestPlanIt Service]   Test Run ID: 456
[TestPlanIt Service]   Status: Completed
[TestPlanIt Service]   View: https://testplanit.example.com/projects/runs/1/456
[TestPlanIt Service] ══════════════════════════════════════════
```

## Verbose Mode

Enable verbose logging for debugging on both the service and reporter:

```javascript
services: [
  [TestPlanItService, {
    // ... other options
    verbose: true,
  }]
],
reporters: [
  ['@testplanit/wdio-reporter', {
    // ... other options
    verbose: true,
  }]
]
```

This will log:

- Reporter/service initialization
- Test run and suite creation
- ID resolution (name lookups)
- Status mappings
- Each test result submission
- Screenshot captures and uploads
- API errors and retries

## Error Handling

- **Service errors** in `onPrepare` will throw and stop the test suite
- **Service errors** in `onComplete` are logged but don't throw (to avoid hiding test results)
- **Reporter errors** are logged but don't fail the test suite
- Failed API requests are retried (configurable via `maxRetries`)
- Individual test result failures don't stop other results from being reported

## TypeScript Support

Full TypeScript support is included:

```typescript
import { TestPlanItService } from '@testplanit/wdio-reporter';
import type {
  TestPlanItReporterOptions,
  TestPlanItServiceOptions,
  RunLinkInput,
  RunAttachmentInput,
  TestPlanItRuntimeApi, // shape of browser.testplanit
} from '@testplanit/wdio-reporter';

const serviceOptions: TestPlanItServiceOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  captureScreenshots: true,
  runLinks: [{ url: '{env:BUILD_URL}', name: 'CI Build' }],
  runMetadata: { version: '{env:APP_VERSION}' },
};

const reporterOptions: TestPlanItReporterOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  autoCreateTestCases: true,
  parentFolderId: 10,
  templateId: 1,
};
```

## Compatibility

| WebdriverIO Version | Supported |
| -------------------- | ----------- |
| 9.x | Yes |
| 8.x | Yes |

Requires Node.js 24 or later.

## Related Packages

- [@testplanit/api](https://github.com/TestPlanIt/testplanit/tree/main/packages/api) - The underlying API client used by this reporter

## License

MIT
