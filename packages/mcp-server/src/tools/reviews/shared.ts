import type {
  CommentFindManyArgs,
  RepositoryCasesFindManyArgs,
  ReviewRequestInclude,
  SessionsFindManyArgs,
  TestRunsFindManyArgs,
  UserFindUniqueArgs,
} from "@db/input";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { TestPlanItHttpError, validateToken } from "../../http.js";
import { extractProseMirrorText } from "../cases/shared.js";

const FETCH_TIMEOUT_MS = 10000;

export type ReviewEntityType = "CASE" | "RUN" | "SESSION";

/**
 * Row shape returned to agents. Mirrors the columns the Review inbox
 * (`app/[locale]/reviews/page.tsx`) renders, flattened for agent
 * consumption: the polymorphic entity is resolved to a name, the workflow
 * transition is a `{from,to}` pair, and the requester's submit-time prose
 * (a paired REVIEW_REQUEST Comment, not a column on ReviewRequest) is
 * extracted to plain text.
 */
export const REVIEW_ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
  assigneeUser: { select: { id: true, name: true, email: true } },
  assigneeRole: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true, email: true } },
  fromState: { select: { id: true, name: true } },
  toState: { select: { id: true, name: true } },
} as const satisfies ReviewRequestInclude;

interface RawUserRef {
  id: string;
  name: string | null;
  email: string;
}

export interface RawReviewRow {
  id: string;
  status: string;
  entityType: ReviewEntityType;
  entityId: number;
  projectId: number;
  decisionComment: string | null;
  decidedAt: string | Date | null;
  createdAt: string | Date;
  project: { id: number; name: string } | null;
  requestedBy: RawUserRef | null;
  assigneeUser: RawUserRef | null;
  assigneeRole: { id: number; name: string } | null;
  decidedBy: RawUserRef | null;
  fromState: { id: number; name: string } | null;
  toState: { id: number; name: string } | null;
}

export interface EntityRef {
  name: string | null;
  isDeleted: boolean;
}

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Flatten one ReviewRequest row.
 *
 * `assignedTo.via` disambiguates the XOR the schema enforces: a request is
 * assigned either to a user directly or to a role whose holders may all
 * act on it. An agent acting for the token owner is an eligible reviewer in
 * both cases — the listing only ever returns rows the caller can act on.
 */
export function mapReviewRow(
  raw: RawReviewRow,
  extras: { entity: EntityRef | undefined; requestNote: string | null },
) {
  return {
    id: raw.id,
    status: raw.status,
    entityType: raw.entityType,
    entityId: raw.entityId,
    entityName: extras.entity?.name ?? null,
    entityDeleted: extras.entity?.isDeleted ?? false,
    project: raw.project
      ? { id: raw.project.id, name: raw.project.name }
      : { id: raw.projectId, name: null },
    requestedBy: raw.requestedBy,
    assignedTo: raw.assigneeUser
      ? {
          via: "USER" as const,
          userId: raw.assigneeUser.id,
          name: raw.assigneeUser.name,
          roleId: null,
        }
      : raw.assigneeRole
        ? {
            via: "ROLE" as const,
            userId: null,
            name: raw.assigneeRole.name,
            roleId: raw.assigneeRole.id,
          }
        : null,
    transition: {
      from: raw.fromState,
      to: raw.toState,
    },
    requestNote: extras.requestNote,
    requestedAt: isoOrNull(raw.createdAt),
    decision:
      raw.decidedAt || raw.decidedBy
        ? {
            status: raw.status,
            comment: raw.decisionComment,
            decidedBy: raw.decidedBy,
            decidedAt: isoOrNull(raw.decidedAt),
          }
        : null,
  };
}

export interface ViewerScope {
  userId: string;
  roleIds: number[];
}

/**
 * Resolve "who am I, and which roles can reach me as a review assignee".
 *
 * The token holder does not know its own user id (it only holds the token),
 * so identity comes from `GET /api/auth/whoami` — the same probe the
 * `whoami` tool uses. Role reach mirrors `useReviewAssigneeRoleIds`: the
 * user's global `roleId` plus the `roleId` of every SPECIFIC_ROLE
 * UserProjectPermission row, deduped.
 */
export async function resolveViewerScope(
  env: EnvConfig,
): Promise<ViewerScope> {
  const probe = await validateToken(env);
  if (!probe.ok) {
    throw new TestPlanItHttpError(probe.message, {
      statusCode: probe.statusCode,
      code: probe.code,
    });
  }
  const userId = probe.user.id;

  const user = await zenstack<{
    roleId: number | null;
    projectPermissions: Array<{
      roleId: number | null;
      accessType: string;
    }> | null;
  } | null>(
    "user",
    "findUnique",
    {
      where: { id: userId },
      select: {
        roleId: true,
        projectPermissions: { select: { roleId: true, accessType: true } },
      },
    } satisfies UserFindUniqueArgs,
    env,
  );

  const roleIds = new Set<number>();
  if (typeof user?.roleId === "number") roleIds.add(user.roleId);
  for (const perm of user?.projectPermissions ?? []) {
    if (perm.accessType === "SPECIFIC_ROLE" && typeof perm.roleId === "number") {
      roleIds.add(perm.roleId);
    }
  }

  return { userId, roleIds: Array.from(roleIds) };
}

/**
 * Read the system-level review kill switch from
 * `GET /api/config/review-feature`.
 *
 * The inbox skips its query entirely when the switch is off, because
 * PENDING rows survive an admin turning the feature off — they are stale,
 * not actionable. The tool mirrors that so an agent is never handed work
 * the product has stopped asking for. A transport or parse failure is
 * treated as "enabled" so a host that predates the endpoint still returns
 * rows rather than an empty list that reads as "nothing to review".
 */
export async function fetchReviewFeatureEnabled(
  env: EnvConfig,
): Promise<boolean> {
  try {
    const response = await fetch(`${env.apiUrl}/api/config/review-feature`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return true;
    const json = (await response.json()) as { enabled?: boolean };
    return json.enabled !== false;
  } catch {
    return true;
  }
}

export function entityKey(type: ReviewEntityType, id: number): string {
  return `${type}:${id}`;
}

/**
 * Batched name lookup for the page's polymorphic entities — at most one
 * call per entity type present, never one per row.
 *
 * Soft-deleted entities stay in scope: a request can outlive its subject
 * and the reviewer still needs to see what it pointed at, so `isDeleted`
 * is surfaced rather than filtered.
 */
export async function hydrateEntities(
  rows: Array<Pick<RawReviewRow, "entityType" | "entityId">>,
  env: EnvConfig,
): Promise<Map<string, EntityRef>> {
  const byType: Record<ReviewEntityType, number[]> = {
    CASE: [],
    RUN: [],
    SESSION: [],
  };
  for (const row of rows) {
    if (byType[row.entityType]) byType[row.entityType].push(row.entityId);
  }

  const map = new Map<string, EntityRef>();

  const lookups: Array<{
    type: ReviewEntityType;
    model: string;
    ids: number[];
  }> = [
    { type: "CASE", model: "repositoryCases", ids: byType.CASE },
    { type: "RUN", model: "testRuns", ids: byType.RUN },
    { type: "SESSION", model: "sessions", ids: byType.SESSION },
  ];

  for (const lookup of lookups) {
    if (lookup.ids.length === 0) continue;
    const args = {
      where: { id: { in: Array.from(new Set(lookup.ids)) } },
      select: { id: true, name: true, isDeleted: true },
    } satisfies
      | RepositoryCasesFindManyArgs
      | TestRunsFindManyArgs
      | SessionsFindManyArgs;
    const found =
      (await zenstack<
        Array<{ id: number; name: string | null; isDeleted: boolean }>
      >(lookup.model, "findMany", args, env)) ?? [];
    for (const row of found) {
      map.set(entityKey(lookup.type, row.id), {
        name: row.name,
        isDeleted: row.isDeleted,
      });
    }
  }

  return map;
}

/**
 * Batched fetch of the requester's submit-time prose.
 *
 * The hybrid design keeps that text in the entity's Comments thread
 * (`Comment.type = REVIEW_REQUEST`, linked back via `reviewRequestId`)
 * rather than on ReviewRequest itself, so it takes a second call. Content
 * is TipTap JSON; agents get plain text. When a request somehow carries
 * more than one REVIEW_REQUEST comment the earliest wins — that is the one
 * written at submit time.
 */
export async function fetchRequestNotes(
  reviewRequestIds: string[],
  env: EnvConfig,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (reviewRequestIds.length === 0) return map;

  const rows =
    (await zenstack<
      Array<{ reviewRequestId: string | null; content: unknown }>
    >(
      "comment",
      "findMany",
      {
        where: {
          reviewRequestId: { in: reviewRequestIds },
          type: "REVIEW_REQUEST",
          isDeleted: false,
        },
        select: { reviewRequestId: true, content: true },
        orderBy: [{ createdAt: "asc" }],
      } satisfies CommentFindManyArgs,
      env,
    )) ?? [];

  for (const row of rows) {
    if (!row.reviewRequestId || map.has(row.reviewRequestId)) continue;
    const text = extractProseMirrorText(row.content).trim();
    if (text) map.set(row.reviewRequestId, text);
  }
  return map;
}

/**
 * Friendly text for the error codes `POST /api/reviews/{id}/decide`
 * returns. Kept next to the review tools rather than in the shared
 * `errors.ts` map, which is scoped to token-authentication codes.
 */
export const DECIDE_ERROR_MESSAGES: Record<string, string> = {
  INELIGIBLE_REVIEWER:
    "You are not an eligible reviewer for this request. A decision requires being the assignee (directly or through an assigned role) AND holding approve permission for the entity's area in this project.",
  ALREADY_DECIDED:
    "This review request has already been decided. Decisions are append-only and cannot be changed or retracted — the requester must submit a new request.",
  NOT_FOUND:
    "No review request with that id is visible to you. List your inbox with testplanit_reviews_list to get a current id.",
  FEATURE_DISABLED:
    "Review & Approval is turned off — either system-wide or for this request's project — so no decision can be recorded.",
  INVALID_BODY:
    "The decision was rejected as malformed. A comment is required for CHANGES_REQUESTED and REJECTED.",
};

export interface DecideInput {
  reviewRequestId: string;
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
  comment?: string;
}

export interface DecidedReview {
  id: string;
  status: string;
  entityType: ReviewEntityType;
  entityId: number;
  projectId: number;
  decisionComment: string | null;
  decidedByUserId: string | null;
  decidedAt: string | Date | null;
  toStateId: number;
}

/**
 * Record a decision through the host route.
 *
 * Deliberately NOT a ZenStack RPC write: the schema's append-only rule
 * (`@@deny('update', status != 'PENDING')`) blocks the status flip at the
 * policy layer, and the decision carries side effects the RPC path knows
 * nothing about — the atomic PENDING-guarded flip, the paired
 * REVIEW_DECISION comment, applying the approved workflow transition to
 * the entity, the requester's notification, the webhook, and the audit
 * event. The route is the only correct entry point.
 */
export async function decideReview(
  input: DecideInput,
  env: EnvConfig,
): Promise<DecidedReview> {
  const response = await fetch(
    `${env.apiUrl}/api/reviews/${encodeURIComponent(input.reviewRequestId)}/decide`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: input.decision,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );

  const text = await response.text();

  if (!response.ok) {
    let code: string | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.code === "string") code = parsed.code;
      const errField = parsed.error;
      if (typeof errField === "string") {
        message = errField;
      } else if (errField && typeof errField === "object") {
        const errObj = errField as Record<string, unknown>;
        if (typeof errObj.code === "string") code = errObj.code;
        if (typeof errObj.message === "string") message = errObj.message;
      }
    } catch {
      // Body is not JSON — code and message stay undefined.
    }
    // Never interpolate the bearer token into the message.
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from /api/reviews/{id}/decide${message ? `: ${message}` : ""}`,
      { statusCode: response.status, code },
    );
  }

  return JSON.parse(text) as DecidedReview;
}
