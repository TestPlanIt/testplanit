import { extractProseMirrorText } from "../cases/shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed includes — every literal carries `as const`.
// Adding an unknown column produces TS2353 at compile time (Phase 6 WR-09).
//
// Pitfall 7 (Phase 6 retrofit): `externalSystem` is NOT a column on Issue —
// it is derived from `integration.provider` at the mapper boundary. Reintroducing
// the externalSystem column in the select trips Prisma.IssueSelect's TS2353 wall.
//
// D8-06 / D7-12: each linked-array include declares `take: 101` so the get
// handler can detect overflow and stamp `truncated.<key>: true`. The cap is
// expressed as `LINKED_ARRAYS_INLINE_CAP_PLUS_ONE` so the +1 is intentional,
// not a magic number.
// ─────────────────────────────────────────────────────────────────────────────

export const ISSUE_ROW_INCLUDE = {
  integration: { select: { id: true, name: true, provider: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { repositoryCases: true } },
} as const;

const LINKED_ARRAYS_INLINE_CAP_PLUS_ONE = 101;

export const ISSUE_DETAIL_INCLUDE = {
  ...ISSUE_ROW_INCLUDE,
  repositoryCases: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINKED_ARRAYS_INLINE_CAP_PLUS_ONE,
    select: { id: true, name: true, source: true, automated: true },
  },
  sessions: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINKED_ARRAYS_INLINE_CAP_PLUS_ONE,
    select: {
      id: true,
      name: true,
      mission: true,
      isCompleted: true,
      state: { select: { id: true, name: true } },
    },
  },
  testRuns: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINKED_ARRAYS_INLINE_CAP_PLUS_ONE,
    select: {
      id: true,
      name: true,
      isCompleted: true,
      completedAt: true,
    },
  },
} as const;

export const ISSUE_LINKED_ARRAYS_INLINE_CAP = 100;

export interface RawIssueIntegration {
  id: number;
  name: string;
  provider: string;
}

export interface RawIssueRow {
  id: number;
  projectId: number | null;
  externalKey: string | null;
  title: string | null;
  name: string | null;
  status: string | null;
  externalStatus: string | null;
  externalUrl: string | null;
  createdAt: Date | string;
  lastSyncedAt: Date | string | null;
  integration: RawIssueIntegration | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count?: { repositoryCases: number };
}

export interface RawIssueDetail extends RawIssueRow {
  description: string | null;
  priority: string | null;
  issueTypeName: string | null;
  issueTypeIconUrl: string | null;
  note: unknown;
  repositoryCases: Array<{
    id: number;
    name: string;
    source: string;
    automated: boolean;
  }>;
  sessions: Array<{
    id: number;
    name: string;
    mission: unknown;
    isCompleted: boolean;
    state: { id: number; name: string } | null;
  }>;
  testRuns: Array<{
    id: number;
    name: string;
    isCompleted: boolean;
    completedAt: Date | string | null;
  }>;
}

export function mapIssueRow(raw: RawIssueRow) {
  return {
    id: raw.id,
    externalKey: raw.externalKey ?? null,
    externalSystem: raw.integration?.provider ?? null,
    externalUrl: raw.externalUrl ?? null,
    externalStatus: raw.externalStatus ?? null,
    summary: raw.title ?? raw.name ?? "",
    status: raw.status ?? null,
    projectId: raw.projectId ?? null,
    integration: raw.integration
      ? {
          id: raw.integration.id,
          name: raw.integration.name,
          provider: raw.integration.provider,
        }
      : null,
    createdBy: raw.createdBy
      ? {
          id: raw.createdBy.id,
          name: raw.createdBy.name,
          email: raw.createdBy.email,
        }
      : null,
    createdAt: raw.createdAt,
    lastSyncedAt: raw.lastSyncedAt ?? null,
    linkedCaseCount: raw._count?.repositoryCases ?? 0,
  };
}

export interface IssueDetailFlags {
  truncated: {
    linkedCases?: true;
    linkedSessions?: true;
    linkedTestRuns?: true;
  };
}

export function mapIssueDetail(raw: RawIssueDetail, flags: IssueDetailFlags) {
  const head = mapIssueRow(raw);
  return {
    ...head,
    description: raw.description ?? null,
    priority: raw.priority ?? null,
    issueTypeName: raw.issueTypeName ?? null,
    issueTypeIconUrl: raw.issueTypeIconUrl ?? null,
    note: extractProseMirrorText(raw.note),
    linkedCases: raw.repositoryCases.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      automated: c.automated,
    })),
    linkedSessions: raw.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      mission: extractProseMirrorText(s.mission),
      isCompleted: s.isCompleted,
      state: s.state ? { id: s.state.id, name: s.state.name } : null,
    })),
    linkedTestRuns: raw.testRuns.map((r) => ({
      id: r.id,
      name: r.name,
      isCompleted: r.isCompleted,
      completedAt: r.completedAt ?? null,
    })),
    truncated: flags.truncated,
  };
}
