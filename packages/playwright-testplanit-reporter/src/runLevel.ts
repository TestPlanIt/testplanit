/**
 * Run-level attachment support: links, files, and key/value metadata attached
 * to the TEST RUN itself (not to an individual result).
 *
 * Two surfaces:
 *
 * - Declarative reporter options (`runLinks` / `runAttachments` /
 *   `runMetadata`), applied by the reporter once, right after it creates the
 *   run.
 * - Runtime helpers ({@link attachToRun} / {@link setRunMetadata}) callable
 *   from tests and hooks. Playwright runs the reporter in the main process
 *   while tests run in workers, so the helpers ship the request through
 *   Playwright's own attachment transport: they call `testInfo.attach()` with
 *   a reserved `testplanit:run-*` name, and the reporter intercepts those
 *   attachments in `onTestEnd`, routing them to run-level API calls instead
 *   of uploading them to the result.
 */

import * as path from 'path';
import type { RunMetadata } from '@testplanit/api';
import type { RunAttachmentInput, RunLinkInput } from './types.js';

// ---------------------------------------------------------------------------
// {env:VAR} templating (mirrors @testplanit/wdio-reporter)
// ---------------------------------------------------------------------------

/** Matches `{env:VAR}` placeholders in run-level option strings. */
const ENV_PLACEHOLDER = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Result of resolving `{env:VAR}` placeholders in a string.
 * `missing` lists referenced variables that are unset (or empty) in
 * `process.env`; their placeholders are replaced with ''.
 */
export interface EnvTemplateResult {
  value: string;
  missing: string[];
}

/**
 * Replace `{env:VAR}` placeholders with values from `process.env`.
 * Unset/empty variables resolve to '' and are reported in `missing` so the
 * caller can decide to skip the entry instead of using a broken value.
 */
export function applyEnvTemplate(template: string): EnvTemplateResult {
  const missing: string[] = [];
  const value = template.replace(ENV_PLACEHOLDER, (_match, name: string) => {
    const envValue = process.env[name];
    if (envValue === undefined || envValue === '') {
      missing.push(name);
      return '';
    }
    return envValue;
  });
  return { value, missing };
}

/** Minimal extension → MIME type map for common test artifacts. */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/** Guess a MIME type from a file name's extension. */
export function guessMimeType(fileName: string): string {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Reserved attachment names (worker → reporter transport)
// ---------------------------------------------------------------------------

/** Prefix shared by every run-level attachment the helpers produce. */
export const RUN_LEVEL_ATTACHMENT_PREFIX = 'testplanit:run-';

/** Attachment name carrying a run link (JSON body: `{ url, name?, note? }`). */
export const RUN_LINK_ATTACHMENT = 'testplanit:run-link';

/** Attachment name carrying run metadata (JSON body: `Record<string, value>`). */
export const RUN_METADATA_ATTACHMENT = 'testplanit:run-metadata';

/** Attachment name prefix carrying a run file; the display name follows it. */
export const RUN_FILE_ATTACHMENT_PREFIX = 'testplanit:run-file:';

/**
 * The slice of Playwright's `TestInfo` the runtime helpers need. Pass the
 * `testInfo` object your test or fixture receives.
 */
export interface RunAttachTarget {
  attach(
    name: string,
    options: { body?: string | Buffer; path?: string; contentType?: string },
  ): Promise<void>;
}

/**
 * Attach a link or file to the test run itself (not to this test's result)
 * from inside a test or hook.
 *
 * ```typescript
 * test('deploys', async ({ page }, testInfo) => {
 *   await attachToRun(testInfo, { url: deployUrl, name: 'Deployed build' });
 *   await attachToRun(testInfo, { path: './output/report.html' });
 *   await attachToRun(testInfo, { buffer: pdf, name: 'summary.pdf' });
 * });
 * ```
 *
 * The request rides Playwright's attachment transport and is applied by the
 * reporter in the main process, exactly once per distinct link/file name —
 * retried tests don't create duplicates. Invalid input is logged and
 * ignored; it never fails the test.
 */
export async function attachToRun(
  testInfo: RunAttachTarget,
  input: RunLinkInput | RunAttachmentInput,
): Promise<void> {
  if ('url' in input && input.url) {
    const { url, name, note } = input as RunLinkInput;
    await testInfo.attach(RUN_LINK_ATTACHMENT, {
      body: JSON.stringify({ url, name, note }),
      contentType: 'application/json',
    });
    return;
  }

  const file = input as RunAttachmentInput;
  if (file.buffer) {
    if (!file.name) {
      console.error('[TestPlanIt] attachToRun: "name" is required when attaching a buffer');
      return;
    }
    await testInfo.attach(`${RUN_FILE_ATTACHMENT_PREFIX}${file.name}`, {
      body: file.buffer,
      contentType: file.mimeType ?? guessMimeType(file.name),
    });
    return;
  }

  if (file.path) {
    const name = file.name && file.name.trim() ? file.name : path.basename(file.path);
    await testInfo.attach(`${RUN_FILE_ATTACHMENT_PREFIX}${name}`, {
      path: file.path,
      contentType: file.mimeType ?? guessMimeType(name),
    });
    return;
  }

  console.error('[TestPlanIt] attachToRun: provide a "url", "path", or "buffer"');
}

/**
 * Merge key/value metadata into the test run's documentation from inside a
 * test or hook (rendered as `**key:** value` lines on the run detail page).
 * Existing keys are updated in place, new keys appended. Applied by the
 * reporter in the main process; identical payloads are applied only once.
 */
export async function setRunMetadata(
  testInfo: RunAttachTarget,
  metadata: RunMetadata,
): Promise<void> {
  await testInfo.attach(RUN_METADATA_ATTACHMENT, {
    body: JSON.stringify(metadata),
    contentType: 'application/json',
  });
}

// ---------------------------------------------------------------------------
// Reporter-side decoding
// ---------------------------------------------------------------------------

/** A decoded run-level operation extracted from a reserved attachment. */
export type RunLevelOp =
  | { kind: 'link'; url: string; name?: string; note?: string }
  | { kind: 'file'; name: string; contentType?: string; path?: string; body?: Buffer }
  | { kind: 'metadata'; metadata: RunMetadata };

/** True when an attachment name uses the reserved run-level prefix. */
export function isRunLevelAttachment(name: string): boolean {
  return name.startsWith(RUN_LEVEL_ATTACHMENT_PREFIX);
}

/**
 * Decode a reserved run-level attachment into an operation. Returns null for
 * malformed payloads (callers should log and drop them — a malformed
 * run-level attachment is never uploaded as a result attachment).
 */
export function parseRunLevelAttachment(att: {
  name: string;
  contentType?: string;
  path?: string;
  body?: Buffer;
}): RunLevelOp | null {
  if (att.name === RUN_LINK_ATTACHMENT) {
    const parsed = parseJsonBody(att.body);
    const url = typeof parsed?.url === 'string' ? parsed.url : '';
    if (!url) return null;
    return {
      kind: 'link',
      url,
      name: typeof parsed?.name === 'string' ? parsed.name : undefined,
      note: typeof parsed?.note === 'string' ? parsed.note : undefined,
    };
  }

  if (att.name === RUN_METADATA_ATTACHMENT) {
    const parsed = parseJsonBody(att.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { kind: 'metadata', metadata: parsed as RunMetadata };
  }

  if (att.name.startsWith(RUN_FILE_ATTACHMENT_PREFIX)) {
    const name = att.name.slice(RUN_FILE_ATTACHMENT_PREFIX.length);
    if (!name || (!att.path && !att.body)) return null;
    return { kind: 'file', name, contentType: att.contentType, path: att.path, body: att.body };
  }

  return null;
}

function parseJsonBody(body: Buffer | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    return JSON.parse(body.toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Session-dedupe key for a run-level op. Retried tests re-run their
 * `attachToRun` / `setRunMetadata` calls; the reporter applies each distinct
 * key once. Files dedupe on their display name (run-level semantics: one
 * artifact per name per run), links on url+name, metadata on content.
 */
export function runLevelOpKey(op: RunLevelOp): string {
  switch (op.kind) {
    case 'link':
      return `link|${op.url}|${op.name ?? ''}`;
    case 'file':
      return `file|${op.name}`;
    case 'metadata':
      return `metadata|${JSON.stringify(op.metadata)}`;
  }
}
