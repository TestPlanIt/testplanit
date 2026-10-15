/**
 * Live-DB proof that a plain `null` written to a nullable Json column lands
 * as SQL NULL on every ORM client the app constructs.
 *
 * ZenStack v3 only accepts the `DbNull` / `JsonNull` sentinels for a `Json?`
 * field, but reads return SQL NULL as a plain `null`, so any read-then-write
 * path (the copy/move worker, CSV import, …) failed on the first empty value.
 * `jsonNullPlugin` rewrites `null` → `DbNull` on the way in. This suite checks
 * that rewrite through the three client factories, through a transaction
 * opened by `withAuditGuc` (the worker path), through a nested create, and
 * then sweeps every nullable Json field in the schema so a new one is covered
 * without a per-field test. A plugin-free control client proves the sweep
 * actually reaches ZenStack's validation.
 *
 * Run:
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/json-null-writes.test.ts
 */
import { DbNull, type JsonValue } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildGucPayload, withAuditGuc } from "~/lib/audit/gucContext";
import {
  disconnectAllTenantClients,
  getTenantDbClient,
} from "~/lib/multiTenantDb";
import { createRawDbClient } from "~/lib/rawDbClient";
import { rawClient, type DbClient } from "~/lib/zenstack";
import { schema } from "~/zenstack/schema";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const STAMP = `jsonnull-${Date.now()}`;
const TENANT_ID = "jsonnull";

const STEP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Open" }] }],
};

type FieldMeta = {
  type: string;
  optional?: boolean;
  array?: boolean;
  relation?: unknown;
};
type ModelMeta = { fields: Record<string, FieldMeta>; idFields: string[] };
const MODELS = schema.models as unknown as Record<string, ModelMeta>;
const TYPE_DEF_NAMES = new Set(
  Object.keys((schema as { typeDefs?: Record<string, unknown> }).typeDefs ?? {})
);

/** Every `Model.field` that is a nullable Json (or typed-Json) scalar. */
const NULLABLE_JSON_FIELDS: Array<{ model: string; field: string }> = [];
for (const [model, meta] of Object.entries(MODELS)) {
  for (const [field, f] of Object.entries(meta.fields)) {
    if (
      f.optional &&
      !f.relation &&
      !f.array &&
      (f.type === "Json" || TYPE_DEF_NAMES.has(f.type))
    ) {
      NULLABLE_JSON_FIELDS.push({ model, field });
    }
  }
}

const accessorOf = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1);

/** A `where` no row can match, built from the model's id fields. */
function impossibleWhere(model: string): Record<string, unknown> {
  const meta = MODELS[model];
  const where: Record<string, unknown> = {};
  for (const id of meta.idFields) {
    const type = meta.fields[id]?.type;
    if (type === "Int" || type === "BigInt") where[id] = -1;
    else if (type === "String") where[id] = `__${STAMP}__`;
  }
  if (Object.keys(where).length === 0) {
    throw new Error(
      `No Int/String id field on ${model} to build a no-op where`
    );
  }
  return where;
}

type LooseClient = Record<
  string,
  { updateMany: (args: unknown) => Promise<unknown> }
>;

/** Every message down the `cause` chain, so a ZodError wrapped by an ORMError is visible. */
function failureText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current && typeof current === "object") {
    const { message, cause } = current as {
      message?: unknown;
      cause?: unknown;
    };
    if (typeof message === "string") parts.push(message);
    current = cause;
  }
  return parts.join("\n");
}

/**
 * `updateMany` with `{ [field]: null }` against no rows exercises ZenStack's
 * input validation and nothing else. Resolves to "ok", or to the failure
 * text: a model's `@@validate` rule may still reject a partial payload, so
 * the assertions look at WHY a write was rejected rather than whether.
 */
const sweep = (client: unknown, model: string, field: string) =>
  (client as LooseClient)[accessorOf(model)]
    .updateMany({ where: impossibleWhere(model), data: { [field]: null } })
    .then(() => "ok", failureText);

const REJECTED_NULL = /expected DbNullClass, received null/;

describeIntegration("nullable Json writes land as SQL NULL", () => {
  const standalone = createRawDbClient();
  // The same dialect with every plugin stripped: what a client looks like
  // when it is built outside the factory.
  const control = standalone.$unuseAll();
  let tenant: DbClient;

  let userId: string;
  let projectId: number;
  let caseId: number;
  const createdCaseIds: number[] = [];
  const createdGroupIds: number[] = [];

  beforeAll(async () => {
    const [{ current_database: dbName }] = await rawClient.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!/^tpi_/.test(dbName)) {
      throw new Error(
        `refusing to run against database "${dbName}" — use a tpi_* scratch DB`
      );
    }

    process.env.TENANT_CONFIGS = JSON.stringify({
      [TENANT_ID]: { databaseUrl: process.env.DATABASE_URL },
    });
    tenant = getTenantDbClient(TENANT_ID);

    const admin = await rawClient.user.findFirst({
      where: { access: "ADMIN" },
    });
    if (!admin)
      throw new Error("Test prerequisite: no ADMIN user (db/seed.ts)");
    userId = admin.id;

    const project = await rawClient.projects.findFirst({
      where: { isDeleted: false },
    });
    if (!project) throw new Error("Test prerequisite: no seeded project");
    projectId = project.id;
    const repository = await rawClient.repositories.findFirst({
      where: { projectId, isActive: true, isDeleted: false },
    });
    const folder = await rawClient.repositoryFolders.findFirst({
      where: { projectId, isDeleted: false },
    });
    const template = await rawClient.templates.findFirst({
      where: { isDeleted: false },
    });
    const state = await rawClient.workflows.findFirst({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    if (!repository || !folder || !template || !state) {
      throw new Error(
        "Test prerequisite: seeded repository/folder/template/state"
      );
    }

    const created = await rawClient.repositoryCases.create({
      data: {
        projectId,
        repositoryId: repository.id,
        folderId: folder.id,
        templateId: template.id,
        stateId: state.id,
        creatorId: userId,
        name: `${STAMP} source`,
        order: 0,
        currentVersion: 1,
      },
    });
    caseId = created.id;
    createdCaseIds.push(caseId);
  });

  afterAll(async () => {
    if (createdGroupIds.length) {
      await rawClient.sharedStepGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
    }
    if (createdCaseIds.length) {
      await rawClient.repositoryCases.deleteMany({
        where: { id: { in: createdCaseIds } },
      });
    }
    await standalone.$disconnect();
    await disconnectAllTenantClients();
  });

  /** `jsonb_typeof` straight from Postgres: NULL for SQL NULL, 'null' for JSON null. */
  async function storedKind(stepId: number) {
    const [row] = await rawClient.$queryRaw<
      Array<{ step: string | null; expected: string | null }>
    >`SELECT jsonb_typeof("step") AS step, jsonb_typeof("expectedResult") AS expected FROM "Steps" WHERE id = ${stepId}`;
    return row;
  }

  it("copies a step whose expected result reads back as null (the worker path)", async () => {
    const seeded = await rawClient.steps.create({
      data: {
        testCaseId: caseId,
        order: 0,
        step: STEP_DOC,
        expectedResult: DbNull,
      },
    });
    expect(await storedKind(seeded.id)).toEqual({
      step: "object",
      expected: null,
    });

    // What the copy/move worker does: read the source rows, write them back
    // unchanged inside withAuditGuc's transaction. The read value is a plain
    // null, which the ORM would reject without the plugin.
    const [source] = await rawClient.steps.findMany({
      where: { id: seeded.id },
    });
    expect(source.expectedResult).toBeNull();
    const loose = source as unknown as Record<string, JsonValue>;

    const copied = await withAuditGuc(
      standalone,
      buildGucPayload(userId),
      (tx) =>
        tx.steps.create({
          data: {
            testCaseId: caseId,
            order: 1,
            step: loose.step,
            expectedResult: loose.expectedResult,
          },
        })
    );
    expect(await storedKind(copied.id)).toEqual({
      step: "object",
      expected: null,
    });
  });

  it("writes SQL NULL, not JSON null, through every client", async () => {
    for (const [name, client] of [
      ["rawClient", rawClient],
      ["createRawDbClient", standalone],
      ["tenant", tenant],
    ] as const) {
      const row = await client.steps.create({
        data: {
          testCaseId: caseId,
          order: 10,
          step: null as unknown as JsonValue,
          expectedResult: null as unknown as JsonValue,
        },
      });
      expect(await storedKind(row.id), name).toEqual({
        step: null,
        expected: null,
      });
      const back = await client.steps.findUnique({ where: { id: row.id } });
      expect(back?.expectedResult, name).toBeNull();
    }
  });

  it("normalizes a nested create through a relation", async () => {
    const updated = await rawClient.repositoryCases.update({
      where: { id: caseId },
      data: {
        steps: {
          create: [
            {
              order: 20,
              step: STEP_DOC,
              expectedResult: null as unknown as JsonValue,
            },
          ],
        },
      },
      include: { steps: { where: { order: 20 } } },
    });
    expect(updated.steps).toHaveLength(1);
    expect(await storedKind(updated.steps[0].id)).toEqual({
      step: "object",
      expected: null,
    });
  });

  it("normalizes createMany, upsert and updateMany payloads", async () => {
    await rawClient.steps.createMany({
      data: [
        {
          testCaseId: caseId,
          order: 30,
          step: STEP_DOC,
          expectedResult: null as unknown as JsonValue,
        },
      ],
    });
    const many = await rawClient.steps.findFirstOrThrow({
      where: { testCaseId: caseId, order: 30 },
    });
    expect(await storedKind(many.id)).toEqual({
      step: "object",
      expected: null,
    });

    const upserted = await rawClient.steps.upsert({
      where: { id: -1 },
      create: {
        testCaseId: caseId,
        order: 31,
        step: STEP_DOC,
        expectedResult: null as unknown as JsonValue,
      },
      update: { expectedResult: null as unknown as JsonValue },
    });
    expect(await storedKind(upserted.id)).toEqual({
      step: "object",
      expected: null,
    });

    await rawClient.steps.updateMany({
      where: { id: upserted.id },
      data: { step: null as unknown as JsonValue },
    });
    expect(await storedKind(upserted.id)).toEqual({
      step: null,
      expected: null,
    });
  });

  it("still rejects null on a required Json field", async () => {
    const group = await rawClient.sharedStepGroup.create({
      data: { name: `${STAMP} group`, projectId, createdById: userId },
    });
    createdGroupIds.push(group.id);
    await expect(
      rawClient.sharedStepItem.create({
        data: {
          sharedStepGroupId: group.id,
          order: 0,
          step: null as unknown as JsonValue,
          expectedResult: STEP_DOC,
        },
      })
    ).rejects.toThrow();
  });

  it("lists every nullable Json field in the schema", () => {
    expect(NULLABLE_JSON_FIELDS.length).toBeGreaterThan(0);
    expect(NULLABLE_JSON_FIELDS).toContainEqual({
      model: "Steps",
      field: "expectedResult",
    });
  });

  it("the plugin-free control client rejects null on each of them", async () => {
    for (const { model, field } of NULLABLE_JSON_FIELDS) {
      expect(await sweep(control, model, field), `${model}.${field}`).toMatch(
        REJECTED_NULL
      );
    }
  });

  it("no app client rejects null on any of them", async () => {
    for (const [name, client] of [
      ["rawClient", rawClient],
      ["createRawDbClient", standalone],
      ["tenant", tenant],
    ] as const) {
      for (const { model, field } of NULLABLE_JSON_FIELDS) {
        expect(
          await sweep(client, model, field),
          `${name} ${model}.${field}`
        ).not.toMatch(REJECTED_NULL);
      }
    }
  });
});
