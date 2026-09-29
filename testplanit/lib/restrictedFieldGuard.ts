import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";
import { ApplicationArea } from "~/zenstack/models";

/** The reads the guard needs, on a client without plugins. */
export type RestrictedFieldReader = {
  caseFields: {
    findMany(args: {
      where: { id: { in: number[] }; isRestricted: true };
      select: { id: true; displayName: true; type: { select: { type: true } } };
    }): Promise<
      Array<{ id: number; displayName: string; type: { type: string } | null }>
    >;
  };
  caseFieldValues: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: { fieldId: true; testCaseId: true; value: true };
    }): Promise<{ fieldId: number; testCaseId: number; value: unknown } | null>;
  };
  repositoryCases: {
    findUnique(args: {
      where: { id: number };
      select: { projectId: true };
    }): Promise<{ projectId: number } | null>;
  };
};

type Actor = { id?: string; access?: string | null } | undefined;
type Row = Record<string, unknown>;

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const connectedId = (row: Row, relation: string, scalar: string) =>
  idOf(row[scalar]) ??
  idOf((row[relation] as { connect?: { id?: unknown } })?.connect?.id);

/**
 * A comparable form of a stored or submitted value. The web UI re-saves every
 * field, including the restricted ones it shows read-only, and the editor may
 * re-serialize an untouched document, so compare meaning, not bytes: the text
 * of a rich-text value, numbers whether sent as numbers or strings, and
 * option lists regardless of order. Blank means no value.
 */
function comparable(fieldType: string, value: unknown): string {
  if (value == null || value === "") return "";
  if (fieldType === "Text Long") {
    return extractTextFromNode(ensureTipTapJSON(value)).trim();
  }
  if (Array.isArray(value)) {
    return JSON.stringify([...value].map(String).sort());
  }
  if (typeof value === "string" && value.trim() !== "" && !isNaN(+value)) {
    return String(Number(value));
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Refuse a change to a restricted custom field from a user who lacks the
 * TestCaseRestrictedFields add/edit permission. The web UI only disables
 * those inputs, so without this the MCP server or any REST client could
 * write them.
 *
 * Applies to writes made as a user (the policy client). Server-side writers
 * with no actor are trusted: the case importer runs its own check. An
 * unchanged value passes, so re-saving a case leaves restricted fields alone.
 */
export async function assertRestrictedFieldWrite(
  model: string,
  operation: string,
  args: unknown,
  actor: Actor,
  reader: RestrictedFieldReader
): Promise<void> {
  if (model !== "CaseFieldValues") return;
  if (!actor?.id || actor.access === "ADMIN") return;
  if (!args || typeof args !== "object") return;

  const payload = args as {
    where?: Record<string, unknown>;
    data?: unknown;
    create?: unknown;
    update?: unknown;
  };
  const writes: Array<{ row: Row; isUpdate: boolean }> = [];
  const add = (row: unknown, isUpdate: boolean) => {
    if (row && typeof row === "object" && "value" in (row as Row)) {
      writes.push({ row: row as Row, isUpdate });
    }
  };
  if (
    operation === "create" ||
    operation === "createMany" ||
    operation === "createManyAndReturn"
  ) {
    for (const row of Array.isArray(payload.data)
      ? payload.data
      : [payload.data]) {
      add(row, false);
    }
  } else if (operation === "update" || operation === "updateMany") {
    add(payload.data, true);
  } else if (operation === "upsert") {
    add(payload.create, false);
    add(payload.update, true);
  }
  if (writes.length === 0) return;

  const existing =
    writes.some((w) => w.isUpdate) && payload.where
      ? await reader.caseFieldValues.findFirst({
          where: payload.where,
          select: { fieldId: true, testCaseId: true, value: true },
        })
      : null;

  const resolved = writes.map(({ row, isUpdate }) => ({
    row,
    fieldId:
      connectedId(row, "field", "fieldId") ??
      (isUpdate ? existing?.fieldId : undefined),
    caseId:
      connectedId(row, "testCase", "testCaseId") ??
      (isUpdate ? existing?.testCaseId : undefined),
    before: isUpdate ? existing?.value : undefined,
  }));
  const fieldIds = [
    ...new Set(resolved.map((r) => r.fieldId).filter((id) => id !== undefined)),
  ] as number[];
  if (fieldIds.length === 0) return;

  const restricted = await reader.caseFields.findMany({
    where: { id: { in: fieldIds }, isRestricted: true },
    select: { id: true, displayName: true, type: { select: { type: true } } },
  });
  if (restricted.length === 0) return;
  const byId = new Map(restricted.map((f) => [f.id, f]));

  const permitted = new Map<number, boolean>();
  for (const w of resolved) {
    const field = w.fieldId !== undefined ? byId.get(w.fieldId) : undefined;
    if (!field) continue;
    const type = field.type?.type ?? "";
    if (comparable(type, w.before) === comparable(type, w.row.value)) continue;
    if (w.caseId === undefined) continue;

    const project = await reader.repositoryCases.findUnique({
      where: { id: w.caseId },
      select: { projectId: true },
    });
    if (!project) continue;
    let allowed = permitted.get(project.projectId);
    if (allowed === undefined) {
      allowed = await userCanAddEditArea(
        actor.id,
        project.projectId,
        ApplicationArea.TestCaseRestrictedFields,
        actor.access
      );
      permitted.set(project.projectId, allowed);
    }
    if (!allowed) {
      const error = new ORMError(
        ORMErrorReason.REJECTED_BY_POLICY,
        `Custom field '${field.displayName}' is restricted; you do not have permission to change it.`
      );
      error.model = "CaseFieldValues";
      throw error;
    }
  }
}
