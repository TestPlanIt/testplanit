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
 * hook cannot know without a lookup. Those are normalized by the field editors,
 * which do know the type.
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
