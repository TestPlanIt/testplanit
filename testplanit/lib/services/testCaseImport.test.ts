import { describe, expect, it } from "vitest";
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
