import { zenstack } from "../../api.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

export interface ResolvedField {
  fieldId: number;
  value: unknown;
  name: string;
}

/**
 * Resolve a flat `{ <displayName>: <value> }` input into resolved
 * `{ fieldId, value, name }` triples. Unknown or ambiguous display names
 * throw TestPlanItHttpError 422 — the message names the offending field
 * but NEVER includes the input value (T-06-05).
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

  const fields = await zenstack<Array<{ id: number; displayName: string }>>(
    "caseFields",
    "findMany",
    {
      where: {
        displayName: { in: names },
        isDeleted: false,
        isEnabled: true,
      },
      select: { id: true, displayName: true },
    },
    env,
  );

  // Group field IDs by displayName to detect ambiguity.
  const byName = new Map<string, number[]>();
  for (const f of fields) {
    const arr = byName.get(f.displayName) ?? [];
    arr.push(f.id);
    byName.set(f.displayName, arr);
  }

  const resolved: ResolvedField[] = [];
  for (const name of names) {
    const ids = byName.get(name);
    if (!ids || ids.length === 0) {
      // T-06-05: message contains the FIELD NAME only, never the value.
      throw new TestPlanItHttpError(
        `Custom field '${name}' not found or not enabled in this deployment.`,
        { statusCode: 422 },
      );
    }
    if (ids.length > 1) {
      throw new TestPlanItHttpError(
        `Custom field '${name}' is ambiguous — multiple enabled fields share this display name.`,
        { statusCode: 422 },
      );
    }
    resolved.push({ fieldId: ids[0]!, value: input[name], name });
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
        where: { testCaseId: caseId, fieldId: r.fieldId },
        select: { id: true },
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
