/**
 * Refuses every hard delete of an `Issue` row that arrives through the
 * generic ZenStack RPC route.
 *
 * `Issue` carries `@@allow('all', auth().access == 'ADMIN')`, and
 * `app/api/model/[...path]/route.ts` mounts a live `RPCApiHandler` that
 * dispatches `delete` / `deleteMany` straight onto the policy client. A
 * system admin therefore has a working `DELETE /api/model/issue/delete?q=…`
 * — a real SQL DELETE, not the project's mandatory soft delete. Since
 * `Issue.parent` is declared `onDelete: Cascade`, that one row takes its
 * whole descendant subtree with it: deleting a requirement epic silently
 * destroys every requirement beneath it, with no confirmation, no audit
 * trail of the descendants, and no restore path (the requirement restore
 * flow un-sets `isDeleted`; it cannot resurrect rows Postgres removed).
 *
 * The authoritative fix belongs in `schema.zmodel` — a `@@deny('delete', …)`
 * covers every consumer of the policy client at once. This module is the
 * app-layer half: it closes the same hole at the RPC chokepoint, which is
 * the only delete path a browser, an API token, the SDK, or the MCP server
 * can actually reach.
 *
 * Three shapes reach `client.issue.delete()` through that one route, and all
 * three are refused here:
 *
 *   1. `DELETE /api/model/issue/delete` and `.../issue/deleteMany`.
 *   2. `POST /api/model/$transaction/sequential` with a body operation whose
 *      model is `Issue` and whose op is a delete — the RPC handler validates
 *      those ops against its own list and invokes them directly, never
 *      passing through the per-model path above.
 *   3. A nested relation delete under some other model's mutation, e.g.
 *      `PATCH /api/model/projects/update` with
 *      `data: { issues: { deleteMany: {} } }`, or the same reached through
 *      an arbitrarily deep chain of nested writes.
 *
 * Which relation fields point at `Issue` is read from the generated schema
 * rather than hardcoded, so a new relation added later is covered without
 * anyone remembering this file. Matching on field NAMES alone would be
 * wrong: `parent` / `children` name self-relations on other models too, and
 * a name-only match would refuse legitimate deletes on those.
 *
 * Raw-client writers (`baseDb`) bypass policy and therefore bypass this
 * module by construction. That is deliberate and unchanged: the soft-delete
 * cascade in `requirementHierarchy.ts`, the importers, and the integration
 * suites' own teardown all need the raw client, and none of them is
 * reachable from a request.
 */

import { schema } from "~/zenstack/schema";

const ISSUE_MODEL = "Issue";

/** ZenStack's RPC transaction route: `/api/model/$transaction/sequential`. */
export const TRANSACTION_ROUTE_MODEL = "$transaction";

/**
 * The two `CoreCrudOperations` entries that emit a SQL DELETE. `upsert` is
 * absent on purpose — it never deletes.
 */
const DELETE_OPERATIONS = new Set(["delete", "deleteMany"]);

/**
 * Nested-write keys whose payloads are themselves model write inputs and so
 * must be walked for a deeper Issue delete. `connect` / `disconnect` / `set`
 * take id filters, not write inputs, and are skipped.
 */
const NESTED_PAYLOAD_KEYS = [
  "create",
  "update",
  "updateMany",
  "upsert",
  "connectOrCreate",
] as const;

/**
 * A malicious or malformed payload can nest arbitrarily deep. The deepest
 * legitimate nested write in this app is a handful of levels; the cap keeps
 * a hostile payload from turning this walk into the denial-of-service the
 * guard exists to prevent.
 */
const MAX_WALK_DEPTH = 12;

type ModelName = string;

const MODELS = schema.models as unknown as Record<
  ModelName,
  {
    fields: Record<string, { type?: string; relation?: unknown } | undefined>;
  }
>;

/**
 * RPC paths address models by their lower-first accessor (`issue`,
 * `repositoryCases`); the schema keys them PascalCase. Built once at module
 * load from the schema itself so it cannot drift.
 */
const MODEL_BY_ACCESSOR: ReadonlyMap<string, ModelName> = new Map(
  Object.keys(MODELS).map((name) => [
    name.charAt(0).toLowerCase() + name.slice(1),
    name,
  ])
);

/** Resolves an RPC accessor OR a PascalCase model name to a model name. */
export function resolveModelName(candidate: string): ModelName | null {
  if (Object.prototype.hasOwnProperty.call(MODELS, candidate)) {
    return candidate;
  }
  return MODEL_BY_ACCESSOR.get(candidate) ?? null;
}

/** The model a relation field points at, or null when it is not a relation. */
function relationTarget(model: ModelName, field: string): ModelName | null {
  const def = MODELS[model]?.fields?.[field];
  if (!def || !def.relation || typeof def.type !== "string") return null;
  return Object.prototype.hasOwnProperty.call(MODELS, def.type)
    ? def.type
    : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A relation payload asked for a delete (`delete: true`, `deleteMany: {…}`, …). */
function requestsDelete(relationPayload: Record<string, unknown>): boolean {
  for (const op of DELETE_OPERATIONS) {
    if (!Object.prototype.hasOwnProperty.call(relationPayload, op)) continue;
    const value = relationPayload[op];
    // `delete: false` / `delete: null` are no-ops in the ORM; only a truthy
    // value actually removes rows.
    if (value) return true;
  }
  return false;
}

/**
 * Walks one model's write input (the object whose keys are that model's own
 * fields) looking for a delete aimed at an Issue-typed relation.
 */
function payloadDeletesIssue(
  model: ModelName,
  payload: unknown,
  depth: number
): boolean {
  if (depth > MAX_WALK_DEPTH) return false;
  if (Array.isArray(payload)) {
    return payload.some((entry) =>
      payloadDeletesIssue(model, entry, depth + 1)
    );
  }
  if (!isPlainRecord(payload)) return false;

  for (const [field, value] of Object.entries(payload)) {
    const target = relationTarget(model, field);
    if (!target) continue;
    if (!isPlainRecord(value)) continue;

    if (target === ISSUE_MODEL && requestsDelete(value)) return true;

    for (const key of NESTED_PAYLOAD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (nestedWriteDeletesIssue(target, value[key], depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Unwraps one nested-write entry into the write input it carries. To-many
 * `update` / `updateMany` / `upsert` entries wrap the input in `data` /
 * `create` / `update` alongside a `where`; to-one entries hand the input
 * over directly.
 */
function nestedWriteDeletesIssue(
  model: ModelName,
  entry: unknown,
  depth: number
): boolean {
  if (depth > MAX_WALK_DEPTH) return false;
  if (Array.isArray(entry)) {
    return entry.some((item) =>
      nestedWriteDeletesIssue(model, item, depth + 1)
    );
  }
  if (!isPlainRecord(entry)) return false;

  let sawWrapper = false;
  for (const key of ["data", "create", "update"] as const) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    sawWrapper = true;
    if (payloadDeletesIssue(model, entry[key], depth + 1)) return true;
  }
  // No wrapper key means the entry IS the write input (the to-one shape).
  return sawWrapper ? false : payloadDeletesIssue(model, entry, depth + 1);
}

/** Walks a top-level RPC operation's args (`{ where, data, create, update }`). */
function argsDeleteIssue(model: ModelName, args: unknown): boolean {
  if (!isPlainRecord(args)) return false;
  for (const key of ["data", "create", "update"] as const) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    if (payloadDeletesIssue(model, args[key], 0)) return true;
  }
  return false;
}

/**
 * The single question the RPC route asks: would this request hard-delete an
 * `Issue` row? `model` and `operation` are the raw path segments;
 * `requestBody` is the parsed JSON body (null for `delete`/`deleteMany`,
 * which carry their `where` in `?q=` — irrelevant here, since the operation
 * name alone already condemns them).
 */
export function requestHardDeletesIssue(params: {
  model: string;
  operation: string;
  requestBody: unknown;
}): boolean {
  const { model, operation, requestBody } = params;

  if (model === TRANSACTION_ROUTE_MODEL) {
    if (!Array.isArray(requestBody)) return false;
    return requestBody.some((item) => {
      if (!isPlainRecord(item)) return false;
      const itemModel =
        typeof item.model === "string" ? resolveModelName(item.model) : null;
      if (!itemModel) return false;
      if (
        itemModel === ISSUE_MODEL &&
        typeof item.op === "string" &&
        DELETE_OPERATIONS.has(item.op)
      ) {
        return true;
      }
      return argsDeleteIssue(itemModel, item.args);
    });
  }

  const resolved = resolveModelName(model);
  if (!resolved) return false;
  if (resolved === ISSUE_MODEL && DELETE_OPERATIONS.has(operation)) return true;
  return argsDeleteIssue(resolved, requestBody);
}
