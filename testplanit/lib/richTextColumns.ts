/**
 * One storage shape for rich-text columns.
 *
 * Tiptap documents live in `Json` columns, and the app grew two ways of
 * writing them: the web UI persists `JSON.stringify(doc)`, so the column holds
 * a JSON *string*, while the MCP server, the CSV import and the version
 * services write the document *object*. Both are valid JSON values, so the
 * same column comes back in either shape depending on which client last saved
 * the row. That split is not cosmetic — it made API readers parse two forms,
 * text filters match the document's markup instead of its prose, and
 * Elasticsearch index the raw JSON.
 *
 * The object is canonical: it is what the column type means, it keeps the
 * document reachable by Postgres' JSON operators, and it is what every text
 * extractor already expects. `normalizeRichTextWrite` is applied in
 * `sideEffectsPlugin`'s `onQuery` hook so it covers every writer that goes
 * through the ORM — the model route, server code and the policy client alike —
 * rather than relying on each call site to remember.
 *
 * Only single-purpose rich-text columns are listed. The `value` columns on the
 * *FieldValues tables are deliberately absent: they are polymorphic (a Number
 * field stores a number, Multi-Select an array, Text String a plain string),
 * so whether the value is a document depends on the field's type, which this
 * hook cannot know without a lookup. `CaseFieldValues` gets that lookup in
 * `normalizeTextLongFieldValueWrite` below.
 */
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

/** Model name -> the model's own rich-text `Json` fields. */
export const RICH_TEXT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  Comment: ["content"],
  Issue: ["note"],
  IssueVersions: ["note"],
  Milestones: ["note", "docs"],
  RepositoryFolders: ["docs"],
  SessionResults: ["resultData"],
  Sessions: ["note", "mission"],
  SessionVersions: ["note", "mission"],
  SharedStepItem: ["step", "expectedResult"],
  Steps: ["step", "expectedResult"],
  TestRunCaseIteration: ["notes"],
  TestRunCases: ["notes"],
  TestRunResults: ["notes", "evidence"],
  TestRunStepResults: ["notes", "evidence"],
  TestRuns: ["note", "docs"],
} as const;

/**
 * Convert one field value to the canonical shape.
 *
 * Only strings are rewritten. `null` and `undefined` mean "cleared" and must
 * stay that way — `ensureTipTapJSON` would turn them into an empty document
 * and lose that distinction. Objects are already canonical, and that includes
 * the ORM's `DbNull` / `JsonNull` sentinels, which must reach the driver
 * untouched.
 */
function canonicalize(value: unknown): unknown {
  return typeof value === "string" ? ensureTipTapJSON(value) : value;
}

function normalizeDataObject(
  data: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    if (!(field in data)) continue;
    const current = data[field];
    // A nested update expression (`{ set: … }`) carries the value one level
    // down; anything else with a shape we don't recognise is left alone.
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      "set" in (current as Record<string, unknown>)
    ) {
      const wrapper = current as Record<string, unknown>;
      wrapper.set = canonicalize(wrapper.set);
      continue;
    }
    data[field] = canonicalize(current);
  }
}

/**
 * Normalize the rich-text fields of a write in place.
 *
 * Handles the payload shapes the ORM accepts: `data` as an object (create,
 * update, updateMany), `data` as an array (createMany), and upsert's separate
 * `create` / `update` branches. Returns silently for models with no rich-text
 * columns, which is the overwhelming majority of writes.
 */
export function normalizeRichTextWrite(model: string, args: unknown): void {
  const fields = RICH_TEXT_COLUMNS[model];
  if (!fields || !args || typeof args !== "object") return;

  const payload = args as {
    data?: unknown;
    create?: unknown;
    update?: unknown;
  };

  for (const branch of [payload.data, payload.create, payload.update]) {
    if (!branch) continue;
    if (Array.isArray(branch)) {
      for (const row of branch) {
        if (row && typeof row === "object") {
          normalizeDataObject(row as Record<string, unknown>, fields);
        }
      }
    } else if (typeof branch === "object") {
      normalizeDataObject(branch as Record<string, unknown>, fields);
    }
  }
}

/**
 * The reads `normalizeTextLongFieldValueWrite` needs, on a client without the
 * plugins (so the lookup neither re-enters this hook nor pays for policies).
 */
export type FieldTypeReader = {
  caseFields: {
    findMany(args: {
      where: { id: { in: number[] } };
      select: { id: true; type: { select: { type: true } } };
    }): Promise<Array<{ id: number; type: { type: string } | null }>>;
  };
  caseFieldValues: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: { fieldId: true };
    }): Promise<{ fieldId: number } | null>;
  };
};

type FieldValueRow = Record<string, unknown>;

const hasTextValue = (row: FieldValueRow): boolean =>
  typeof row.value === "string" && row.value.trim() !== "";

const fieldIdOf = (row: FieldValueRow): number | undefined => {
  if (typeof row.fieldId === "number") return row.fieldId;
  const connectId = (row.field as { connect?: { id?: unknown } } | undefined)
    ?.connect?.id;
  return typeof connectId === "number" ? connectId : undefined;
};

/**
 * Store a string written to a Text Long `CaseFieldValues.value` as a
 * serialized Tiptap document, converting Markdown, HTML or plain text the
 * way the bulk-create route and CSV import do.
 *
 * The serialized string is the shape the web UI and the importers already
 * write, and re-serializing one of those is byte-identical, so only writers
 * that send raw text (the MCP server) see a change. Other field types,
 * non-string values and blank strings are left alone, and a write with no
 * string value runs no lookup at all.
 *
 * Covers create, createMany, update and upsert. `updateMany` is not
 * converted: one value applied across rows of possibly different fields has
 * no single right shape.
 */
export async function normalizeTextLongFieldValueWrite(
  model: string,
  operation: string,
  args: unknown,
  reader: FieldTypeReader
): Promise<void> {
  if (model !== "CaseFieldValues" || !args || typeof args !== "object") return;

  const payload = args as {
    where?: Record<string, unknown>;
    data?: unknown;
    create?: unknown;
    update?: unknown;
  };

  // Each row paired with the fieldId it writes, when the row itself says.
  const rows: Array<{ row: FieldValueRow; fieldId?: number }> = [];
  const add = (row: unknown) => {
    if (row && typeof row === "object" && hasTextValue(row as FieldValueRow)) {
      rows.push({
        row: row as FieldValueRow,
        fieldId: fieldIdOf(row as FieldValueRow),
      });
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
      add(row);
    }
  } else if (operation === "update") {
    add(payload.data);
  } else if (operation === "upsert") {
    add(payload.create);
    add(payload.update);
  }
  if (rows.length === 0) return;

  // An update usually names only the row, not the field it belongs to.
  const unresolved = rows.filter((r) => r.fieldId === undefined);
  if (unresolved.length > 0 && payload.where) {
    const existing = await reader.caseFieldValues.findFirst({
      where: payload.where,
      select: { fieldId: true },
    });
    for (const r of unresolved) r.fieldId = existing?.fieldId;
  }

  const fieldIds = [
    ...new Set(rows.map((r) => r.fieldId).filter((id) => id !== undefined)),
  ] as number[];
  if (fieldIds.length === 0) return;

  const fields = await reader.caseFields.findMany({
    where: { id: { in: fieldIds } },
    select: { id: true, type: { select: { type: true } } },
  });
  const textLong = new Set(
    fields.filter((f) => f.type?.type === "Text Long").map((f) => f.id)
  );

  for (const { row, fieldId } of rows) {
    if (fieldId !== undefined && textLong.has(fieldId)) {
      row.value = JSON.stringify(ensureTipTapJSON(row.value));
    }
  }
}
