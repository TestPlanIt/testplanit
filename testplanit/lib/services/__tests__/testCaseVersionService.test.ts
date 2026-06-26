import { describe, expect, it, vi } from "vitest";

import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";

interface TestCaseFixtureOverrides {
  parameters?: Array<{
    id: number;
    name: string;
    description: string | null;
    type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
    defaultValue: string | null;
    order: number;
    required: boolean;
    sensitive: boolean;
    allowedValuesJson: unknown | null;
    lookupDataSetId: number | null;
  }>;
}

function buildTestCaseFixture(overrides: TestCaseFixtureOverrides = {}) {
  return {
    id: 1,
    projectId: 10,
    repositoryId: 20,
    folderId: 30,
    templateId: 40,
    stateId: 50,
    creatorId: "user-1",
    name: "Test Case",
    estimate: null,
    forecastManual: null,
    forecastAutomated: null,
    automated: false,
    isArchived: false,
    order: 1,
    currentVersion: 2,
    project: { name: "Project" },
    folder: { name: "Folder" },
    template: { templateName: "Template" },
    state: { name: "Active" },
    creator: { name: "Creator" },
    caseTags: [{ tag: { name: "smoke" } }],
    caseIssues: [{ issue: { id: 7, name: "ISSUE-7", externalId: "EXT-7" } }],
    steps: [{ step: "step-text", expectedResult: "expected" }],
    parameters: overrides.parameters ?? [],
  };
}

function buildTx(testCase: ReturnType<typeof buildTestCaseFixture>) {
  const create = vi.fn<
    (args: { data: Record<string, unknown> }) => Promise<unknown>
  >(async ({ data }) => ({ id: 999, ...data }));
  const findUnique = vi.fn<
    (args: {
      where: { id: number };
      include: Record<string, unknown>;
    }) => Promise<unknown>
  >(async () => testCase);
  return {
    tx: {
      repositoryCases: { findUnique },
      repositoryCaseVersions: { create },
    },
    findUnique,
    create,
  };
}

describe("createTestCaseVersionInTransaction", () => {
  it("snapshots the parameters array on the version when parameters exist", async () => {
    const fixture = buildTestCaseFixture({
      parameters: [
        {
          id: 101,
          name: "username",
          description: "the user",
          type: "STRING",
          defaultValue: "alice",
          order: 0,
          required: true,
          sensitive: false,
          allowedValuesJson: null,
          lookupDataSetId: null,
        },
        {
          id: 102,
          name: "env",
          description: null,
          type: "SELECT",
          defaultValue: null,
          order: 1,
          required: false,
          sensitive: false,
          allowedValuesJson: ["dev", "prod"],
          lookupDataSetId: null,
        },
      ],
    });
    const { tx, create, findUnique } = buildTx(fixture);

    await createTestCaseVersionInTransaction(tx, 1, {});

    // The findUnique include must request parameters with the canonical filter/order/select.
    const includeArg = findUnique.mock.calls[0]![0]!.include;
    expect(includeArg.parameters).toEqual(
      expect.objectContaining({
        where: { isDeleted: false },
        orderBy: { order: "asc" },
      })
    );

    // The version data must include a parameters array of the right shape.
    const data = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.parameters).toEqual([
      {
        id: 101,
        name: "username",
        description: "the user",
        type: "STRING",
        defaultValue: "alice",
        order: 0,
        required: true,
        sensitive: false,
        allowedValuesJson: null,
        lookupDataSetId: null,
      },
      {
        id: 102,
        name: "env",
        description: null,
        type: "SELECT",
        defaultValue: null,
        order: 1,
        required: false,
        sensitive: false,
        allowedValuesJson: ["dev", "prod"],
        lookupDataSetId: null,
      },
    ]);
  });

  it("snapshots an empty parameters array when the case has none", async () => {
    const fixture = buildTestCaseFixture();
    const { tx, create } = buildTx(fixture);

    await createTestCaseVersionInTransaction(tx, 1, {});

    const data = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(Array.isArray(data.parameters)).toBe(true);
    expect(data.parameters).toEqual([]);
  });

  it("relies on the include where-clause to exclude soft-deleted parameters", async () => {
    // The tx.repositoryCases.findUnique include filters with isDeleted=false.
    // Asserting the include shape (above test) is sufficient — Prisma honors the where.
    const fixture = buildTestCaseFixture({
      parameters: [
        {
          id: 200,
          name: "active",
          description: null,
          type: "STRING",
          defaultValue: null,
          order: 0,
          required: false,
          sensitive: false,
          allowedValuesJson: null,
          lookupDataSetId: null,
        },
      ],
    });
    const { tx, findUnique, create } = buildTx(fixture);

    await createTestCaseVersionInTransaction(tx, 1, {});

    const include = findUnique.mock.calls[0]![0]!.include as {
      parameters: { where: { isDeleted: boolean } };
    };
    expect(include.parameters.where).toEqual({ isDeleted: false });
    const data = create.mock.calls[0]![0]!.data as {
      parameters: Array<{ name: string }>;
    };
    expect(data.parameters).toHaveLength(1);
    expect(data.parameters[0]!.name).toBe("active");
  });

  it("preserves all existing snapshot fields alongside the new parameters field", async () => {
    const fixture = buildTestCaseFixture();
    const { tx, create } = buildTx(fixture);

    await createTestCaseVersionInTransaction(tx, 1, {});

    const data = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    // Existing fields must remain present and unchanged.
    expect(data).toEqual(
      expect.objectContaining({
        repositoryCaseId: 1,
        staticProjectId: 10,
        staticProjectName: "Project",
        projectId: 10,
        repositoryId: 20,
        folderId: 30,
        folderName: "Folder",
        templateId: 40,
        templateName: "Template",
        name: "Test Case",
        stateId: 50,
        stateName: "Active",
        automated: false,
        isArchived: false,
        version: 2,
        steps: [{ step: "step-text", expectedResult: "expected" }],
        tags: ["smoke"],
        issues: [{ id: 7, name: "ISSUE-7", externalId: "EXT-7" }],
        attachments: [],
        links: [],
      })
    );
    // And the new field is also there.
    expect(data).toHaveProperty("parameters");
  });
});
