import { z } from "zod/v4";

/**
 * Parameter type enum mirroring the ZenStack ParameterType enum on
 * TestCaseParameter (schema.zmodel). Kept in sync manually because the
 * Prisma-generated enum lives in @prisma/client and importing it here
 * would pull a heavy module into Edge-runtime callers.
 */
export const parameterTypeSchema = z.enum([
  "STRING",
  "INTEGER",
  "BOOLEAN",
  "SELECT",
]);

/**
 * Per-type value validation schema. Used at run-creation time (Phase 3) to
 * coerce dataset row values against the parameter schema before
 * snapshotting into iteration.valuesJson.
 *
 * STRING -> z.string(); INTEGER -> z.number().int(); BOOLEAN -> z.boolean().
 * Floats are rejected because PARAM-02 specifies INTEGER, not numeric.
 *
 * Phase 1 ships the type definition; Phase 3 wires it into the run-creation
 * orchestrator.
 */
export const parameterValueSchema = z.union([
  z.string(),
  z.number().int(),
  z.boolean(),
]);

/**
 * Boundary-layer SELECT XOR enforcement. Used by Phase 2 parameter
 * create/update mutation sites BEFORE they hit the enhanced ZenStack
 * client. Provides:
 *   - Friendly user-facing error messages (i18n-ready in Phase 2)
 *   - Pre-DB feedback latency
 *
 * The @@validate clause on TestCaseParameter (Plan 01-01) is the
 * load-bearing enforcement: it fires on every path including server
 * actions and seed scripts. This Zod schema is the belt-and-suspenders.
 *
 * Invariants enforced:
 *   - SELECT type: exactly one of allowedValuesJson / lookupDataSetId set.
 *   - non-SELECT type: both allowedValuesJson and lookupDataSetId must be
 *     null/undefined.
 */
export const parameterCreateSchema = z
  .object({
    testCaseId: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().nullish(),
    type: parameterTypeSchema,
    defaultValue: z.unknown().nullish(),
    order: z.number().int().nonnegative().default(0),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    allowedValuesJson: z.array(z.string()).nullish(),
    lookupDataSetId: z.number().int().positive().nullish(),
  })
  .superRefine((val, ctx) => {
    const isSelect = val.type === "SELECT";
    const hasInline = val.allowedValuesJson != null;
    const hasLookup = val.lookupDataSetId != null;

    if (isSelect) {
      // XOR: exactly one of the two source fields must be set.
      if (hasInline === hasLookup) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "SELECT parameters require exactly one of allowedValuesJson or lookupDataSetId",
          path: ["allowedValuesJson"],
        });
      }
    } else {
      // Non-SELECT: both source fields must be null/undefined.
      if (hasInline || hasLookup) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Non-SELECT parameters must not specify allowedValuesJson or lookupDataSetId",
          path: ["type"],
        });
      }
    }
  });
