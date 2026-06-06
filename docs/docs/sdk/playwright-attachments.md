---
title: Attachment Uploads
---

# Attachment Uploads

The reporter uploads Playwright attachments to TestPlanIt when `uploadAttachments` is enabled (the default). Unlike the WebdriverIO reporter — which only intercepts screenshots — the Playwright reporter uploads **every attachment** on a test result, including screenshots, videos, traces, and anything you add yourself with `testInfo.attach()`.

## How Playwright Produces Attachments

Playwright collects attachments automatically based on your `use` settings. No reporter-specific hook is required:

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      uploadAttachments: true, // default
    }],
  ],
});
```

Every attachment Playwright records on a result — plus any custom `testInfo.attach()` outputs — is uploaded to the corresponding result in TestPlanIt.

## Custom Attachments

Attach arbitrary evidence from within a test and it will be uploaded too:

```typescript
test('exports a report', async ({ page }, testInfo) => {
  const csv = await generateReport(page);
  await testInfo.attach('report', { body: csv, contentType: 'text/csv' });
});
```

## Filtering Which Attachments Upload

Use `attachmentTypes` to restrict uploads. Each entry matches an attachment when it equals the attachment **name** (e.g. `screenshot`, `video`, `trace`) or is a prefix of its **content type** (e.g. `image/`, `image/png`, `video/`). When omitted, every attachment is uploaded.

```typescript
// Screenshots only (mirrors the WebdriverIO reporter's behavior)
attachmentTypes: ['image/']

// Screenshots and videos, but not traces
attachmentTypes: ['image/', 'video/']

// Match by attachment name
attachmentTypes: ['screenshot', 'trace']
```

Example:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      attachmentTypes: ['image/', 'video/'],
    }],
  ],
});
```

## Disabling Uploads

Set `uploadAttachments: false` to skip attachment uploads entirely while still reporting results:

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  uploadAttachments: false,
}]
```

## How It Works

1. Playwright records attachments on each test result (based on your `use` settings and any `testInfo.attach()` calls).
2. When the test ends, the reporter reads each attachment — from its in-memory body or its file on disk — and filters it through `attachmentTypes`.
3. Each matching attachment is uploaded to the test's result in TestPlanIt, with a note describing the test, suite, status, project, and error (for failures).

:::tip
Trace files (`trace.zip`) and videos can be large. If you only want lightweight evidence in TestPlanIt, set `attachmentTypes: ['image/']` to upload just screenshots.
:::
