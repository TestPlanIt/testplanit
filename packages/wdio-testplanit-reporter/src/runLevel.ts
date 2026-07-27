/**
 * Run-level attachment helpers shared by the TestPlanItService (declarative
 * `runLinks` / `runAttachments` / `runMetadata` options, applied once in the
 * launcher) and the `browser.testplanit` runtime API (installed in each
 * worker).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Attachment, TestPlanItClient } from '@testplanit/api';
import { readSharedState } from './shared.js';
import type {
  RunAttachmentInput,
  RunLinkInput,
  TestPlanItRuntimeApi,
} from './types.js';

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

/** Logging callbacks + client context shared with the service. */
export interface RuntimeApiContext {
  client: TestPlanItClient;
  projectId: number;
  log: (message: string, ...args: unknown[]) => void;
  logError: (message: string, error?: unknown) => void;
}

/**
 * Attach one file input (path or buffer) to a run. Shared by the declarative
 * service flow and the runtime API. Throws on failure — callers decide how to
 * log/swallow. Returns null only for invalid input (which is also logged).
 */
export async function attachFileToRun(
  ctx: RuntimeApiContext,
  runId: number,
  input: RunAttachmentInput
): Promise<Attachment | null> {
  let buffer: Buffer;
  let name: string;

  if (input.buffer) {
    if (!input.name) {
      ctx.logError('attachToRun: "name" is required when attaching a buffer');
      return null;
    }
    buffer = input.buffer;
    name = input.name;
  } else if (input.path) {
    buffer = fs.readFileSync(input.path);
    name = input.name && input.name.trim() ? input.name : path.basename(input.path);
  } else {
    ctx.logError('attachToRun: provide a "url", "path", or "buffer"');
    return null;
  }

  const mimeType = input.mimeType ?? guessMimeType(name);
  return ctx.client.uploadTestRunAttachment(runId, buffer, name, mimeType);
}

/**
 * Build the `browser.testplanit` runtime API for a worker process.
 *
 * The run ID is resolved lazily on every call from the shared state file the
 * launcher service wrote in `onPrepare`, so every worker reaches the same
 * managed run. All methods log-and-swallow failures — they never throw, so
 * awaiting them in a hook can't fail the test run.
 */
export function createRuntimeApi(ctx: RuntimeApiContext): TestPlanItRuntimeApi {
  const resolveRunId = (): number | undefined =>
    readSharedState(ctx.projectId)?.testRunId;

  const noRunError = (method: string): void =>
    ctx.logError(
      `${method}: no active TestPlanIt run found — is the TestPlanItService configured?`
    );

  return {
    getRunId: resolveRunId,

    async attachToRun(
      input: RunLinkInput | RunAttachmentInput
    ): Promise<Attachment | null> {
      try {
        const runId = resolveRunId();
        if (!runId) {
          noRunError('attachToRun');
          return null;
        }
        if ('url' in input && input.url) {
          const link = input as RunLinkInput;
          const attachment = await ctx.client.addTestRunLink(
            runId,
            link.url,
            link.name,
            link.note
          );
          ctx.log(`Attached link to run ${runId}: ${link.url}`);
          return attachment;
        }
        const attachment = await attachFileToRun(
          ctx,
          runId,
          input as RunAttachmentInput
        );
        if (attachment) {
          ctx.log(`Attached file to run ${runId}: ${attachment.name}`);
        }
        return attachment;
      } catch (error) {
        ctx.logError('attachToRun failed:', error);
        return null;
      }
    },

    async setRunMetadata(metadata): Promise<boolean> {
      try {
        const runId = resolveRunId();
        if (!runId) {
          noRunError('setRunMetadata');
          return false;
        }
        await ctx.client.setTestRunMetadata(runId, metadata);
        ctx.log(`Set run metadata on run ${runId}:`, Object.keys(metadata).join(', '));
        return true;
      } catch (error) {
        ctx.logError('setRunMetadata failed:', error);
        return false;
      }
    },
  };
}
