import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUDITED_CONFIG_MODELS,
  AUDITED_RPC_ENTITY_ACCESSORS,
  ENTITY_NAME_FIELDS,
  PROJECT_SCOPE_PARENTS,
  PROJECT_SCOPED_ENTITY_TYPES,
  RPC_ENTITY_TYPE_MAP,
} from "./auditLog";
import { ENTITY_AUDIT_MODELS } from "./entityAuditHooks";

// Guards the audit "wiring" against the singular/plural accessor typo class that
// silently disabled auditing for issues, shared step groups, and attachments:
//   - The RPC route shim only audits an accessor in AUDITED_RPC_ENTITY_ACCESSORS
//     when it equals the real Prisma client field. `issues` (vs `issue`) /
//     `sharedStepGroups` (vs `sharedStepGroup`) never matched → no audit.
//   - The lib/db.ts `$extends` query block is cast `as any`, so a hook keyed
//     to a non-existent model (`sharedStepGroups:`, `attachment:`) is silent
//     dead code — the audit + ES-sync + webhook side effects never run.
// Both surfaces are validated here against the schema (source of truth) so a
// future accessor typo fails loudly instead of silently dropping audit rows.
const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, "../../schema.zmodel"), "utf8");
const modelNames = new Set(
  [...schema.matchAll(/^\s*model\s+(\w+)\b/gm)].map((m) => m[1])
);
const toAccessor = (name: string) =>
  name.charAt(0).toLowerCase() + name.slice(1);
const validAccessors = new Set([...modelNames].map(toAccessor));

// Parse each model's declared field names and note which carry a scalar
// `projectId Int` column. Field lines are indented `fieldName Type ...`; we
// skip block-level attributes (`@@`), field attributes (`@`), comments, and the
// `model X {` / `}` delimiters. This lets the guards below cross-check the
// audit display-name and project-scope maps against the datamodel — the source
// of the `Sessions: "title"` (real column is `name`) and
// `UserIntegrationAuth: ["userId","integrationType"]` (real column is
// `integrationId`) name-field typo class.
const modelFields = new Map<string, Set<string>>();
const modelsWithScalarProjectId = new Set<string>();
{
  let current: string | null = null;
  for (const rawLine of schema.split("\n")) {
    const modelStart = rawLine.match(/^\s*model\s+(\w+)\s*\{/);
    if (modelStart) {
      current = modelStart[1];
      modelFields.set(current, new Set());
      continue;
    }
    if (current && /^\s*\}/.test(rawLine)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const fieldMatch = rawLine.match(/^\s+([a-z][a-zA-Z0-9_]*)\s+(\S+)/);
    if (!fieldMatch) continue;
    const [, fieldName, fieldType] = fieldMatch;
    modelFields.get(current)!.add(fieldName);
    if (fieldName === "projectId" && /^Int\b/.test(fieldType)) {
      modelsWithScalarProjectId.add(current);
    }
  }
}

// Every entityType audited via a GENERIC emitter (the RPC route shim, the
// admin-config hook factory, or the bespoke entity-audit hook factory) resolves
// a missing projectId only through the worker backfill, which is gated on
// PROJECT_SCOPED_ENTITY_TYPES. So any such type with a scalar projectId column
// MUST be in that set. (M3 call sites that pass projectId explicitly — e.g.
// DataSet — are intentionally NOT in these generic lists and so are excluded.)
const genericallyAuditedEntityTypes = new Set<string>([
  ...Object.values(RPC_ENTITY_TYPE_MAP),
  ...AUDITED_CONFIG_MODELS.map((c) => c.entityType),
  ...ENTITY_AUDIT_MODELS.map((c) => c.entityType),
]);

// entityTypes whose display name is resolved at the call site from related
// rows / FKs rather than a scalar field, so they intentionally have no
// ENTITY_NAME_FIELDS entry (TestRunResults: named two relations away via
// resolveTestRunResultAuditScope; ReviewRequest: the writable RPC path is the
// CANCELLED status flip, which carries no natural display name).
const NAME_VIA_SPECIAL_RESOLUTION = new Set([
  "TestRunResults",
  "ReviewRequest",
]);

describe("RPC audit wiring guard", () => {
  it("contains exactly the semantic/security accessors (DATA accessors removed)", () => {
    const SEMANTIC_ACCESSORS = [
      "user",
      "userProjectPermission",
      "groupProjectPermission",
      "ssoProvider",
      "allowedEmailDomain",
      "appConfig",
      "apiToken",
    ];
    expect([...AUDITED_RPC_ENTITY_ACCESSORS].sort()).toEqual(
      SEMANTIC_ACCESSORS.slice().sort()
    );
    // DATA accessors must no longer be present.
    const DATA_ACCESSORS = [
      "repositoryCases",
      "testRuns",
      "sessions",
      "sharedStepGroup",
      "issue",
      "milestones",
      "projects",
      "userIntegrationAuth",
      "testRunResults",
      "comment",
      "reviewRequest",
    ];
    for (const accessor of DATA_ACCESSORS) {
      expect(AUDITED_RPC_ENTITY_ACCESSORS).not.toContain(accessor);
    }
  });

  it.each([...AUDITED_RPC_ENTITY_ACCESSORS])(
    "accessor %s is a real Prisma client field",
    (accessor) => {
      expect(validAccessors.has(accessor)).toBe(true);
    }
  );

  it("has unique accessors (no duplicate audit keys)", () => {
    expect(new Set(AUDITED_RPC_ENTITY_ACCESSORS).size).toBe(
      AUDITED_RPC_ENTITY_ACCESSORS.length
    );
  });

  it("RPC_ENTITY_TYPE_MAP keys are exactly the audited accessors", () => {
    expect(Object.keys(RPC_ENTITY_TYPE_MAP).sort()).toEqual(
      [...AUDITED_RPC_ENTITY_ACCESSORS].sort()
    );
  });

  it.each(Object.entries(RPC_ENTITY_TYPE_MAP))(
    "%s -> %s: entityType is a real model and round-trips to the accessor",
    (accessor, entityType) => {
      expect(modelNames.has(entityType)).toBe(true);
      expect(toAccessor(entityType)).toBe(accessor);
    }
  );

  it.each(Object.values(RPC_ENTITY_TYPE_MAP))(
    "entityType %s has a display-name field (or is name-via-special-resolution)",
    (entityType) => {
      if (NAME_VIA_SPECIAL_RESOLUTION.has(entityType)) return;
      expect(ENTITY_NAME_FIELDS[entityType]).toBeDefined();
    }
  );
});

describe("sideEffectsPlugin model dispatch keys are real models", () => {
  // The v3 side-effects (ES sync / webhook emit / business logic) moved from the
  // lib/db.ts `$extends` block into the sideEffectsPlugin afterEntityMutation
  // switch, which dispatches by PascalCase model name at 8-space indentation,
  // e.g. `        case "RepositoryCases": {`. TypeScript already enforces these
  // against GetModels<Schema>, but this stays as a cheap dead-branch guard.
  const pluginSource = readFileSync(
    resolve(here, "../zenstack-plugins/sideEffectsPlugin.ts"),
    "utf8"
  );
  const hookModels = [
    ...pluginSource.matchAll(/^ {8}case "([A-Z][a-zA-Z0-9_]*)":/gm),
  ].map((m) => m[1]);

  it("dispatches on the expected models (sanity)", () => {
    expect(hookModels).toContain("RepositoryCases");
    expect(hookModels).toContain("Issue");
    expect(hookModels.length).toBeGreaterThanOrEqual(10);
  });

  it.each(hookModels)("hook model %s is a real Prisma model", (model) => {
    expect(modelNames.has(model)).toBe(true);
  });
});

describe("project-scope backfill set", () => {
  it("only contains real model entity types", () => {
    for (const entityType of PROJECT_SCOPED_ENTITY_TYPES) {
      expect(modelNames.has(entityType)).toBe(true);
    }
  });

  it("includes SharedStepGroup (scalar projectId, backfilled on partial RPC result)", () => {
    expect(PROJECT_SCOPED_ENTITY_TYPES.has("SharedStepGroup")).toBe(true);
  });

  it("includes Comment (scalar projectId column; audited via the RPC `comment` path)", () => {
    expect(PROJECT_SCOPED_ENTITY_TYPES.has("Comment")).toBe(true);
  });
});

describe("ENTITY_NAME_FIELDS reference real model columns", () => {
  // The audit display name is read as `row[field]` after a committed re-read, so
  // a scalar field that is not a real column silently yields a null entityName
  // (the `Sessions: "title"` / `UserIntegrationAuth: "integrationType"` bug
  // class). Dot-notation fields name from a relation, so we validate the
  // relation field exists; composite (array) fields validate each member.
  it.each(Object.entries(ENTITY_NAME_FIELDS))(
    "%s name field(s) exist on the model",
    (entityType, field) => {
      const fields = modelFields.get(entityType);
      expect(
        fields,
        `model ${entityType} not found in schema.zmodel`
      ).toBeDefined();
      const members = Array.isArray(field) ? field : [field];
      for (const member of members) {
        // Dot-notation ("relation.field") names from a related row; the relation
        // accessor must be a declared field of this model.
        const own = member.includes(".") ? member.split(".", 1)[0] : member;
        expect(
          fields!.has(own),
          `${entityType}.${own} (from ENTITY_NAME_FIELDS["${entityType}"]) is not a column`
        ).toBe(true);
      }
    }
  );
});

describe("project-scope completeness for generically-audited types", () => {
  // Catches the inverse of the Comment bug: a generically-audited entity that
  // has a scalar projectId column but was never added to the backfill set,
  // leaving its audit rows with a null projectId on the partial RPC path.
  it.each([...genericallyAuditedEntityTypes])(
    "%s with a scalar projectId column is in PROJECT_SCOPED_ENTITY_TYPES",
    (entityType) => {
      if (!modelsWithScalarProjectId.has(entityType)) return;
      expect(
        PROJECT_SCOPED_ENTITY_TYPES.has(entityType),
        `${entityType} has a scalar projectId column but is missing from PROJECT_SCOPED_ENTITY_TYPES — its audit rows will have a null projectId`
      ).toBe(true);
    }
  );

  it("every scalar-scoped type in the set actually has a projectId column (no stale entries)", () => {
    for (const entityType of PROJECT_SCOPED_ENTITY_TYPES) {
      // Parent-relation-scoped types reach projectId through an ancestor and
      // legitimately lack a scalar column.
      if (PROJECT_SCOPE_PARENTS[entityType]) continue;
      expect(
        modelsWithScalarProjectId.has(entityType),
        `${entityType} is in PROJECT_SCOPED_ENTITY_TYPES but has no scalar projectId column and no PROJECT_SCOPE_PARENTS entry`
      ).toBe(true);
    }
  });
});
