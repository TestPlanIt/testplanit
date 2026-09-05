import { describe, expect, it, vi } from "vitest";

const auditedTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: auditedTransactionMock,
}));

vi.mock("~/lib/services/reviewGate", () => ({
  resolveCreateStateRemap: vi.fn(async () => null),
}));

import {
  ImportInputSchema,
  persistGeneratedTestCases,
} from "~/lib/services/testCaseImport";

/**
 * Server actions and JSON bodies do NOT deliver `undefined` values: React's
 * flight deserializer and JSON.stringify both DELETE undefined-valued keys,
 * so an unset form field arrives as a MISSING key. zod 4.4+ rejects missing
 * keys on bare `z.any()` properties ("expected nonoptional"), which is why
 * every `z.any()`/`z.unknown()` property in this schema must be `.optional()`.
 * A JSON round-trip reproduces the wire shape exactly.
 */
function wire<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}

function buildInput() {
  return {
    projectId: 1,
    projectName: "Project",
    repositoryId: 1,
    folderId: 1,
    folderName: "Folder",
    templateId: 1,
    templateName: "Template",
    stateId: 1,
    stateName: "Draft",
    maxOrder: 0,
    autoGenerateTags: false,
    source: "MANUAL" as const,
    testCases: [
      {
        id: "case-1",
        name: "Case with unset optional fields",
        fieldValues: {},
        // An unset dropdown (no default option) reaches the client payload as
        // undefined — both here and in versionFieldValues.
        fieldValuesById: { "2": undefined, "4": "filled" },
        versionFieldValues: [
          { field: "Priority", value: undefined },
          { field: "Description", value: "filled" },
        ],
        estimate: undefined,
        automated: false,
        tagIds: [],
        issueIds: [],
        versionTags: [],
        versionIssues: [],
        attachments: [],
        steps: [{ step: undefined, expectedResult: undefined }],
        parameters: undefined,
        datasetRows: undefined,
      },
    ],
    fieldMappings: [],
  };
}

describe("ImportInputSchema", () => {
  it("accepts a payload whose unset fields were dropped by wire serialization", () => {
    const sent = wire(buildInput());

    // Sanity: the round-trip must actually delete the undefined-valued keys,
    // otherwise this test no longer covers the wire shape.
    expect("value" in sent.testCases[0].versionFieldValues[0]).toBe(false);
    expect("2" in sent.testCases[0].fieldValuesById).toBe(false);
    expect("step" in sent.testCases[0].steps[0]).toBe(false);
    expect("estimate" in sent.testCases[0]).toBe(false);

    const result = ImportInputSchema.safeParse(sent);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("accepts the same payload with undefined values still present (in-memory callers)", () => {
    const result = ImportInputSchema.safeParse(buildInput());
    expect(result.success).toBe(true);
  });
});

describe("persistGeneratedTestCases input validation", () => {
  it("reports pathed field errors instead of only the generic message", async () => {
    const bad = wire(buildInput()) as any;
    bad.folderId = "not-a-number";

    const result = await persistGeneratedTestCases(bad, {
      userId: "u1",
      userName: "User",
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("Invalid input data");
    expect(result.errors[0]).toMatch(/^folderId: /);
  });
});

/**
 * Version 1 of an imported case has to equal the case as imported — the
 * version page and every "as executed" view read the snapshot, not the case.
 * Three ways it used to disagree (#600):
 *   - steps passed as a serialized Tiptap document were wrapped as literal
 *     text in the snapshot while the Steps rows got the parsed document;
 *   - tags resolved to ids by the caller (what bulk-create does) never
 *     reached the snapshot, which recorded `[]`;
 *   - the same for issues linked by id.
 */
describe("persistGeneratedTestCases version 1 snapshot", () => {
  const RICH_STEP = JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Click" }] },
    ],
  });
  const RICH_RESULT = JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Opens" }] },
    ],
  });

  function stubTx(captured: {
    version?: any;
    steps?: any;
    fieldVersionValues?: any;
  }) {
    return {
      issue: { findFirst: vi.fn(async () => null) },
      tags: { upsert: vi.fn() },
      repositoryFolders: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      workflows: { findUnique: vi.fn(async () => null) },
      repositoryCases: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 500 })),
        update: vi.fn(async () => ({ id: 500 })),
      },
      repositoryCaseIssue: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [
          { issue: { id: 77, name: "BUG-1", externalId: "EXT-77" } },
        ]),
      },
      repositoryCaseTag: {
        createMany: vi.fn(async () => ({ count: 2 })),
        findMany: vi.fn(async () => [
          { tag: { name: "smoke" } },
          { tag: { name: "auth" } },
        ]),
      },
      attachments: { create: vi.fn() },
      repositoryCaseVersions: {
        create: vi.fn(async ({ data }: any) => {
          captured.version = data;
          return { id: 900 };
        }),
      },
      caseFieldValues: { createMany: vi.fn() },
      caseFieldVersionValues: {
        createMany: vi.fn(async ({ data }: any) => {
          captured.fieldVersionValues = data;
        }),
      },
      steps: {
        createMany: vi.fn(async ({ data }: any) => {
          captured.steps = data;
        }),
      },
      testCaseParameter: { createMany: vi.fn() },
      dataSet: { create: vi.fn() },
      dataSetVersion: { create: vi.fn() },
      dataSetRow: { createMany: vi.fn() },
    };
  }

  async function importOneCase() {
    const captured: {
      version?: any;
      steps?: any;
      fieldVersionValues?: any;
    } = {};
    auditedTransactionMock.mockImplementationOnce(async (fn: any) =>
      fn(stubTx(captured))
    );

    const result = await persistGeneratedTestCases(
      {
        projectId: 1,
        projectName: "Project",
        repositoryId: 1,
        folderId: 1,
        folderName: "Folder",
        templateId: 1,
        templateName: "Template",
        stateId: 1,
        stateName: "Draft",
        maxOrder: 0,
        // bulk-create's exact shape: tags/issues already resolved to ids, so
        // nothing hands the importer a name list to snapshot.
        autoGenerateTags: false,
        source: "MANUAL",
        testCases: [
          {
            id: "case-1",
            name: "Imported case",
            fieldValues: {},
            tagIds: [10, 11],
            issueIds: [77],
            steps: [{ step: RICH_STEP, expectedResult: RICH_RESULT }],
          },
        ],
        fieldMappings: [],
      } as any,
      { userId: "u1", userName: "User" }
    );

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    return captured;
  }

  it("snapshots steps exactly as the Steps rows store them", async () => {
    const captured = await importOneCase();

    const parsedDoc = JSON.parse(RICH_STEP);
    const parsedResult = JSON.parse(RICH_RESULT);

    expect(captured.steps[0].step).toEqual(parsedDoc);
    expect(captured.version.steps).toEqual([
      { step: parsedDoc, expectedResult: parsedResult },
    ]);
  });

  it("snapshots the tags and issues actually linked to the case", async () => {
    const captured = await importOneCase();

    expect(captured.version.tags).toEqual(["smoke", "auth"]);
    expect(captured.version.issues).toEqual([
      { id: 77, name: "BUG-1", externalId: "EXT-77" },
    ]);
  });
});
