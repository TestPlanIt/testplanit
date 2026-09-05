/**
 * Live-DB proof that EVERY writer records the same version-1 snapshot.
 *
 * The bugs behind #598/#599/#600 were all "the case is right, the version row
 * is not", and none of them are visible to a mocked test: they are about what
 * actually lands in `RepositoryCaseVersions` / `CaseFieldVersionValues` after a
 * real write through the real ORM (whose `sideEffectsPlugin` rewrites rich-text
 * columns on the way in). So this suite drives each writer for real and
 * compares its snapshot against the AddCase path, which is the reference
 * implementation.
 *
 * Assertions are on `jsonb_typeof` / raw JSON straight from Postgres rather
 * than on what the ORM reads back, because the ORM parses both storage shapes
 * and would hide exactly the difference under test.
 *
 * Run:
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/case-version-writers.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { baseDb } from "~/lib/db";
import { createRawDbClient } from "~/lib/rawDbClient";
import { persistGeneratedTestCases } from "~/lib/services/testCaseImport";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const raw = createRawDbClient();
const STAMP = `cvw-${Date.now()}`;

// Seeded fixture ids (db/seed.ts): template 1 = "Default Template" with
// Priority (Dropdown), Description (Text Long), Steps (Steps), Expected
// (Text Long).
const TEMPLATE_ID = 1;
const FIELD_PRIORITY = 1;
const FIELD_DESCRIPTION = 3;
const FIELD_STEPS = 4;
const OPTION_HIGH = 2;

/** A serialized Tiptap document — what an API client sends for a step. */
const STEP_DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Open the app" }] },
  ],
};
const RESULT_DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "It opens" }] },
  ],
};
const STEP_JSON = JSON.stringify(STEP_DOC);
const RESULT_JSON = JSON.stringify(RESULT_DOC);

interface VersionSnapshot {
  versionId: number;
  version: number;
  stepShapes: (string | null)[];
  stepTexts: (string | null)[];
  tags: unknown;
  issues: unknown;
  fieldValues: { field: string; shape: string | null; value: unknown }[];
}

async function readSnapshot(caseId: number): Promise<VersionSnapshot> {
  const [version] = await raw.$queryRawUnsafe<
    Array<{ id: number; version: number; tags: unknown; issues: unknown }>
  >(
    `SELECT id, version, tags, issues FROM "RepositoryCaseVersions"
       WHERE "repositoryCaseId" = $1 ORDER BY version DESC LIMIT 1`,
    caseId
  );
  if (!version) throw new Error(`no version row for case ${caseId}`);

  const steps = await raw.$queryRawUnsafe<
    Array<{ shape: string | null; txt: string | null }>
  >(
    `SELECT jsonb_typeof(elem->'step') AS shape,
            elem #>> '{step,content,0,content,0,text}' AS txt
       FROM "RepositoryCaseVersions" v, LATERAL jsonb_array_elements(v.steps) elem
      WHERE v.id = $1`,
    version.id
  );

  const fieldValues = await raw.$queryRawUnsafe<
    Array<{ field: string; shape: string | null; value: unknown }>
  >(
    `SELECT field, jsonb_typeof(value) AS shape, value
       FROM "CaseFieldVersionValues" WHERE "versionId" = $1 ORDER BY field`,
    version.id
  );

  return {
    versionId: version.id,
    version: version.version,
    stepShapes: steps.map((s) => s.shape),
    stepTexts: steps.map((s) => s.txt),
    tags: version.tags,
    issues: version.issues,
    fieldValues,
  };
}

/** The live Steps rows, as Postgres holds them. */
async function readCaseSteps(
  caseId: number
): Promise<{ shape: string | null; txt: string | null }[]> {
  return raw.$queryRawUnsafe(
    `SELECT jsonb_typeof(step) AS shape,
            step #>> '{content,0,content,0,text}' AS txt
       FROM "Steps" WHERE "testCaseId" = $1 AND "isDeleted" = false
      ORDER BY "order"`,
    caseId
  );
}

describeIntegration("case version writers (live DB)", () => {
  let userId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let stateId: number;
  let tagId: number;
  const createdCaseIds: number[] = [];

  beforeAll(async () => {
    // The worktree .env DATABASE_URL resolves to `ew`; this suite creates and
    // hard-deletes fixtures, so refuse anything but a scratch database.
    const [{ current_database: dbName }] = await raw.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_caseversions" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — use the tpi_caseversions scratch DB (or tpi_test in CI)`
      );
    }

    const admin = await raw.user.findFirst({ where: { access: "ADMIN" } });
    if (!admin)
      throw new Error("Test prerequisite: no ADMIN user (run db/seed.ts)");
    userId = admin.id;

    const project = await raw.projects.findFirst({
      where: { isDeleted: false },
    });
    if (!project) throw new Error("Test prerequisite: no seeded project");
    projectId = project.id;

    const repository = await raw.repositories.findFirst({
      where: { projectId, isActive: true, isDeleted: false },
    });
    if (!repository) throw new Error("Test prerequisite: no active repository");
    repositoryId = repository.id;

    const folder = await raw.repositoryFolders.findFirst({
      where: { projectId, isDeleted: false },
    });
    if (!folder) throw new Error("Test prerequisite: no repository folder");
    folderId = folder.id;

    const state = await raw.workflows.findFirst({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    if (!state) throw new Error("Test prerequisite: no CASES workflow state");
    stateId = state.id;

    const tag = await raw.tags.create({
      data: { name: `${STAMP}-smoke`, isDeleted: false },
    });
    tagId = tag.id;
  });

  afterAll(async () => {
    for (const caseId of createdCaseIds) {
      const versions = await raw.repositoryCaseVersions.findMany({
        where: { repositoryCaseId: caseId },
        select: { id: true },
      });
      for (const v of versions) {
        await raw.caseFieldVersionValues.deleteMany({
          where: { versionId: v.id },
        });
      }
      await raw.repositoryCaseVersions.deleteMany({
        where: { repositoryCaseId: caseId },
      });
      await raw.caseFieldValues.deleteMany({ where: { testCaseId: caseId } });
      await raw.steps.deleteMany({ where: { testCaseId: caseId } });
      await raw.repositoryCaseTag.deleteMany({ where: { caseId } });
      await raw.repositoryCaseIssue.deleteMany({ where: { caseId } });
      await raw.repositoryCases.deleteMany({ where: { id: caseId } });
    }
    if (tagId) await raw.tags.deleteMany({ where: { id: tagId } });
    await raw.$disconnect();
  });

  function baseInput(name: string) {
    return {
      projectId,
      projectName: "Project",
      repositoryId,
      folderId,
      folderName: "Folder",
      templateId: TEMPLATE_ID,
      templateName: "Default Template",
      stateId,
      stateName: "Draft",
      maxOrder: 0,
      autoGenerateTags: false,
      source: "MANUAL" as const,
      fieldMappings: [],
      testCases: [{ id: `${name}-1`, name, fieldValues: {} }],
    };
  }

  async function runImport(input: any): Promise<number> {
    const result = await persistGeneratedTestCases(input, {
      userId,
      userName: "Integration Runner",
    });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("success");
    const caseId = result.importedIds[0]!;
    createdCaseIds.push(caseId);
    return caseId;
  }

  // ── The reference: what AddCase sends ────────────────────────────────────
  // AddCase.tsx builds `fieldValuesById` + `versionFieldValues` from the same
  // `dynamicFields` values, skipping the Steps field, and passes tag/issue
  // names separately as versionTags/versionIssues.
  async function addCaseWrite(): Promise<number> {
    const input: any = baseInput(`${STAMP} addcase`);
    input.testCases[0] = {
      ...input.testCases[0],
      fieldValuesById: {
        [FIELD_PRIORITY]: OPTION_HIGH,
        [FIELD_DESCRIPTION]: JSON.stringify(STEP_DOC),
      },
      versionFieldValues: [
        { field: "Priority", value: OPTION_HIGH },
        { field: "Description", value: JSON.stringify(STEP_DOC) },
      ],
      tagIds: [tagId],
      versionTags: [`${STAMP}-smoke`],
      steps: [{ step: STEP_DOC, expectedResult: RESULT_DOC }],
    };
    return runImport(input);
  }

  // ── bulk-create (the MCP cases_create_many route) ────────────────────────
  // The route resolves tags to ids and passes steps through as the caller's
  // strings; it sends NO versionTags/versionFieldValues.
  async function bulkCreateWrite(): Promise<number> {
    const input: any = baseInput(`${STAMP} bulkcreate`);
    input.fieldMappings = [
      {
        fieldName: "Priority",
        caseFieldId: FIELD_PRIORITY,
        fieldType: "Dropdown",
        fieldOptions: [{ id: OPTION_HIGH, name: "High" }],
      },
      {
        fieldName: "Description",
        caseFieldId: FIELD_DESCRIPTION,
        fieldType: "Text Long",
      },
    ];
    input.testCases[0] = {
      ...input.testCases[0],
      fieldValues: { Priority: "High", Description: STEP_JSON },
      tagIds: [tagId],
      steps: [{ step: STEP_JSON, expectedResult: RESULT_JSON }],
    };
    return runImport(input);
  }

  it("AddCase records the reference snapshot", async () => {
    const caseId = await addCaseWrite();
    const snap = await readSnapshot(caseId);

    expect(snap.version).toBe(1);
    // Steps are documents, and they read back as prose.
    expect(snap.stepShapes).toEqual(["object"]);
    expect(snap.stepTexts).toEqual(["Open the app"]);
    expect(snap.tags).toEqual([`${STAMP}-smoke`]);
    // A Steps-type field is NEVER a version field value.
    expect(snap.fieldValues.map((f) => f.field)).toEqual([
      "Description",
      "Priority",
    ]);
    expect(snap.fieldValues.find((f) => f.field === "Priority")).toMatchObject({
      shape: "number",
      value: OPTION_HIGH,
    });
  });

  it("bulk-create matches AddCase: parsed steps, real tags, no Steps field", async () => {
    const caseId = await bulkCreateWrite();
    const snap = await readSnapshot(caseId);
    const caseSteps = await readCaseSteps(caseId);

    // #600: a serialized Tiptap document used to be wrapped as literal text,
    // so the version page rendered a raw JSON blob.
    expect(snap.stepShapes).toEqual(["object"]);
    expect(snap.stepTexts).toEqual(["Open the app"]);
    // …and the snapshot agrees with the Steps rows the same import wrote.
    expect(snap.stepTexts).toEqual(caseSteps.map((s) => s.txt));

    // #600: tags resolved to ids by the caller used to snapshot as [].
    expect(snap.tags).toEqual([`${STAMP}-smoke`]);

    expect(snap.fieldValues.map((f) => f.field)).not.toContain("Steps");
    expect(snap.fieldValues.find((f) => f.field === "Priority")).toMatchObject({
      shape: "number",
      value: OPTION_HIGH,
    });
  });

  it("bulk-create's snapshot is shaped exactly like AddCase's", async () => {
    const reference = await readSnapshot(await addCaseWrite());
    const underTest = await readSnapshot(await bulkCreateWrite());

    const shapeOf = (s: VersionSnapshot) => ({
      stepShapes: s.stepShapes,
      stepTexts: s.stepTexts,
      tags: s.tags,
      fields: s.fieldValues.map((f) => ({ field: f.field, shape: f.shape })),
    });

    expect(shapeOf(underTest)).toEqual(shapeOf(reference));
  });

  it("a Steps-type field value never reaches the version snapshot", async () => {
    const caseId = await addCaseWrite();

    // Give the case a Steps-type CaseFieldValues row — 696 such rows exist on
    // the UAT database — then snapshot with copyFieldValues, which is what the
    // MCP and import-wizard paths ask for.
    await raw.caseFieldValues.create({
      data: {
        testCaseId: caseId,
        fieldId: FIELD_STEPS,
        value: "steps-field-blob",
      },
    });

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { currentVersion: 2 },
    });
    await createTestCaseVersionInTransaction(baseDb, caseId, {
      copyFieldValues: true,
    });

    const snap = await readSnapshot(caseId);
    expect(snap.version).toBe(2);
    expect(snap.fieldValues.map((f) => f.field)).toEqual([
      "Description",
      "Priority",
    ]);
    expect(snap.fieldValues.map((f) => f.field)).not.toContain("Steps");
  });

  // Every writer that snapshots a case has to carry the custom field values
  // with it. bulk-edit, parameterMutations, stepSequenceConversionService and
  // the copyMove "copy" branch all called the helper WITHOUT copyFieldValues,
  // so their versions rendered as though the fields had been cleared. Proven
  // here against the shared helper each of them calls.
  it("a snapshot taken after a case edit still carries its field values", async () => {
    const caseId = await addCaseWrite();

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { currentVersion: { increment: 1 } },
    });
    await createTestCaseVersionInTransaction(baseDb, caseId, {
      creatorId: userId,
      copyFieldValues: true,
    });

    const snap = await readSnapshot(caseId);
    expect(snap.version).toBe(2);
    expect(snap.fieldValues.map((f) => f.field)).toEqual([
      "Description",
      "Priority",
    ]);
  });

  it("without copyFieldValues a snapshot records no field values at all", async () => {
    const caseId = await addCaseWrite();

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { currentVersion: { increment: 1 } },
    });
    // This is what bulk-edit / parameter edits / shared-step extraction /
    // case copy used to do, and why the history showed empty fields.
    await createTestCaseVersionInTransaction(baseDb, caseId, {
      creatorId: userId,
    });

    const snap = await readSnapshot(caseId);
    expect(snap.version).toBe(2);
    expect(snap.fieldValues).toEqual([]);
  });

  it("copyFieldValues reproduces AddCase's field values verbatim", async () => {
    const reference = await readSnapshot(await addCaseWrite());

    const caseId = await addCaseWrite();
    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { currentVersion: 2 },
    });
    await createTestCaseVersionInTransaction(baseDb, caseId, {
      copyFieldValues: true,
    });

    const copied = await readSnapshot(caseId);
    expect(copied.version).toBe(2);
    // Same keys, same jsonb shapes, same values as the AddCase-authored rows.
    expect(copied.fieldValues).toEqual(reference.fieldValues);
  });
});
