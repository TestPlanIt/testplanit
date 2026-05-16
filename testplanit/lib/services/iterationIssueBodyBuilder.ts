// Failed-iteration linked-issue body builder (INT-05).
//
// Produces `{ title, description }` for a "Create linked Issue" flow opened
// from a failed iteration drill-down. The description is a TipTap doc —
// each adapter (Jira, GitHub, Azure DevOps) renders it to the tracker's
// native format at send time (D-15).

import { prisma as defaultPrisma } from "~/lib/prisma";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import { buildIterationDeepLink } from "~/lib/services/iterationDeepLink";

// ── Type shapes ───────────────────────────────────────────────────────
//
// The `client` shape is intentionally a tiny subset of `PrismaClient` —
// just enough to load the iteration and count siblings. Tests pass mocks
// without dragging the full Prisma type system in.

export interface PrismaLike {
  testRunCaseIteration: {
    findUnique: (args: any) => Promise<any>;
    count: (args: any) => Promise<number>;
  };
}

export interface IterationIssueBodyInput {
  iterationId: number;
  /** Whether the viewer (the user creating the issue) is permitted to
   *  see sensitive parameter values. Computed at the caller (per D-13). */
  viewerCanReadSensitive: boolean;
  /** Optional Prisma-like client override (tests). Production callers omit
   *  this and the helper uses the real `~/lib/prisma` client. */
  client?: PrismaLike;
}

export interface IterationIssueBody {
  title: string;
  /** TipTap doc shape — typed as `unknown` so the server bundle does not
   *  need to import editor runtime types. Consumers narrow at the
   *  adapter boundary. */
  description: unknown;
}

// ── parametersJson coercion ───────────────────────────────────────────
//
// The snapshot column is `Json`. Only the entries with `name + sensitive`
// are required for redaction; we mirror the helper used in submit-result
// (`parseParameterSchema` there) to stay byte-compatible.

function parseParameterSchema(value: unknown): ParameterSchemaEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ParameterSchemaEntry[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      const e = entry as Record<string, unknown>;
      out.push({
        name: String(e.name),
        sensitive: e.sensitive === true,
      });
    }
  }
  return out;
}

// ── TipTap-doc builders ───────────────────────────────────────────────
//
// Tiny helpers that produce the doc-content nodes. We keep these inline
// (rather than pulling a shared "tiptap-builder" module) so the surface
// is concrete and easy to inspect from tests.

function paragraph(...textNodes: any[]): any {
  return { type: "paragraph", content: textNodes };
}
function text(value: string, marks?: any[]): any {
  const node: any = { type: "text", text: value };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}
function tableCell(value: string): any {
  // Use a single-space sentinel for empty values (matches the markdown
  // serializer's empty-cell rule and avoids `||` rendering quirks).
  const display = value.length === 0 ? " " : value;
  return {
    type: "tableCell",
    content: [{ type: "paragraph", content: [{ type: "text", text: display }] }],
  };
}
function tableHeader(value: string): any {
  return {
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  };
}
function tableRow(...cells: any[]): any {
  return { type: "tableRow", content: cells };
}

// ── Value rendering ───────────────────────────────────────────────────

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ── Main entry point ──────────────────────────────────────────────────

export async function buildIterationIssueBody(
  input: IterationIssueBodyInput
): Promise<IterationIssueBody> {
  const client: PrismaLike = (input.client ??
    defaultPrisma) as unknown as PrismaLike;

  // 1. Load the iteration with the data we need for title + body.
  const iteration = await client.testRunCaseIteration.findUnique({
    where: { id: input.iterationId },
    select: {
      id: true,
      rowIndex: true,
      label: true,
      valuesJson: true,
      ciExtended: true,
      testRunCase: {
        select: {
          id: true,
          testRunId: true,
          repositoryCase: { select: { name: true } },
          testRun: { select: { id: true, projectId: true } },
          dataSetSnapshot: { select: { parametersJson: true } },
        },
      },
    },
  });

  if (!iteration) {
    throw new Error(
      `buildIterationIssueBody: iteration ${input.iterationId} not found`
    );
  }

  const trc = iteration.testRunCase;
  const caseName: string = trc?.repositoryCase?.name ?? "Test case";
  const projectId: number = trc?.testRun?.projectId ?? 0;
  const runId: number = trc?.testRun?.id ?? 0;
  const testRunCaseId: number = trc?.id ?? 0;
  const iterationNumber = iteration.rowIndex + 1;
  const isCiExtended: boolean = iteration.ciExtended === true;

  // 2. Total iteration count for the "of M" suffix on snapshot-born rows.
  const totalIterations = isCiExtended
    ? null
    : await client.testRunCaseIteration.count({
        where: {
          testRunCaseId,
          isDeleted: false,
        },
      });

  // 3. Title.
  const title = isCiExtended
    ? `Iteration ${iterationNumber} (CI-extended) failed: ${caseName}`
    : `Iteration ${iterationNumber} of ${totalIterations} failed: ${caseName}`;

  // 4. Redact values per the viewer permission (D-13).
  const paramSchema = parseParameterSchema(trc?.dataSetSnapshot?.parametersJson);
  const rawValues = (iteration.valuesJson ?? {}) as Record<string, unknown>;
  const displayValues = redactValues(
    rawValues,
    paramSchema,
    input.viewerCanReadSensitive
  );

  // 5. Build the TipTap doc.
  //    - paragraph: prose lead
  //    - table: parameter name → value
  //    - paragraph: deep link
  const content: any[] = [];

  const leadLabel = iteration.label ?? `Row ${iterationNumber}`;
  if (isCiExtended) {
    content.push(
      paragraph(
        text(
          `Iteration ${iterationNumber} (CI-extended) failed on `
        ),
        text(leadLabel, [{ type: "code" }]),
        text(".")
      )
    );
  } else {
    content.push(
      paragraph(
        text(
          `Iteration ${iterationNumber} of ${totalIterations} failed on `
        ),
        text(leadLabel, [{ type: "code" }]),
        text(".")
      )
    );
  }

  // Table: only when we have parameter values to render. CI-extended rows
  // (no snapshot) skip the table.
  const valueEntries = Object.entries(displayValues);
  if (!isCiExtended && valueEntries.length > 0) {
    const rows: any[] = [];
    rows.push(tableRow(tableHeader("Parameter"), tableHeader("Value")));
    for (const [name, value] of valueEntries) {
      rows.push(tableRow(tableCell(name), tableCell(renderValue(value))));
    }
    content.push({ type: "table", content: rows });
  }

  // Deep link
  const href = buildIterationDeepLink({
    projectId,
    runId,
    iterationNumber,
    testRunCaseId,
  });
  content.push(
    paragraph(
      text("View iteration in TestPlanIt", [
        { type: "link", attrs: { href } },
      ])
    )
  );

  return {
    title,
    description: { type: "doc", content },
  };
}
