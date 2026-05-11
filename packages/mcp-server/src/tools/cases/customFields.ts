import type { Prisma } from "@prisma/client";
import { zenstack } from "../../api.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

export interface ResolvedField {
  fieldId: number;
  value: unknown;
  name: string;
}

interface RawCaseField {
  id: number;
  displayName: string;
  type: { type: string | null } | null;
  fieldOptions: Array<{
    fieldOption: { id: number; name: string } | null;
  }>;
}

const CASE_FIELD_RESOLVE_SELECT = {
  id: true,
  displayName: true,
  type: { select: { type: true } },
  fieldOptions: {
    select: {
      fieldOption: { select: { id: true, name: true } },
    },
  },
} as const satisfies Prisma.CaseFieldsSelect;

/**
 * Coerce a value to an option ID. Mirrors the read-side coercion in
 * shared.ts: accepts a positive integer (number or numeric string).
 * Returns null for anything else (incl. 147.5, -3, "0", BigInt, ...).
 */
function coerceOptionId(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Resolve a single Dropdown/Multi-Select agent value into the canonical
 * option ID stored in caseFieldValues.value. Accepts either:
 *   - a numeric option ID (already canonical), OR
 *   - an option name string (the shape denormalizeCustomFields returns
 *     on the read path — closes the WR-01/WR-02 round-trip gap).
 *
 * Returns null when the value cannot be resolved to a valid option ID;
 * caller throws a 422 with the field name (NEVER the value, T-06-05).
 */
function resolveOptionValue(
  value: unknown,
  options: Array<{ id: number; name: string }>,
): number | null {
  const byId = new Map<number, true>();
  const byName = new Map<string, number>();
  for (const o of options) {
    byId.set(o.id, true);
    byName.set(o.name, o.id);
  }
  const id = coerceOptionId(value);
  if (id != null && byId.has(id)) return id;
  if (typeof value === "string" && byName.has(value)) return byName.get(value)!;
  return null;
}

/**
 * Resolve a flat `{ <displayName>: <value> }` input into resolved
 * `{ fieldId, value, name }` triples. Unknown or ambiguous display names
 * throw TestPlanItHttpError 422 — the message names the offending field
 * but NEVER includes the input value (T-06-05).
 *
 * For Dropdown / Multi-Select fields, the agent may pass either the
 * option ID (canonical) OR the option name (the read-path shape). We
 * resolve to the canonical option ID so caseFieldValues.value matches
 * what the UI / other consumers expect (closes WR-01 / WR-02).
 *
 * Ambiguity note (T-06-02): CaseFields are globally scoped (not per-project).
 * If two enabled fields share the same displayName, we throw rather than
 * silently picking one — ambiguity is a deployment configuration issue.
 */
export async function resolveCustomFields(
  input: Record<string, unknown> | undefined,
  env: EnvConfig,
): Promise<ResolvedField[]> {
  if (!input) return [];
  const names = Object.keys(input);
  if (names.length === 0) return [];

  const fields = await zenstack<RawCaseField[]>(
    "caseFields",
    "findMany",
    {
      where: {
        displayName: { in: names },
        isDeleted: false,
        isEnabled: true,
      } satisfies Prisma.CaseFieldsWhereInput,
      select: CASE_FIELD_RESOLVE_SELECT,
    },
    env,
  );

  // Group full field rows by displayName to detect ambiguity.
  const byName = new Map<string, RawCaseField[]>();
  for (const f of fields) {
    const arr = byName.get(f.displayName) ?? [];
    arr.push(f);
    byName.set(f.displayName, arr);
  }

  const resolved: ResolvedField[] = [];
  for (const name of names) {
    const matches = byName.get(name);
    if (!matches || matches.length === 0) {
      // T-06-05: message contains the FIELD NAME only, never the value.
      throw new TestPlanItHttpError(
        `Custom field '${name}' not found or not enabled in this deployment.`,
        { statusCode: 422 },
      );
    }
    if (matches.length > 1) {
      throw new TestPlanItHttpError(
        `Custom field '${name}' is ambiguous — multiple enabled fields share this display name.`,
        { statusCode: 422 },
      );
    }
    const field = matches[0]!;
    const rawValue = input[name];
    const fieldType = field.type?.type ?? null;
    const options = field.fieldOptions
      .map((a) => a.fieldOption)
      .filter((o): o is { id: number; name: string } => o != null);

    let resolvedValue: unknown = rawValue;
    if (fieldType === "Dropdown") {
      const id = resolveOptionValue(rawValue, options);
      if (id == null) {
        // T-06-05: message names the field, NEVER the value.
        throw new TestPlanItHttpError(
          `Custom field '${name}' expects a valid Dropdown option (by id or name).`,
          { statusCode: 422 },
        );
      }
      resolvedValue = id;
    } else if (fieldType === "Multi-Select") {
      if (!Array.isArray(rawValue)) {
        throw new TestPlanItHttpError(
          `Custom field '${name}' expects an array of Multi-Select options (by id or name).`,
          { statusCode: 422 },
        );
      }
      const ids: number[] = [];
      for (const v of rawValue) {
        const id = resolveOptionValue(v, options);
        if (id == null) {
          throw new TestPlanItHttpError(
            `Custom field '${name}' contains an invalid Multi-Select option (must be a known option id or name).`,
            { statusCode: 422 },
          );
        }
        ids.push(id);
      }
      resolvedValue = ids;
    }
    // Other types (Text, Number, Date, Boolean, ...) pass through; the
    // host's ZenStack policies validate the rest.

    resolved.push({ fieldId: field.id, value: resolvedValue, name });
  }
  return resolved;
}

/**
 * Upsert CaseFieldValues for a case. For each resolved field, look for an
 * existing row (findFirst by testCaseId + fieldId) and PATCH it; otherwise
 * create. This prevents duplicate rows per case+field.
 */
export async function writeCustomFieldValues(
  caseId: number,
  resolved: ResolvedField[],
  env: EnvConfig,
): Promise<void> {
  for (const r of resolved) {
    const existing = await zenstack<{ id: number } | null>(
      "caseFieldValues",
      "findFirst",
      {
        where: { testCaseId: caseId, fieldId: r.fieldId } satisfies Prisma.CaseFieldValuesWhereInput,
        select: { id: true } satisfies Prisma.CaseFieldValuesSelect,
      },
      env,
    );
    if (existing) {
      await zenstack(
        "caseFieldValues",
        "update",
        {
          where: { id: existing.id },
          data: { value: r.value },
        },
        env,
      );
    } else {
      await zenstack(
        "caseFieldValues",
        "create",
        {
          data: {
            testCase: { connect: { id: caseId } },
            field: { connect: { id: r.fieldId } },
            value: r.value,
          },
        },
        env,
      );
    }
  }
}
