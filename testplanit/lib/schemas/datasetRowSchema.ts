import { z } from "zod/v4";

/**
 * Server-side Zod schemas for DataSet row mutations and CSV import row
 * validation. The `buildRowSchemaFromParameters` factory returns a Zod
 * schema that mirrors the parameter set — it's the runtime guard for
 * dataset row writes (auto-save grid edits + CSV import wizard commit).
 */

export const dataSetRowCreateSchema = z.object({
  dataSetId: z.number().int(),
  label: z.string().nullable(),
  rowIndex: z.number().int(),
  valuesJson: z.record(z.string(), z.unknown()),
});

export const csvImportRowSchema = z.object({
  label: z.string().nullable().optional(),
  values: z.record(z.string(), z.unknown()),
});

export interface ParameterShape {
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  required: boolean;
  /**
   * Inline allowed values for SELECT parameters — populated from the
   * parameter's `allowedValuesJson` column (already the parsed array).
   */
  allowedValuesJson?: unknown;
  /**
   * Resolved allowed values from the lookup dataset for SELECT parameters
   * with `lookupDataSetId`. The caller resolves the lookup dataset's rows
   * (cross-project filter applied) and passes the column values here.
   */
  lookupAllowedValues?: string[];
}

function cellSchemaFor(p: ParameterShape): z.ZodTypeAny {
  switch (p.type) {
    case "STRING": {
      const base = p.required ? z.string().min(1) : z.string();
      return base;
    }
    case "INTEGER": {
      // Coerce strings to integers (CSV cells arrive as strings).
      return z.coerce.number().int();
    }
    case "BOOLEAN": {
      // Accept literal booleans and the string forms 'true'/'false'
      // (CSV cells arrive as strings; checkbox toggles arrive as boolean).
      return z
        .union([
          z.boolean(),
          z.literal("true").transform(() => true),
          z.literal("false").transform(() => false),
          z.literal("True").transform(() => true),
          z.literal("False").transform(() => false),
          z.literal("TRUE").transform(() => true),
          z.literal("FALSE").transform(() => false),
        ])
        .pipe(z.boolean());
    }
    case "SELECT": {
      const allowed = inferAllowedValues(p);
      if (allowed.length === 0) {
        // No values resolvable — fall back to a string at minimum.
        return z.string();
      }
      const literals = allowed.map((v) => z.literal(v));
      // z.union requires at least 2 — for a single-allowed list, anchor
      // with z.literal directly.
      if (literals.length === 1) {
        return literals[0];
      }
      return z.union(literals as unknown as readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    }
    default:
      return z.unknown();
  }
}

function inferAllowedValues(p: ParameterShape): string[] {
  if (Array.isArray(p.lookupAllowedValues) && p.lookupAllowedValues.length > 0) {
    return p.lookupAllowedValues.map(String);
  }
  if (Array.isArray(p.allowedValuesJson)) {
    return (p.allowedValuesJson as unknown[]).map(String);
  }
  return [];
}

/**
 * Builds a Zod object schema from a list of parameter shapes. Each
 * parameter contributes a key whose schema reflects its `type`. Optional
 * parameters wrap their cell schema in `.optional().nullable()`.
 *
 * Used by:
 *   - `import-csv/route.ts` — pre-flight validates every CSV row before
 *     any DB insert; partial failure rolls back the entire commit.
 *   - The dataset grid (Plan 02-04) for client-side per-cell coercion.
 */
export function buildRowSchemaFromParameters(
  parameters: ParameterShape[],
): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of parameters) {
    const cell = cellSchemaFor(p);
    if (p.required) {
      shape[p.name] = cell;
    } else {
      shape[p.name] = cell.optional().nullable();
    }
  }
  return z.object(shape);
}
