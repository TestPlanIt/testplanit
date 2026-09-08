import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("./customFields.js", () => ({
  resolveCustomFields: vi.fn(),
}));

import * as customFieldsModule from "./customFields.js";
import { buildCasesWhere, type CasesFilterInput } from "./where.js";

const resolveCustomFieldsMock = vi.mocked(customFieldsModule.resolveCustomFields);

const env = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function input(overrides: Partial<CasesFilterInput> = {}): CasesFilterInput {
  return { projectId: 7, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCasesWhere", () => {
  it("base where: projectId scope + live rows only", async () => {
    expect(await buildCasesWhere(input(), env)).toEqual({
      projectId: 7,
      isDeleted: false,
    });
  });

  it("folderId: exact-match goes into the where; with includeDescendants the builder leaves it OUT for the caller's subtree scope", async () => {
    const exact = await buildCasesWhere(input({ folderId: 12 }), env);
    expect(exact.folderId).toBe(12);

    const subtree = await buildCasesWhere(
      input({ folderId: 12, includeDescendants: true }),
      env,
    );
    expect(subtree.folderId).toBeUndefined();
  });

  it("hasAutomatedResults: true → AND some, false → AND none", async () => {
    const has = await buildCasesWhere(
      input({ hasAutomatedResults: true }),
      env,
    );
    expect(has.AND).toEqual([{ junitResults: { some: {} } }]);

    const hasNot = await buildCasesWhere(
      input({ hasAutomatedResults: false }),
      env,
    );
    expect(hasNot.AND).toEqual([{ junitResults: { none: {} } }]);
  });

  it("automatedResultSince / noAutomatedResultSince: gte-bounded some / none on junitResults.executedAt", async () => {
    const since = await buildCasesWhere(
      input({ automatedResultSince: "2026-07-15T00:00:00.000Z" }),
      env,
    );
    expect(since.AND).toEqual([
      {
        junitResults: {
          some: { executedAt: { gte: new Date("2026-07-15T00:00:00.000Z") } },
        },
      },
    ]);

    const rot = await buildCasesWhere(
      input({
        automated: true,
        noAutomatedResultSince: "2026-07-15T00:00:00.000Z",
      }),
      env,
    );
    // §4.6 acceptance: "flagged automated with no automated result since X"
    // is a single expressible where.
    expect(rot.automated).toBe(true);
    expect(rot.AND).toEqual([
      {
        junitResults: {
          none: { executedAt: { gte: new Date("2026-07-15T00:00:00.000Z") } },
        },
      },
    ]);
  });

  it("junit filters COMPOSE as AND terms — hasNeverExecuted's direct junitResults key survives alongside them", async () => {
    const where = await buildCasesWhere(
      input({
        hasNeverExecuted: true,
        hasAutomatedResults: false,
        noAutomatedResultSince: "2026-07-15T00:00:00.000Z",
      }),
      env,
    );
    expect(where.junitResults).toEqual({ none: {} });
    expect(where.testRuns).toEqual({ none: { results: { some: {} } } });
    expect(where.AND).toEqual([
      { junitResults: { none: {} } },
      {
        junitResults: {
          none: { executedAt: { gte: new Date("2026-07-15T00:00:00.000Z") } },
        },
      },
    ]);
  });

  it("no junit filters → no AND key at all", async () => {
    const where = await buildCasesWhere(input({ automated: true }), env);
    expect(where.AND).toBeUndefined();
  });

  it("customField {name, value} resolves through resolveCustomFields (unchanged behavior after the extraction)", async () => {
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 55, value: 3, name: "Priority" },
    ]);

    const where = await buildCasesWhere(
      input({ customField: { name: "Priority", value: "High" } }),
      env,
    );

    expect(resolveCustomFieldsMock).toHaveBeenCalledWith(
      { Priority: "High" },
      undefined,
      env,
    );
    expect(where.caseFieldValues).toEqual({
      some: { fieldId: 55, value: { equals: 3 } },
    });
  });
});
