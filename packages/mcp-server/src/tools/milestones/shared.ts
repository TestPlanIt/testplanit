import { extractProseMirrorText } from "../cases/shared.js";
import {
  computeStatusRollup,
  type StatusGroup,
  type StatusRollup,
} from "../runs/shared.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ─────────────────────────────────────────────────────────────────────────────
// Inline caps for the milestones_get linked arrays. linkedTestRuns is
// deliberately wider than the standard 100-row ceiling — milestones legitimately
// carry hundreds of test runs (the dominant fan-out), so a narrower cap
// would force agents into pagination round trips for the common case.
// linkedSessions and children stay at the standard ceiling.
// ─────────────────────────────────────────────────────────────────────────────

export const MILESTONE_LINKED_TEST_RUNS_CAP = 250;
export const MILESTONE_LINKED_SESSIONS_CAP = 100;
export const MILESTONE_CHILDREN_CAP = 100;

const TEST_RUNS_CAP_PLUS_ONE = MILESTONE_LINKED_TEST_RUNS_CAP + 1;
const SESSIONS_CAP_PLUS_ONE = MILESTONE_LINKED_SESSIONS_CAP + 1;
const CHILDREN_CAP_PLUS_ONE = MILESTONE_CHILDREN_CAP + 1;

// ─────────────────────────────────────────────────────────────────────────────
// Typed includes — `as const` so reintroducing
// an unknown column produces TS2353 at compile time.
//
// No `icon` selection: the schema only carries a 1-character `FieldIcon.name`
// identifier (not a URL); deliberately dropped for the read surface so agents
// don't see an opaque glyph code.
//
// `testRuns` and `sessions` on the row include are INTERNAL scaffolding — the
// list handler reads only `id` from these arrays to fan out the pooled-rollup
// groupBy calls. They are not surfaced on the mapped output row.
// ─────────────────────────────────────────────────────────────────────────────

export const MILESTONE_ROW_INCLUDE = {
  milestoneType: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  _count: { select: { children: true, comments: true } },
  testRuns: { where: { isDeleted: false }, select: { id: true } },
  sessions: { where: { isDeleted: false }, select: { id: true } },
} as const;

// Detail include — extends the row include with the three capped linked arrays.
// Each nested array uses `take: cap + 1` so the get handler can detect overflow
// and stamp a `truncated.<key>: true` flag on the response.
export const MILESTONE_DETAIL_INCLUDE = {
  milestoneType: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  _count: { select: { children: true, comments: true } },
  testRuns: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TEST_RUNS_CAP_PLUS_ONE,
    select: {
      id: true,
      name: true,
      isCompleted: true,
      completedAt: true,
    },
  },
  sessions: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SESSIONS_CAP_PLUS_ONE,
    select: {
      id: true,
      name: true,
      isCompleted: true,
      state: { select: { id: true, name: true } },
    },
  },
  children: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHILDREN_CAP_PLUS_ONE,
    select: {
      id: true,
      name: true,
      isCompleted: true,
      _count: { select: { children: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Raw row types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMilestoneRow {
  id: number;
  name: string;
  isStarted: boolean;
  isCompleted: boolean;
  automaticCompletion: boolean;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  parentId: number | null;
  milestoneType: { id: number; name: string } | null;
  creator: { id: string; name: string | null; email: string } | null;
  _count?: { children: number; comments: number };
  // Internal scaffolding for rollup fan-out — NOT surfaced in mapped output.
  testRuns?: Array<{ id: number }>;
  sessions?: Array<{ id: number }>;
}

export interface RawMilestoneDetail
  extends Omit<RawMilestoneRow, "testRuns" | "sessions"> {
  note: unknown;
  docs: unknown;
  testRuns: Array<{
    id: number;
    name: string;
    isCompleted: boolean;
    completedAt: Date | string | null;
  }>;
  sessions: Array<{
    id: number;
    name: string;
    isCompleted: boolean;
    state: { id: number; name: string } | null;
  }>;
  children: Array<{
    id: number;
    name: string;
    isCompleted: boolean;
    _count: { children: number };
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — every output field enumerated explicitly. We never `...spread` raw
// rows: the include shape and the mapper output must stay in sync explicitly so
// schema drift can't leak new columns.
// ─────────────────────────────────────────────────────────────────────────────

export function mapMilestoneRow(
  raw: RawMilestoneRow,
  extras: { totalDescendants: number; rollup: StatusRollup },
) {
  return {
    id: raw.id,
    name: raw.name,
    milestoneType: raw.milestoneType
      ? { id: raw.milestoneType.id, name: raw.milestoneType.name }
      : null,
    isStarted: raw.isStarted,
    isCompleted: raw.isCompleted,
    automaticCompletion: raw.automaticCompletion,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    createdAt: raw.createdAt,
    creator: raw.creator
      ? {
          id: raw.creator.id,
          name: raw.creator.name,
          email: raw.creator.email,
        }
      : null,
    parentId: raw.parentId ?? null,
    directChildrenCount: raw._count?.children ?? 0,
    commentCount: raw._count?.comments ?? 0,
    totalDescendants: extras.totalDescendants,
    statusCounts: extras.rollup.statusCounts,
    untested: extras.rollup.untested,
    total: extras.rollup.total,
  };
}

export interface MilestoneDetailFlags {
  truncated: {
    linkedTestRuns?: true;
    linkedSessions?: true;
    children?: true;
  };
  childTotalDescendants: Map<number, number>;
}

export function mapMilestoneDetail(
  raw: RawMilestoneDetail,
  extras: { totalDescendants: number; rollup: StatusRollup },
  flags: MilestoneDetailFlags,
) {
  // The row mapper expects optional `testRuns`/`sessions` scaffolding; the
  // detail shape replaces both with full select rows further down, so we hand
  // the mapper a stripped surrogate to avoid double-shaping the fan-out arrays.
  const head = mapMilestoneRow(
    { ...raw, testRuns: [], sessions: [] } as RawMilestoneRow,
    extras,
  );
  return {
    ...head,
    note: extractProseMirrorText(raw.note),
    docs: extractProseMirrorText(raw.docs),
    linkedTestRuns: raw.testRuns.map((r) => ({
      id: r.id,
      name: r.name,
      isCompleted: r.isCompleted,
      completedAt: r.completedAt ?? null,
    })),
    linkedSessions: raw.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      isCompleted: s.isCompleted,
      state: s.state ? { id: s.state.id, name: s.state.name } : null,
    })),
    children: raw.children.map((c) => ({
      id: c.id,
      name: c.name,
      isCompleted: c.isCompleted,
      directChildrenCount: c._count?.children ?? 0,
      totalDescendants: flags.childTotalDescendants.get(c.id) ?? 0,
    })),
    truncated: flags.truncated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pooled-rollup merge.
//
// `TestRunResults` and `SessionResults` do not have a direct `milestoneId`
// column — they reach milestones via `testRun.milestoneId` and
// `session.milestoneId`. ZenStack RPC's `groupBy` only supports direct scalar
// columns in the `by` array, so the handler issues two batched groupBy calls
// (one keyed by `testRunId`, one keyed by `sessionId`), then this helper merges
// the results back to the milestone dimension.
//
// `TestRunCases.statusId` IS nullable (cases with no execution yet); we keep
// the null bucket so it can flow into `untested` via `computeStatusRollup`.
// `SessionResults.statusId` is non-nullable — we treat null appearances as
// impossible at compile time, but the merge still tolerates them (no null-check
// branches needed).
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchedRunGroup {
  testRunId: number;
  statusId: number | null;
  _count: { id: number };
}

export interface BatchedSessionGroup {
  sessionId: number;
  statusId: number;
  _count: { id: number };
}

export function mergeMilestoneStatusGroups(args: {
  runGroups: BatchedRunGroup[];
  sessionGroups: BatchedSessionGroup[];
  runIdToMilestoneId: Map<number, number>;
  sessionIdToMilestoneId: Map<number, number>;
}): Map<number, StatusGroup[]> {
  const innerMap = new Map<number, Map<number | null, number>>();

  for (const g of args.runGroups) {
    const mId = args.runIdToMilestoneId.get(g.testRunId);
    if (mId === undefined) continue;
    const inner = innerMap.get(mId) ?? new Map<number | null, number>();
    inner.set(g.statusId, (inner.get(g.statusId) ?? 0) + g._count.id);
    innerMap.set(mId, inner);
  }
  for (const g of args.sessionGroups) {
    const mId = args.sessionIdToMilestoneId.get(g.sessionId);
    if (mId === undefined) continue;
    const inner = innerMap.get(mId) ?? new Map<number | null, number>();
    inner.set(g.statusId, (inner.get(g.statusId) ?? 0) + g._count.id);
    innerMap.set(mId, inner);
  }

  const out = new Map<number, StatusGroup[]>();
  for (const [mId, inner] of innerMap) {
    const arr: StatusGroup[] = [];
    for (const [statusId, count] of inner) {
      arr.push({ statusId, _count: { id: count } });
    }
    out.set(mId, arr);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive CTE host-endpoint client.
//
// `totalDescendants` requires a recursive CTE (`WITH RECURSIVE`); ZenStack RPC
// has no `$queryRaw` passthrough, so a dedicated host endpoint runs the CTE
// once per page (batched across all milestone IDs) and returns a
// milestoneId → descendantCount map. Empty input short-circuits without a
// network call.
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10000;

export async function fetchDescendantCounts(
  milestoneIds: number[],
  env: EnvConfig,
): Promise<Map<number, number>> {
  if (milestoneIds.length === 0) return new Map();

  const q = encodeURIComponent(JSON.stringify({ milestoneIds }));
  const response = await fetch(
    `${env.apiUrl}/api/mcp/milestones-descendants?q=${q}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  const text = await response.text();

  if (!response.ok) {
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const errField = parsed?.error;
      if (typeof errField === "string") {
        parsedMessage = errField;
      } else if (
        errField &&
        typeof errField === "object" &&
        (errField as Record<string, unknown>).message
      ) {
        parsedMessage = String(
          (errField as Record<string, unknown>).message,
        );
      }
    } catch {
      // Body is not JSON — leave parsedMessage undefined.
    }
    // Never include the bearer token in error messages.
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from /api/mcp/milestones-descendants${parsedMessage ? `: ${parsedMessage}` : ""}`,
      { statusCode: response.status },
    );
  }

  const json = JSON.parse(text) as { data?: Record<string, number> };
  const map = new Map<number, number>();
  for (const [k, v] of Object.entries(json.data ?? {})) {
    map.set(parseInt(k, 10), v);
  }
  // Defensive: every input id is present in the output map (defaulting to 0)
  // so callers can use `map.get(id) ?? 0` without surprises.
  for (const id of milestoneIds) {
    if (!map.has(id)) map.set(id, 0);
  }
  return map;
}

// Re-export shared helpers consumed by list.ts / get.ts so the milestones
// module is the single import surface for the domain.
export { computeStatusRollup };
export type { StatusGroup, StatusRollup };
