/**
 * Server-side enforcement of the Complete action's permission rule.
 *
 * Completing a test run or a session is offered in the UI only to users whose
 * effective role carries `canClose` on the matching area (plus system admins)
 * — see TestRunItem / SessionDisplay and `useProjectPermissions`. The schema
 * policies behind the write are much looser: TestRuns / Sessions
 * `@@allow('update')` accepts the row's creator, the project's creator, an
 * assigned PROJECTADMIN, and anyone holding `canAddEdit` or `canDelete`. So an
 * ordinary editor who never sees the button could still complete a run through
 * the model RPC, the public SDK, or the MCP server.
 *
 * This module closes that gap at the RPC chokepoint. It is deliberately app
 * layer rather than a schema `@@deny('post-update')`: the review gate on these
 * same two models is documented as app-layer for the same reasons (a typed
 * error shape instead of a generic policy rejection, and `post-update` rules
 * are model-wide, so every unrelated run update would pay for a before-load).
 *
 * Writers that hold no human actor — the milestone-completion cascade, the
 * abandoned-run sweeper, the importers — use the raw client and never reach
 * this chokepoint. They are gated at their own entry points.
 *
 * Both directions are gated. There is no in-app un-complete affordance at all,
 * so `true -> false` has no UI rule to match; `canClose` is the closest
 * equivalent and keeps the reversal at least as privileged as the action it
 * reverses.
 */

import { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";

export const COMPLETION_GATED_MODELS = {
  testRuns: ApplicationArea.TestRuns,
  sessions: ApplicationArea.Sessions,
} as const;

export type CompletionGatedModel = keyof typeof COMPLETION_GATED_MODELS;

export type CompletionEntityType = "RUN" | "SESSION";

const ENTITY_TYPE: Record<CompletionGatedModel, CompletionEntityType> = {
  testRuns: "RUN",
  sessions: "SESSION",
};

export function isCompletionGatedModel(
  model: string
): model is CompletionGatedModel {
  return model === "testRuns" || model === "sessions";
}

export class CompletionPermissionError extends Error {
  readonly code = "COMPLETE_NOT_PERMITTED";

  constructor(
    readonly entityType: CompletionEntityType,
    readonly entityIds: number[]
  ) {
    super("COMPLETE_NOT_PERMITTED");
    this.name = "CompletionPermissionError";
  }
}

export function isCompletionPermissionError(
  error: unknown
): error is CompletionPermissionError {
  return (
    error instanceof CompletionPermissionError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "COMPLETE_NOT_PERMITTED")
  );
}

/**
 * Locates `isCompleted` in a ZenStack RPC body, whose shape varies by
 * operation. Mirrors how the review gate finds `stateId`.
 *
 * Returns null when the payload doesn't touch the flag at all, which is the
 * overwhelmingly common case and short-circuits the whole gate.
 */
export function readCompletionIntent(
  operation: string,
  body: unknown
): { nextValue: boolean } | null {
  const b = body as
    | { data?: { isCompleted?: unknown }; update?: { isCompleted?: unknown } }
    | undefined;

  const raw =
    operation === "update" ||
    operation === "updateMany" ||
    operation === "create"
      ? b?.data?.isCompleted
      : operation === "upsert"
        ? b?.update?.isCompleted
        : undefined;

  return typeof raw === "boolean" ? { nextValue: raw } : null;
}

interface TransitioningRow {
  id: number;
  projectId: number;
}

type CompletionGateDb = {
  testRuns: { findMany: (args: any) => Promise<any[]> };
  sessions: { findMany: (args: any) => Promise<any[]> };
};

/**
 * The rows whose `isCompleted` would actually change.
 *
 * A no-op re-save (writing `true` over an already-completed row) is not a
 * transition and stays ungated — otherwise any form that round-trips the whole
 * entity would start failing for users who legitimately never touched the
 * flag.
 *
 * `preSnapshot` is the pre-mutation row the RPC route already loaded for the
 * webhook emitters, so the single-row path — every UI completion — costs no
 * extra query.
 */
export async function resolveTransitioningRows(
  model: CompletionGatedModel,
  operation: string,
  body: unknown,
  nextValue: boolean,
  preSnapshot: {
    id?: number;
    projectId?: number;
    isCompleted?: boolean;
  } | null,
  db: CompletionGateDb = baseDb as unknown as CompletionGateDb
): Promise<TransitioningRow[]> {
  const b = body as
    | { where?: Record<string, unknown>; data?: { projectId?: unknown } }
    | undefined;

  // A create that is born completed still needs the permission — nothing else
  // stops one being inserted that way.
  if (operation === "create") {
    const projectId = Number(b?.data?.projectId);
    if (!nextValue || !Number.isFinite(projectId)) return [];
    return [{ id: 0, projectId }];
  }

  if (
    preSnapshot &&
    typeof preSnapshot.id === "number" &&
    typeof preSnapshot.projectId === "number"
  ) {
    if (preSnapshot.isCompleted === nextValue) return [];
    return [{ id: preSnapshot.id, projectId: preSnapshot.projectId }];
  }

  // updateMany, or an update/upsert whose `where` isn't a scalar id: ask which
  // matched rows are actually on the other side of the flag.
  const where = b?.where;
  if (!where || typeof where !== "object") return [];

  const rows = await db[model].findMany({
    where: { ...where, isCompleted: !nextValue },
    select: { id: true, projectId: true },
  });

  return rows.map((row) => ({
    id: row.id as number,
    projectId: row.projectId as number,
  }));
}

/**
 * Throws `CompletionPermissionError` unless the actor may flip `isCompleted`
 * on every affected row. Permission is resolved once per distinct project.
 */
export async function assertCanFlipCompletion(params: {
  model: CompletionGatedModel;
  operation: string;
  body: unknown;
  actorUserId: string;
  preSnapshot: {
    id?: number;
    projectId?: number;
    isCompleted?: boolean;
  } | null;
  db?: CompletionGateDb;
}): Promise<void> {
  const { model, operation, body, actorUserId, preSnapshot, db } = params;

  const intent = readCompletionIntent(operation, body);
  if (!intent) return;

  const rows = await resolveTransitioningRows(
    model,
    operation,
    body,
    intent.nextValue,
    preSnapshot,
    db
  );
  if (rows.length === 0) return;

  const area = COMPLETION_GATED_MODELS[model];
  const decisionByProject = new Map<number, boolean>();
  const denied: number[] = [];

  for (const row of rows) {
    let allowed = decisionByProject.get(row.projectId);
    if (allowed === undefined) {
      allowed = await userHasAreaPermission(
        actorUserId,
        row.projectId,
        area,
        "canClose"
      );
      decisionByProject.set(row.projectId, allowed);
    }
    if (!allowed) denied.push(row.id);
  }

  if (denied.length > 0) {
    throw new CompletionPermissionError(ENTITY_TYPE[model], denied);
  }
}
