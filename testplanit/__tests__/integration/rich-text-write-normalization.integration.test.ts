/**
 * Live-DB proof that rich-text columns are stored in ONE shape.
 *
 * The web UI serializes Tiptap documents before writing, so `Steps.step` and
 * its siblings held either a document object or a JSON string of one depending
 * on which client last saved the row (275,171 string vs 8,370 object rows on
 * the UAT database when this was written). `sideEffectsPlugin`'s `onQuery` hook
 * normalizes writes to the object form; only a live write can prove the hook
 * actually fires through the real ORM stack, since the unit tests exercise the
 * helper in isolation.
 *
 * Asserts on `jsonb_typeof` of the raw column rather than on the value the ORM
 * reads back, because the ORM returns the parsed JSON either way — the storage
 * shape is exactly what a mocked test cannot see.
 *
 * Run:
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/rich-text-write-normalization.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DbNull } from "@zenstackhq/orm";

import { baseDb } from "~/lib/db";
import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const raw = createRawDbClient();
const STAMP = `rtn-${Date.now()}`;

const DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Open the login page" }],
    },
  ],
};

/** The stored shape, straight from Postgres. */
async function storedShape(
  table: string,
  column: string,
  id: number
): Promise<string | null> {
  const rows = await raw.$queryRawUnsafe<Array<{ shape: string | null }>>(
    `SELECT jsonb_typeof("${column}") AS shape FROM "${table}" WHERE id = $1`,
    id
  );
  return rows[0]?.shape ?? null;
}

/** A Text Long value: the jsonb type and, for a string, the document it holds. */
async function storedFieldValue(
  id: number
): Promise<{ shape: string | null; doc: any }> {
  const rows = await raw.$queryRawUnsafe<
    Array<{ shape: string | null; txt: string | null }>
  >(
    `SELECT jsonb_typeof(value) AS shape, value #>> '{}' AS txt FROM "CaseFieldValues" WHERE id = $1`,
    id
  );
  const row = rows[0];
  return {
    shape: row?.shape ?? null,
    doc: row?.shape === "string" && row.txt ? JSON.parse(row.txt) : null,
  };
}

/** Mark types on the first text node reading `needle`. */
function marksOn(node: any, needle: string): string[] | undefined {
  if (!node) return undefined;
  if (node.type === "text" && node.text === needle) {
    return (node.marks ?? []).map((m: any) => m.type);
  }
  for (const child of node.content ?? []) {
    const found = marksOn(child, needle);
    if (found) return found;
  }
  return undefined;
}

async function storedText(
  table: string,
  column: string,
  id: number
): Promise<string | null> {
  const rows = await raw.$queryRawUnsafe<Array<{ txt: string | null }>>(
    `SELECT "${column}" #>> '{content,0,content,0,text}' AS txt FROM "${table}" WHERE id = $1`,
    id
  );
  return rows[0]?.txt ?? null;
}

describeIntegration("rich-text write normalization (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let caseId: number;
  let textLongFieldId: number;
  let textStringFieldId: number;

  beforeAll(async () => {
    // The worktree .env DATABASE_URL resolves to `ew`; this suite writes and
    // hard-deletes fixture rows, so refuse anything but a scratch database.
    const [{ current_database: dbName }] = await raw.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_richtext" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_richtext scratch DB (or tpi_test in CI)`
      );
    }

    const role = await raw.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await raw.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Rich Text Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await raw.projects.create({
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const repository = await raw.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    repositoryId = repository.id;

    const folder = await raw.repositoryFolders.create({
      data: {
        name: `${STAMP}-folder`,
        repositoryId,
        projectId,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    folderId = folder.id;

    const template = await raw.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("Test prerequisite: no Templates row available");
    const caseState = await raw.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!caseState)
      throw new Error("Test prerequisite: no CASES-scoped Workflows row");

    const testCase = await raw.repositoryCases.create({
      data: {
        projectId,
        repositoryId,
        folderId,
        templateId: template.id,
        name: `${STAMP}-case`,
        stateId: caseState.id,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    caseId = testCase.id;

    const fieldType = async (type: string) => {
      const row = await raw.caseFieldTypes.findFirst({
        where: { type },
        select: { id: true },
      });
      if (!row) throw new Error(`Test prerequisite: no "${type}" field type`);
      return row.id;
    };
    const makeField = async (type: string, suffix: string) =>
      (
        await raw.caseFields.create({
          data: {
            displayName: `${STAMP} ${suffix}`,
            systemName: `${STAMP.replace(/-/g, "_")}_${suffix}`,
            typeId: await fieldType(type),
          },
          select: { id: true },
        })
      ).id;
    textLongFieldId = await makeField("Text Long", "long");
    textStringFieldId = await makeField("Text String", "short");
  }, 60_000);

  afterAll(async () => {
    if (projectId) {
      await raw.steps.deleteMany({ where: { testCaseId: caseId } });
      await raw.caseFieldValues.deleteMany({ where: { testCaseId: caseId } });
      await raw.repositoryCases.deleteMany({ where: { projectId } });
      await raw.repositoryFolders.deleteMany({ where: { projectId } });
      await raw.repositories.deleteMany({ where: { projectId } });
      await raw.projects.deleteMany({ where: { id: projectId } });
    }
    await raw.caseFields.deleteMany({
      where: {
        id: { in: [textLongFieldId, textStringFieldId].filter(Boolean) },
      },
    });
    if (adminUserId) {
      await raw.user.deleteMany({ where: { id: adminUserId } });
    }
  }, 60_000);

  it("stores a serialized document as an object on create", async () => {
    const created = await baseDb.steps.create({
      data: {
        testCaseId: caseId,
        order: 0,
        // Exactly what the web UI sends today.
        step: JSON.stringify(DOC) as never,
        expectedResult: JSON.stringify(DOC) as never,
      },
      select: { id: true },
    });

    expect(await storedShape("Steps", "step", created.id)).toBe("object");
    expect(await storedShape("Steps", "expectedResult", created.id)).toBe(
      "object"
    );
    // The document survives intact — this is a shape change, not a rewrite.
    expect(await storedText("Steps", "step", created.id)).toBe(
      "Open the login page"
    );
  });

  it("stores a document object unchanged", async () => {
    const created = await baseDb.steps.create({
      data: { testCaseId: caseId, order: 1, step: DOC as never },
      select: { id: true },
    });

    expect(await storedShape("Steps", "step", created.id)).toBe("object");
    expect(await storedText("Steps", "step", created.id)).toBe(
      "Open the login page"
    );
  });

  it("wraps genuine plain text into a document", async () => {
    const created = await baseDb.steps.create({
      data: {
        testCaseId: caseId,
        order: 2,
        step: "Access the prioritization view." as never,
      },
      select: { id: true },
    });

    expect(await storedShape("Steps", "step", created.id)).toBe("object");
    expect(await storedText("Steps", "step", created.id)).toBe(
      "Access the prioritization view."
    );
  });

  it("normalizes an update", async () => {
    const created = await baseDb.steps.create({
      data: { testCaseId: caseId, order: 3, step: DOC as never },
      select: { id: true },
    });

    await baseDb.steps.update({
      where: { id: created.id },
      data: { step: JSON.stringify(DOC) as never },
    });

    expect(await storedShape("Steps", "step", created.id)).toBe("object");
  });

  it("clears a column without normalizing the DbNull sentinel", async () => {
    const created = await baseDb.steps.create({
      data: {
        testCaseId: caseId,
        order: 4,
        step: DOC as never,
        expectedResult: DOC as never,
      },
      select: { id: true },
    });

    // v3 rejects a raw `null` for a nullable Json column and takes the DbNull
    // sentinel instead, so the hook has to leave that object untouched — had
    // it coerced the sentinel into a document, this write would store an empty
    // paragraph rather than clearing the column.
    await baseDb.steps.update({
      where: { id: created.id },
      data: { expectedResult: DbNull as never },
    });

    // SQL NULL reads back as no jsonb value at all.
    expect(await storedShape("Steps", "expectedResult", created.id)).toBeNull();
  });

  it("normalizes a rich-text column on a non-Steps model", async () => {
    // The per-model map is unit-tested; one other model here is enough to
    // show the hook is not Steps-specific.
    const folder = await baseDb.repositoryFolders.update({
      where: { id: folderId },
      data: { docs: JSON.stringify(DOC) as never },
      select: { id: true },
    });

    expect(await storedShape("RepositoryFolders", "docs", folder.id)).toBe(
      "object"
    );
  });

  it("converts Markdown step text into marks (#658)", async () => {
    const created = await baseDb.steps.create({
      data: {
        testCaseId: caseId,
        order: 5,
        step: "Open the **New leads** board" as never,
        expectedResult: "The board shows its `3` statuses" as never,
      },
      select: { id: true },
    });

    const row = await raw.steps.findUnique({
      where: { id: created.id },
      select: { step: true, expectedResult: true },
    });
    expect(marksOn(row?.step, "New leads")).toEqual(["bold"]);
    expect(marksOn(row?.expectedResult, "3")).toEqual(["code"]);
  });

  describe("Text Long custom field values", () => {
    it("stores Markdown written through a relation connect as a serialized document", async () => {
      // The shape the MCP server writes.
      const created = await baseDb.caseFieldValues.create({
        data: {
          testCase: { connect: { id: caseId } },
          field: { connect: { id: textLongFieldId } },
          value: "Created by the **beta** MCP.",
        },
        select: { id: true },
      });

      const { shape, doc } = await storedFieldValue(created.id);
      expect(shape).toBe("string");
      expect(doc.type).toBe("doc");
      expect(marksOn(doc, "beta")).toEqual(["bold"]);
    });

    it("converts an update that names only the row", async () => {
      const created = await baseDb.caseFieldValues.create({
        data: { testCaseId: caseId, fieldId: textLongFieldId, value: DbNull },
        select: { id: true },
      });

      await baseDb.caseFieldValues.update({
        where: { id: created.id },
        data: { value: "- first\n- second" },
      });

      const { doc } = await storedFieldValue(created.id);
      expect(doc.content[0].type).toBe("bulletList");
    });

    it("keeps a serialized document byte-identical", async () => {
      const serialized = JSON.stringify(DOC);
      const created = await baseDb.caseFieldValues.create({
        data: {
          testCaseId: caseId,
          fieldId: textLongFieldId,
          value: serialized,
        },
        select: { id: true },
      });

      const rows = await raw.$queryRawUnsafe<Array<{ txt: string }>>(
        `SELECT value #>> '{}' AS txt FROM "CaseFieldValues" WHERE id = $1`,
        created.id
      );
      expect(rows[0]?.txt).toBe(serialized);
    });

    it("leaves a Text String value as written", async () => {
      const created = await baseDb.caseFieldValues.create({
        data: {
          testCaseId: caseId,
          fieldId: textStringFieldId,
          value: "**not rich text**",
        },
        select: { id: true },
      });

      const rows = await raw.$queryRawUnsafe<Array<{ txt: string }>>(
        `SELECT value #>> '{}' AS txt FROM "CaseFieldValues" WHERE id = $1`,
        created.id
      );
      expect(rows[0]?.txt).toBe("**not rich text**");
    });
  });
});
