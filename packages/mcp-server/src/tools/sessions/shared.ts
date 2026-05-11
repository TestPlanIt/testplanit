import {
  extractProseMirrorText,
  denormalizeCustomFields,
} from "../cases/shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed includes — every literal carries `as const<Model><Include|Select>`.
// Reintroducing an unknown column produces TS2353 (Phase 6 WR-09 invariant).
//
// CRITICAL invariants:
//   R4 — SessionResults has NO `testCaseId` FK; sessions are exploratory and
//        not case-linked. Filtering by testCaseId is impossible and any
//        attempt to do so trips Prisma.SessionResultsWhereInput's TS2353.
//   D7-12 — sessions inline up to 100 sessionResults; cap take at 101 so the
//        tool layer can detect overflow and surface truncated:true.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  state: { select: { id: true, name: true } },
  // NOTE: schema relation is `createdBy` (Sessions.createdBy), NOT `creator`.
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  // Templates.templateName is the field name on the schema (not `name`).
  // Surfaced to agents as `template: {id, name}` via the mapper.
  template: { select: { id: true, templateName: true } },
  configuration: { select: { id: true, name: true } },
  milestone: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true } },
} as const;

// SESS-02 full include — sessionFieldValues use `field.type.type` +
// `field.fieldOptions[].fieldOption` shape identical to caseFieldValues
// (SessionFieldValues.fieldId points to CaseFields per schema.zmodel:2132,
// not a separate SessionFields model). sessionResults capped at take:101
// so the tool can detect overflow per D7-12.
export const SESSION_DETAIL_INCLUDE = {
  project: { select: { id: true, name: true } },
  state: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  // Templates.templateName is the field name on the schema (not `name`).
  // Surfaced to agents as `template: {id, name}` via the mapper.
  template: { select: { id: true, templateName: true } },
  configuration: { select: { id: true, name: true } },
  milestone: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true } },
  issues: {
    where: { isDeleted: false },
    select: {
      id: true,
      externalKey: true,
      title: true,
      externalStatus: true,
      integration: { select: { provider: true } },
    },
  },
  sessionResults: {
    where: { isDeleted: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 101, // D7-12 cap — tool layer detects overflow when length > 100
    select: {
      id: true,
      createdAt: true,
      elapsed: true,
      resultData: true,
      status: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      session: { select: { id: true, name: true, projectId: true } },
    },
  },
  sessionFieldValues: {
    include: {
      field: {
        select: {
          displayName: true,
          type: { select: { type: true } },
          fieldOptions: {
            select: { fieldOption: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} as const;

export const SESSION_RESULT_LIST_INCLUDE = {
  status: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  session: { select: { id: true, name: true, projectId: true } },
} as const;

export const SESSION_RESULT_DETAIL_INCLUDE = {
  status: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  session: { select: { id: true, name: true, projectId: true } },
  attachments: {
    where: { isDeleted: false },
    select: { id: true, name: true, url: true },
  },
  issues: {
    where: { isDeleted: false },
    select: {
      id: true,
      externalKey: true,
      title: true,
      externalStatus: true,
      integration: { select: { provider: true } },
    },
  },
  resultFieldValues: {
    include: {
      field: {
        select: {
          displayName: true,
          type: { select: { type: true } },
          fieldOptions: {
            select: { fieldOption: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} as const;

// FINDING_INCLUDE — for SESS-05 sessionId mode; per-Issue row shape
export const FINDING_INCLUDE = {
  integration: { select: { provider: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// denormalizeResultFieldValues
// ─────────────────────────────────────────────────────────────────────────────

interface RawResultFieldValueRow {
  value: unknown;
  field?: {
    displayName?: string | null;
    type?: { type?: string | null } | null;
    fieldOptions?: Array<{
      fieldOption?: { id: number; name: string } | null;
    }> | null;
  } | null;
}

/**
 * Convert raw `resultFieldValues` rows into the flat `{ <displayName>: value }`
 * dict per D-08. Delegates to the Phase 6 `denormalizeCustomFields` helper:
 * ResultFields and CaseFields surface the same nested option-resolution shape
 * on read (`field.displayName / field.type.type / field.fieldOptions[].fieldOption`),
 * even though the join tables differ (`ResultFieldAssignment` vs.
 * `CaseFieldAssignment`). Verified A3 — both shapes match exactly at the
 * include level used here.
 */
export function denormalizeResultFieldValues(
  rows: RawResultFieldValueRow[] | null | undefined,
): Record<string, unknown> {
  return denormalizeCustomFields(rows as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — every output field enumerated explicitly (T-07-03 mitigation)
// ─────────────────────────────────────────────────────────────────────────────

interface RawIssue {
  id: number;
  externalKey: string | null;
  title: string | null;
  externalStatus: string | null;
  integration: { provider: string } | null;
}

function mapIssue(raw: RawIssue) {
  return {
    id: raw.id,
    externalKey: raw.externalKey,
    title: raw.title,
    externalStatus: raw.externalStatus,
    externalSystem: raw.integration?.provider ?? null,
  };
}

interface RawAttachment {
  id: number;
  name: string;
  url: string;
}

function mapAttachment(raw: RawAttachment) {
  return { id: raw.id, fileName: raw.name, url: raw.url };
}

export interface RawSessionRow {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | Date | null;
  createdAt: string | Date;
  mission: unknown;
  note: unknown;
  project: { id: number; name: string } | null;
  state: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  template: { id: number; templateName: string } | null;
  configuration: { id: number; name: string } | null;
  milestone: { id: number; name: string } | null;
  tags: Array<{ id: number; name: string }>;
}

export function mapSessionRow(raw: RawSessionRow) {
  return {
    id: raw.id,
    name: raw.name,
    isCompleted: raw.isCompleted,
    completedAt: raw.completedAt ?? null,
    createdAt: raw.createdAt,
    mission: extractProseMirrorText(raw.mission),
    note: extractProseMirrorText(raw.note),
    project: raw.project
      ? { id: raw.project.id, name: raw.project.name }
      : null,
    state: raw.state ? { id: raw.state.id, name: raw.state.name } : null,
    createdBy: raw.createdBy
      ? {
          id: raw.createdBy.id,
          name: raw.createdBy.name,
          email: raw.createdBy.email,
        }
      : null,
    assignedTo: raw.assignedTo
      ? {
          id: raw.assignedTo.id,
          name: raw.assignedTo.name,
          email: raw.assignedTo.email,
        }
      : null,
    template: raw.template
      ? { id: raw.template.id, name: raw.template.templateName }
      : null,
    configuration: raw.configuration
      ? { id: raw.configuration.id, name: raw.configuration.name }
      : null,
    milestone: raw.milestone
      ? { id: raw.milestone.id, name: raw.milestone.name }
      : null,
    tags: (raw.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

interface RawSessionResultInline {
  id: number;
  createdAt: string | Date;
  elapsed: number | null;
  resultData: unknown;
  status: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  session: { id: number; name: string; projectId: number } | null;
}

function mapSessionResultInline(raw: RawSessionResultInline) {
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    elapsed: raw.elapsed ?? null,
    resultDataText: extractProseMirrorText(raw.resultData),
    status: raw.status ? { id: raw.status.id, name: raw.status.name } : null,
    createdBy: raw.createdBy
      ? {
          id: raw.createdBy.id,
          name: raw.createdBy.name,
          email: raw.createdBy.email,
        }
      : null,
    session: raw.session
      ? {
          id: raw.session.id,
          name: raw.session.name,
          projectId: raw.session.projectId,
        }
      : null,
  };
}

export interface RawSessionDetail extends RawSessionRow {
  issues: RawIssue[];
  sessionResults: RawSessionResultInline[];
  sessionFieldValues: Array<{
    value: unknown;
    field: {
      displayName: string | null;
      type: { type: string | null } | null;
      fieldOptions: Array<{
        fieldOption: { id: number; name: string } | null;
      }>;
    } | null;
  }>;
}

export interface SessionDetailFlags {
  truncated: boolean;
}

export function mapSessionDetail(
  raw: RawSessionDetail,
  flags: SessionDetailFlags,
) {
  return {
    ...mapSessionRow(raw),
    issues: (raw.issues ?? []).map(mapIssue),
    customFields: denormalizeCustomFields(raw.sessionFieldValues as never),
    sessionResults: (raw.sessionResults ?? []).map(mapSessionResultInline),
    truncated: flags.truncated,
  };
}

export interface RawSessionResultRow extends RawSessionResultInline {}

export function mapSessionResultRow(raw: RawSessionResultRow) {
  return mapSessionResultInline(raw);
}

export interface RawSessionResultDetail extends RawSessionResultRow {
  attachments: RawAttachment[];
  issues: RawIssue[];
  resultFieldValues: Array<{
    value: unknown;
    field: {
      displayName: string | null;
      type: { type: string | null } | null;
      fieldOptions: Array<{
        fieldOption: { id: number; name: string } | null;
      }>;
    } | null;
  }>;
}

export function mapSessionResultDetail(raw: RawSessionResultDetail) {
  return {
    ...mapSessionResultInline(raw),
    customFields: denormalizeResultFieldValues(raw.resultFieldValues),
    attachments: (raw.attachments ?? []).map(mapAttachment),
    issues: (raw.issues ?? []).map(mapIssue),
  };
}

export interface RawFinding {
  id: number;
  externalKey: string | null;
  title: string | null;
  status: string | null;
  externalStatus: string | null;
  priority: string | null;
  integration: { provider: string } | null;
}

export function mapFinding(raw: RawFinding) {
  return {
    id: raw.id,
    externalKey: raw.externalKey,
    title: raw.title,
    status: raw.status,
    externalStatus: raw.externalStatus,
    priority: raw.priority,
    externalSystem: raw.integration?.provider ?? null,
  };
}
