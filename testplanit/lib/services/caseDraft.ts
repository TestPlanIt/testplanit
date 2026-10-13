/**
 * Draft auto-save for the test case editors.
 *
 * A draft is a private, per-user snapshot of an in-progress edit. It is never
 * the canonical case: `CaseDraft` sits outside every side-effect registry —
 * the audit trigger registry (scripts/trigger-registry.ts), esSyncPlugin's
 * INDEXED_MODELS, and sideEffectsPlugin's GUC_MODELS / BEFORE_IMAGE_MODELS —
 * so writing one bumps no version, logs no change, reindexes nothing and fires
 * no webhook or notification. Adding CaseDraft to any of those registries would
 * silently break that guarantee.
 *
 * Two scopes exist, distinguished by `draftKey`:
 *   - `case:<id>`   an edit in progress on an existing case
 *   - `folder:<id>` a new case being authored into that folder
 *
 * Drafts live in two places at once. localStorage is written synchronously on
 * every change so a crash loses at most the last keystroke; the server row is
 * written on a debounce so the work survives a different browser or machine.
 * On restore, whichever copy carries the later `savedAt` wins.
 */

import type { JsonObject } from "@zenstackhq/orm";

export const CASE_DRAFT_PAYLOAD_VERSION = 1;

/** Idle time before an auto-save fires. */
export const CASE_DRAFT_DEBOUNCE_MS = 2_500;
/** Ceiling between auto-saves while the user types continuously. */
export const CASE_DRAFT_MAX_WAIT_MS = 30_000;
/** Backoff schedule after a failed auto-save, in ms; the last entry repeats. */
export const CASE_DRAFT_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 60_000];
/** Drafts untouched for this long are purged by the retention job. */
export const CASE_DRAFT_RETENTION_DAYS = 30;

export type CaseDraftScope =
  { kind: "case"; caseId: number } | { kind: "folder"; folderId: number };

/**
 * Editor state the react-hook-form values do not own. Pending file uploads are
 * deliberately absent: a `File` handle cannot be serialized, and re-reading one
 * after a reload needs a user gesture the browser will not grant us.
 */
export interface CaseDraftExtras {
  templateId?: number | null;
  tags?: number[];
  issues?: number[];
  inlineParameters?: unknown[];
  inlineDatasetRows?: unknown[];
}

export interface CaseDraftPayload {
  version: number;
  /** react-hook-form values, JSON-safe. */
  values: Record<string, unknown>;
  /** Keys of `values` that held a `Date`, so restore can rebuild them. */
  dateFields: string[];
  extras: CaseDraftExtras;
  /** ISO timestamp, used to pick a winner between the local and server copies. */
  savedAt: string;
}

export function caseDraftKey(scope: CaseDraftScope): string {
  return scope.kind === "case"
    ? `case:${scope.caseId}`
    : `folder:${scope.folderId}`;
}

/**
 * Split `Date` values out into ISO strings, recording which keys they came from.
 * Case field values are flat — a Date only ever appears at the top level — so a
 * shallow pass is enough and avoids walking large Tiptap step trees.
 */
function serializeValues(values: Record<string, unknown>): {
  values: Record<string, unknown>;
  dateFields: string[];
} {
  const out: Record<string, unknown> = {};
  const dateFields: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (value instanceof Date) {
      // An Invalid Date round-trips to null, which is what an empty date
      // picker means anyway.
      if (Number.isNaN(value.getTime())) {
        out[key] = null;
      } else {
        out[key] = value.toISOString();
        dateFields.push(key);
      }
      continue;
    }
    if (typeof value === "function" || value instanceof File) continue;
    out[key] = value;
  }

  return { values: out, dateFields };
}

export function buildCaseDraftPayload(
  values: Record<string, unknown>,
  extras: CaseDraftExtras = {},
  savedAt: Date = new Date()
): CaseDraftPayload {
  const serialized = serializeValues(values);
  return {
    version: CASE_DRAFT_PAYLOAD_VERSION,
    values: serialized.values,
    dateFields: serialized.dateFields,
    extras,
    savedAt: savedAt.toISOString(),
  };
}

/**
 * The payload as the `Json` column's input type.
 *
 * The JSON round-trip is load-bearing, not a cast dodge: the ZenStack RPC
 * layer validates a `Json` argument against a JsonValue union that admits
 * string / number / boolean / null / array / record and **rejects `undefined`
 * at any depth**. react-hook-form leaves `undefined` all over its values — an
 * unset `sharedStepGroupName` on a step row, a cleared optional field — and
 * those survive the shallow pass in `serializeValues`. Without this, the write
 * fails validation with "expected string, received undefined at
 * create.payload.values.steps[1].sharedStepGroupName".
 *
 * `JSON.stringify` drops `undefined` object properties at every depth, which
 * is exactly the normalization the column needs, and is also why the
 * localStorage mirror never hit this — it stringifies on the way in.
 */
export function toCaseDraftColumn(payload: CaseDraftPayload): JsonObject {
  return JSON.parse(JSON.stringify(payload)) as JsonObject;
}

/**
 * Guard for anything read back from storage or the database. A payload written
 * by an older deploy fails the version check and is treated as absent rather
 * than restored into a form whose shape has since changed.
 */
export function isCaseDraftPayload(value: unknown): value is CaseDraftPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CaseDraftPayload>;
  return (
    candidate.version === CASE_DRAFT_PAYLOAD_VERSION &&
    !!candidate.values &&
    typeof candidate.values === "object" &&
    !Array.isArray(candidate.values) &&
    Array.isArray(candidate.dateFields) &&
    typeof candidate.savedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.savedAt))
  );
}

/** Rebuild the `Date` instances the form's date pickers expect. */
export function reviveCaseDraftValues(
  payload: CaseDraftPayload
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...payload.values };
  for (const key of payload.dateFields) {
    const raw = values[key];
    if (typeof raw !== "string") continue;
    const parsed = new Date(raw);
    values[key] = Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return values;
}

/**
 * Key-order-independent serialization. react-hook-form rebuilds its values
 * object on every change, and object key order is not stable across those
 * rebuilds — comparing raw `JSON.stringify` output would report a change on
 * every keystroke-free re-render and auto-save forever.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== "function")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * A digest of everything a draft would capture. Comparing this against the
 * digest of the values the editor was opened with is how "is there unsaved
 * work?" is decided — react-hook-form's own `isDirty` is unreliable here
 * because both editors call `reset()` from effects that re-run on background
 * refetches and template switches.
 */
export function caseDraftDigest(
  values: Record<string, unknown>,
  extras: CaseDraftExtras = {}
): string {
  return stableStringify({ values, extras });
}

export function caseDraftStorageKey(userId: string, draftKey: string): string {
  return `tpi:case-draft:${userId}:${draftKey}`;
}

export function readLocalCaseDraft(
  storageKey: string
): CaseDraftPayload | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCaseDraftPayload(parsed) ? parsed : null;
  } catch {
    // Private mode, blocked site data, or a corrupt entry. The server copy is
    // the durable one; a missing local mirror is not an error.
    return null;
  }
}

/** Returns false when the write did not land (quota exceeded, blocked storage). */
export function writeLocalCaseDraft(
  storageKey: string,
  payload: CaseDraftPayload
): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalCaseDraft(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to do — the server copy is deleted separately.
  }
}

/** The later of two candidate drafts, or whichever one exists. */
export function newerCaseDraft(
  a: CaseDraftPayload | null,
  b: CaseDraftPayload | null
): CaseDraftPayload | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.savedAt) >= Date.parse(b.savedAt) ? a : b;
}
