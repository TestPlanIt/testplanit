import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// LINK_INCLUDE — typed include literal for RepositoryCaseLink reads.
//
// Selects denormalized counterpart cases (caseA, caseB) and the actor who
// created the link. The `as const satisfies Prisma.RepositoryCaseLinkInclude`
// annotation pins the shape: any unknown column reintroduced here trips
// TS2353 — the same compile-time invariant the rest of the read tools rely on.
// ─────────────────────────────────────────────────────────────────────────────

export const LINK_INCLUDE = {
  caseA: {
    select: {
      id: true,
      name: true,
      source: true,
      automated: true,
    },
  },
  caseB: {
    select: {
      id: true,
      name: true,
      source: true,
      automated: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} as const satisfies Prisma.RepositoryCaseLinkInclude;

export interface RawLinkCase {
  id: number;
  name: string;
  source: string;
  automated: boolean;
}

export interface RawLinkRow {
  id: number;
  type: string;
  createdAt: Date | string;
  caseA: RawLinkCase | null;
  caseB: RawLinkCase | null;
  createdBy: { id: string; name: string | null; email: string } | null;
}

function caseShape(raw: RawLinkCase | null) {
  return raw
    ? {
        id: raw.id,
        name: raw.name,
        source: raw.source,
        automated: raw.automated,
      }
    : null;
}

function createdByShape(raw: RawLinkRow["createdBy"]) {
  return raw
    ? { id: raw.id, name: raw.name, email: raw.email }
    : null;
}

/**
 * Directional mapper — returns both `caseA` and `caseB`. Used in caseAId /
 * caseBId modes where the agent supplied a one-way endpoint and wants both
 * sides of every matching edge.
 */
export function mapLinkRowDirectional(raw: RawLinkRow) {
  return {
    id: raw.id,
    type: raw.type,
    createdAt: raw.createdAt,
    createdBy: createdByShape(raw.createdBy),
    caseA: caseShape(raw.caseA),
    caseB: caseShape(raw.caseB),
  };
}

/**
 * Bidirectional "other side" mapper — returns whichever of caseA/caseB has
 * `id !== queriedCaseId`. Used in `caseId` mode where the agent supplied
 * a single case and wants its counterparts denormalized inline.
 *
 * Behavior:
 *   - caseA.id === queriedCaseId → otherCase = caseB
 *   - caseB.id === queriedCaseId → otherCase = caseA
 *   - Either side null (defensive) → otherCase = whichever side is non-null,
 *     or null if both are.
 */
export function mapLinkRowOtherCase(raw: RawLinkRow, queriedCaseId: number) {
  const otherCase =
    raw.caseA && raw.caseA.id === queriedCaseId
      ? caseShape(raw.caseB)
      : caseShape(raw.caseA);
  return {
    id: raw.id,
    type: raw.type,
    createdAt: raw.createdAt,
    createdBy: createdByShape(raw.createdBy),
    otherCase,
  };
}
