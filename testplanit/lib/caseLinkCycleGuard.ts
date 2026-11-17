import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { DEPENDENCY_LINK_TYPE } from "~/utils/caseDependencies";

/**
 * Server-side validity guard for `RepositoryCaseLink` writes, wired into the
 * side-effects plugin's `onQuery` so every writer — the Linked Cases panel's
 * upsert, a trash restore, the merge service's `createMany` — goes through it.
 *
 * Two rules:
 *
 *   1. A case never links to itself, whatever the type.
 *   2. A `DEPENDS_ON` edge (caseA depends on caseB) must not close a cycle.
 *      The dependency gate walks these edges to decide what is blocked, and a
 *      cycle would leave every case on it blocked forever.
 *
 * Existing data entered before this guard is not touched; the walk follows
 * only live (`isDeleted = false`) edges, so a soft-deleted link cannot be
 * part of a cycle.
 */

type LinkRow = {
  id: number;
  caseAId: number;
  caseBId: number;
  type: string;
  isDeleted: boolean;
};

export type CaseLinkReader = {
  repositoryCaseLink: {
    findMany(args: {
      where: { caseAId: { in: number[] }; type: string; isDeleted: false };
      select: { caseAId: true; caseBId: true };
    }): Promise<Array<{ caseAId: number; caseBId: number }>>;
    findUnique(args: {
      where: { id: number };
      select: {
        id: true;
        caseAId: true;
        caseBId: true;
        type: true;
        isDeleted: true;
      };
    }): Promise<LinkRow | null>;
  };
};

const LINK_SELECT = {
  id: true,
  caseAId: true,
  caseBId: true,
  type: true,
  isDeleted: true,
} as const;

// Deeper than any real dependency chain; a walk this long is already a cycle.
const MAX_DEPTH = 1000;

export const SELF_LINK_MESSAGE = "A test case cannot be linked to itself";
export const CIRCULAR_DEPENDENCY_MESSAGE =
  "This dependency would create a circular dependency between test cases";

const reject = (message: string): never => {
  const error = new ORMError(ORMErrorReason.INVALID_INPUT, message);
  error.model = "RepositoryCaseLink";
  throw error;
};

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

type Edge = { caseAId: number; caseBId: number; type: string | undefined };

/** The edge a create payload describes (scalar or `connect` form). */
function edgeOf(data: Record<string, unknown>): Edge | null {
  const caseAId =
    idOf(data.caseAId) ??
    idOf((data.caseA as { connect?: { id?: unknown } })?.connect?.id);
  const caseBId =
    idOf(data.caseBId) ??
    idOf((data.caseB as { connect?: { id?: unknown } })?.connect?.id);
  if (caseAId === undefined || caseBId === undefined) return null;
  return {
    caseAId,
    caseBId,
    type: typeof data.type === "string" ? data.type : undefined,
  };
}

/**
 * The edges a write adds or revives. Create / createMany / upsert carry them
 * in the payload; an update is only interesting when it restores a
 * soft-deleted row or re-points one, and then the row has to be read.
 */
async function requestedEdges(
  operation: string,
  args: unknown,
  reader: CaseLinkReader
): Promise<Edge[]> {
  const payload = (args ?? {}) as {
    where?: { id?: unknown };
    data?: unknown;
    create?: Record<string, unknown>;
  };

  switch (operation) {
    case "create": {
      const edge =
        payload.data && typeof payload.data === "object"
          ? edgeOf(payload.data as Record<string, unknown>)
          : null;
      return edge ? [edge] : [];
    }
    case "createMany": {
      const rows = Array.isArray(payload.data)
        ? payload.data
        : payload.data
          ? [payload.data]
          : [];
      return rows
        .map((row) => edgeOf(row as Record<string, unknown>))
        .filter((edge): edge is Edge => edge !== null);
    }
    case "upsert": {
      // A revived row has the same (caseA, caseB, type) as the create
      // payload — the unique key — so checking the create edge covers both.
      const edge = payload.create ? edgeOf(payload.create) : null;
      return edge ? [edge] : [];
    }
    case "update": {
      const data = payload.data as Record<string, unknown> | undefined;
      const id = idOf(payload.where?.id);
      if (!data || id === undefined) return [];
      const touchesEdge =
        "isDeleted" in data ||
        "type" in data ||
        "caseAId" in data ||
        "caseBId" in data ||
        "caseA" in data ||
        "caseB" in data;
      if (!touchesEdge) return [];
      const row = await reader.repositoryCaseLink.findUnique({
        where: { id },
        select: LINK_SELECT,
      });
      if (!row) return [];
      const stillDeleted =
        "isDeleted" in data ? data.isDeleted === true : row.isDeleted;
      if (stillDeleted) return [];
      const requested = edgeOf(data);
      return [
        {
          caseAId: requested?.caseAId ?? row.caseAId,
          caseBId: requested?.caseBId ?? row.caseBId,
          type: typeof data.type === "string" ? data.type : row.type,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Whether `target` is reachable from `start` along live `DEPENDS_ON` edges
 * (plus the `pending` edges of the same write, so a batch cannot close a
 * cycle among its own rows).
 */
async function dependsOnTransitively(
  reader: CaseLinkReader,
  start: number,
  target: number,
  pending: Edge[]
): Promise<boolean> {
  const visited = new Set<number>([start]);
  let frontier = [start];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const stored = await reader.repositoryCaseLink.findMany({
      where: {
        caseAId: { in: frontier },
        type: DEPENDENCY_LINK_TYPE,
        isDeleted: false,
      },
      select: { caseAId: true, caseBId: true },
    });
    const next: number[] = [];
    const frontierSet = new Set(frontier);
    const outgoing = [
      ...stored,
      ...pending.filter((e) => frontierSet.has(e.caseAId)),
    ];
    for (const edge of outgoing) {
      if (edge.caseBId === target) return true;
      if (!visited.has(edge.caseBId)) {
        visited.add(edge.caseBId);
        next.push(edge.caseBId);
      }
    }
    frontier = next;
  }
  // A walk that never terminates is itself a cycle in pre-guard data; refuse
  // to add to it rather than hang.
  return frontier.length > 0;
}

/**
 * Reject a `RepositoryCaseLink` write that links a case to itself, or whose
 * `DEPENDS_ON` edge would make a case transitively depend on itself.
 */
export async function assertValidCaseLink(
  model: string,
  operation: string,
  args: unknown,
  reader: CaseLinkReader
): Promise<void> {
  if (model !== "RepositoryCaseLink") return;
  const edges = await requestedEdges(operation, args, reader);
  if (edges.length === 0) return;

  for (const edge of edges) {
    if (edge.caseAId === edge.caseBId) reject(SELF_LINK_MESSAGE);
  }

  const dependencies = edges.filter((e) => e.type === DEPENDENCY_LINK_TYPE);
  for (const edge of dependencies) {
    // edge: caseA depends on caseB. A cycle exists if caseB already (or
    // within this batch) depends on caseA.
    const closesCycle = await dependsOnTransitively(
      reader,
      edge.caseBId,
      edge.caseAId,
      dependencies
    );
    if (closesCycle) reject(CIRCULAR_DEPENDENCY_MESSAGE);
  }
}
