/**
 * Phase 3 Wave 5 (Task 12) — Zod factory for iteration value overrides.
 *
 * Both the override dialog (`OverrideValuesDialog.tsx`) and the PATCH route
 * (`/api/repository/test-runs/[runId]/cases/[caseId]/iterations/[iterId]/values`)
 * consume this builder so client-side validation matches server-side
 * validation exactly. The shape is keyed by parameter name with a type-aware
 * validator per entry.
 *
 * SELECT validators are populated from the snapshot's `allowedValuesJson`
 * (caller resolves that from `parametersJson` before invoking). The snapshot
 * is authoritative — live `TestCaseParameter.allowedValuesJson` may have
 * changed since run-creation and must not be trusted at override time.
 */

import { z } from "zod/v4";

export interface OverrideParameterSchemaEntry {
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  required?: boolean;
  sensitive?: boolean;
  allowedValues?: string[] | null;
}

/**
 * Build a Zod object whose keys are parameter names with type-aware
 * validators. `parametersSchema` typically comes from the snapshot's
 * `parametersJson` column.
 *
 * Behavior:
 *   - STRING  -> `z.string().max(2048)` (optional/nullable when !required)
 *   - INTEGER -> `z.coerce.number().int()` (optional/nullable when !required)
 *   - BOOLEAN -> `z.coerce.boolean()` (always defined; false acts as default)
 *   - SELECT  -> `z.enum([...allowedValues])` (optional/nullable when !required)
 *
 * Empty strings on optional STRING/INTEGER/SELECT are coerced to `null` so
 * the form can submit a "cleared" cell without violating the validator.
 */
export function buildIterationOverrideSchema(
  parametersSchema: OverrideParameterSchemaEntry[]
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const p of parametersSchema) {
    let validator: z.ZodTypeAny;
    const required = p.required !== false;

    switch (p.type) {
      case "STRING": {
        const base = z.string().max(2048);
        validator = required
          ? base.min(1)
          : z.preprocess(
              (v) => (v === "" || v == null ? null : v),
              base.nullable().optional()
            );
        break;
      }
      case "INTEGER": {
        const base = z.coerce.number().int();
        validator = required
          ? base
          : z.preprocess(
              (v) => (v === "" || v == null ? null : v),
              base.nullable().optional()
            );
        break;
      }
      case "BOOLEAN": {
        validator = z.coerce.boolean();
        break;
      }
      case "SELECT": {
        const allowed = p.allowedValues ?? [];
        if (allowed.length === 0) {
          // No allowed values declared on the snapshot — fall back to a
          // permissive string validator. Materializer should always supply
          // a non-empty list for SELECT params, but a missing list must
          // not crash the form.
          validator = required
            ? z.string().min(1)
            : z.preprocess(
                (v) => (v === "" || v == null ? null : v),
                z.string().nullable().optional()
              );
        } else {
          const enumValidator = z.enum(allowed as [string, ...string[]]);
          validator = required
            ? enumValidator
            : z.preprocess(
                (v) => (v === "" || v == null ? null : v),
                enumValidator.nullable().optional()
              );
        }
        break;
      }
      default: {
        validator = z.unknown();
      }
    }

    shape[p.name] = validator;
  }

  return z.object(shape);
}
