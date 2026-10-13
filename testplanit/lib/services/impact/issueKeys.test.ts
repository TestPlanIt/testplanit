import { describe, expect, it, vi } from "vitest";
import {
  extractIssueTokens,
  importableIssueKeys,
  MAX_TOKENS_PER_MESSAGE,
  resolveLinkedIssues,
  tokenMatchesKey,
  type IssueLookupDb,
} from "./issueKeys";

describe("extractIssueTokens", () => {
  it("finds a Jira-style key and stores it upper-case", () => {
    expect(extractIssueTokens("fix login (proj-123)")).toEqual([
      { raw: "proj-123", exact: ["PROJ-123"] },
    ]);
  });

  it("finds a bare #number with its number-keyed spellings", () => {
    expect(extractIssueTokens("Fixes #42")).toEqual([
      { raw: "#42", exact: ["#42", "42"], number: "42" },
    ]);
  });

  it("treats AB#12 as Azure DevOps work item 12", () => {
    expect(extractIssueTokens("AB#12 tweak")).toEqual([
      { raw: "AB#12", exact: ["#12", "12"], number: "12" },
    ]);
  });

  it("keeps the scope of owner/repo#7 and group/project#7 references", () => {
    expect(extractIssueTokens("see acme/app#7 and grp/sub/proj#8")).toEqual([
      { raw: "acme/app#7", exact: ["acme/app#7", "#7", "7"], number: "7" },
      {
        raw: "grp/sub/proj#8",
        exact: ["grp/sub/proj#8", "#8", "8"],
        number: "8",
      },
    ]);
  });

  it("does not double-count a scoped reference as a bare one", () => {
    const tokens = extractIssueTokens("acme/app#7");
    expect(tokens).toHaveLength(1);
  });

  it("reads issue numbers out of pasted tracker URLs", () => {
    expect(
      extractIssueTokens(
        "https://github.com/acme/app/issues/99 and https://dev.azure.com/o/p/_workitems/edit/100"
      ).map((t) => t.number)
    ).toEqual(["99", "100"]);
  });

  it("returns each token once and ignores plain numbers and words", () => {
    expect(
      extractIssueTokens("PROJ-1 PROJ-1 #5 #5 version 2 release-notes")
    ).toHaveLength(2);
    expect(extractIssueTokens("bump to 1.2.3")).toEqual([]);
    expect(extractIssueTokens("")).toEqual([]);
  });

  it("caps the tokens taken from one message", () => {
    const message = Array.from({ length: 40 }, (_, i) => `#${i + 1}`).join(" ");
    expect(extractIssueTokens(message)).toHaveLength(MAX_TOKENS_PER_MESSAGE);
  });
});

describe("tokenMatchesKey", () => {
  const hash = { raw: "#12", exact: ["#12", "12"], number: "12" };

  it("matches an exact key", () => {
    expect(tokenMatchesKey({ raw: "x", exact: ["PROJ-1"] }, "PROJ-1")).toBe(
      true
    );
    expect(tokenMatchesKey({ raw: "x", exact: ["PROJ-1"] }, "PROJ-10")).toBe(
      false
    );
  });

  it("matches number-keyed trackers by bare number and trailing #number", () => {
    expect(tokenMatchesKey(hash, "#12")).toBe(true);
    expect(tokenMatchesKey(hash, "12")).toBe(true);
    expect(tokenMatchesKey(hash, "group/project#12")).toBe(true);
    expect(tokenMatchesKey(hash, "group/project#112")).toBe(false);
    expect(tokenMatchesKey(hash, null)).toBe(false);
  });
});

describe("resolveLinkedIssues", () => {
  type ResultRow = Awaited<
    ReturnType<IssueLookupDb["testRunResults"]["findMany"]>
  >[number];
  type StepResultRow = Awaited<
    ReturnType<IssueLookupDb["testRunStepResults"]["findMany"]>
  >[number];

  function makeDb(
    issues: Array<{ id: number; externalKey: string | null }>,
    links: Array<{ caseId: number; issueId: number }>,
    viaResults: { results?: ResultRow[]; stepResults?: StepResultRow[] } = {}
  ) {
    return {
      issue: { findMany: vi.fn().mockResolvedValue(issues) },
      repositoryCaseIssue: { findMany: vi.fn().mockResolvedValue(links) },
      testRunResults: {
        findMany: vi.fn().mockResolvedValue(viaResults.results ?? []),
      },
      testRunStepResults: {
        findMany: vi.fn().mockResolvedValue(viaResults.stepResults ?? []),
      },
    } satisfies IssueLookupDb;
  }

  function resultRow(caseId: number, ...issueIds: number[]): ResultRow {
    return {
      testRunCase: { repositoryCaseId: caseId },
      issues: issueIds.map((id) => ({ id })),
    };
  }

  function stepResultRow(caseId: number, ...issueIds: number[]): StepResultRow {
    return {
      testRunResult: { testRunCase: { repositoryCaseId: caseId } },
      issues: issueIds.map((id) => ({ id })),
    };
  }

  it("queries by exact keys and trailing #number, then maps issues to linked cases", async () => {
    const db = makeDb(
      [
        { id: 1, externalKey: "PROJ-7" },
        { id: 2, externalKey: "acme/app#12" },
      ],
      [
        { caseId: 100, issueId: 1 },
        { caseId: 101, issueId: 1 },
        { caseId: 200, issueId: 2 },
      ]
    );
    const tokens = extractIssueTokens("PROJ-7 fixes #12");

    const resolved = await resolveLinkedIssues(db, {
      projectId: 5,
      tokens,
      caseFilter: { isArchived: false },
    });

    const where = db.issue.findMany.mock.calls[0][0].where;
    expect(where.caseIssues.some.case.projectId).toBe(5);
    expect(where.OR).toEqual([
      { externalKey: { in: ["PROJ-7", "#12", "12"] } },
      { externalKey: { endsWith: "#12" } },
    ]);
    expect(db.repositoryCaseIssue.findMany.mock.calls[0][0].where).toEqual({
      issueId: { in: [1, 2] },
      case: { projectId: 5, isDeleted: false, isArchived: false },
    });
    expect([...resolved.issues.values()]).toEqual([
      { id: 1, key: "PROJ-7", caseIds: [100, 101] },
      { id: 2, key: "acme/app#12", caseIds: [200] },
    ]);
    expect(resolved.forToken(tokens[0]).map((i) => i.id)).toEqual([1]);
    expect(resolved.forToken(tokens[1]).map((i) => i.id)).toEqual([2]);
  });

  it("drops issues that have no linked case after the case filter", async () => {
    const db = makeDb([{ id: 1, externalKey: "PROJ-7" }], []);
    const resolved = await resolveLinkedIssues(db, {
      projectId: 5,
      tokens: extractIssueTokens("PROJ-7"),
    });
    expect(resolved.issues.size).toBe(0);
  });

  it("does not hit the database without tokens", async () => {
    const db = makeDb([], []);
    const resolved = await resolveLinkedIssues(db, {
      projectId: 5,
      tokens: [],
    });
    expect(resolved.issues.size).toBe(0);
    expect(db.issue.findMany).not.toHaveBeenCalled();
  });

  describe("with result links", () => {
    const tokens = extractIssueTokens("PROJ-7");
    const caseInProject = { projectId: 5, isDeleted: false };
    const liveCase = { ...caseInProject, isArchived: false };

    it("leaves result links out unless asked, and never reads the result tables", async () => {
      const db = makeDb([{ id: 1, externalKey: "PROJ-7" }], [], {
        results: [resultRow(300, 1)],
        stepResults: [stepResultRow(301, 1)],
      });
      const resolved = await resolveLinkedIssues(db, { projectId: 5, tokens });
      expect(resolved.issues.size).toBe(0);
      expect(db.testRunResults.findMany).not.toHaveBeenCalled();
      expect(db.testRunStepResults.findMany).not.toHaveBeenCalled();
      const where = db.issue.findMany.mock.calls[0][0].where;
      expect(where.caseIssues.some.case).toEqual(caseInProject);
      expect(where.AND).toBeUndefined();
    });

    it("finds issues linked only through a result, and resolves them to the result's case", async () => {
      const db = makeDb([{ id: 1, externalKey: "PROJ-7" }], [], {
        results: [resultRow(300, 1)],
      });
      const resolved = await resolveLinkedIssues(db, {
        projectId: 5,
        tokens,
        caseFilter: { isArchived: false },
        includeResultLinks: true,
      });

      const where = db.issue.findMany.mock.calls[0][0].where;
      expect(where.caseIssues).toBeUndefined();
      expect(where.AND).toEqual([
        {
          OR: [
            { caseIssues: { some: { case: caseInProject } } },
            {
              testRunResults: {
                some: {
                  isDeleted: false,
                  testRunCase: {
                    isDeleted: false,
                    repositoryCase: caseInProject,
                  },
                },
              },
            },
            {
              testRunStepResults: {
                some: {
                  isDeleted: false,
                  testRunResult: {
                    isDeleted: false,
                    testRunCase: {
                      isDeleted: false,
                      repositoryCase: caseInProject,
                    },
                  },
                },
              },
            },
          ],
        },
      ]);
      expect(where.OR).toEqual([{ externalKey: { in: ["PROJ-7"] } }]);
      expect([...resolved.issues.values()]).toEqual([
        { id: 1, key: "PROJ-7", caseIds: [300] },
      ]);
    });

    it("skips deleted results and run cases, and applies the case filter to the result's case", async () => {
      const db = makeDb(
        [
          { id: 1, externalKey: "PROJ-7" },
          { id: 2, externalKey: "PROJ-8" },
        ],
        [],
        { results: [resultRow(300, 1)] }
      );
      await resolveLinkedIssues(db, {
        projectId: 5,
        tokens,
        caseFilter: { isArchived: false },
        includeResultLinks: true,
      });

      expect(db.testRunResults.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          issues: { some: { id: { in: [1, 2] } } },
          testRunCase: { isDeleted: false, repositoryCase: liveCase },
        },
        select: {
          testRunCase: { select: { repositoryCaseId: true } },
          issues: { where: { id: { in: [1, 2] } }, select: { id: true } },
        },
      });
      expect(db.testRunStepResults.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          issues: { some: { id: { in: [1, 2] } } },
          testRunResult: {
            isDeleted: false,
            testRunCase: { isDeleted: false, repositoryCase: liveCase },
          },
        },
        select: {
          testRunResult: {
            select: { testRunCase: { select: { repositoryCaseId: true } } },
          },
          issues: { where: { id: { in: [1, 2] } }, select: { id: true } },
        },
      });
    });

    it("resolves a step-result link to the result's case", async () => {
      const db = makeDb([{ id: 1, externalKey: "PROJ-7" }], [], {
        stepResults: [stepResultRow(301, 1)],
      });
      const resolved = await resolveLinkedIssues(db, {
        projectId: 5,
        tokens,
        includeResultLinks: true,
      });
      expect(resolved.issues.get(1)?.caseIds).toEqual([301]);
    });

    it("lists a case once however many ways it is linked, and keeps links per issue", async () => {
      const db = makeDb(
        [
          { id: 1, externalKey: "PROJ-7" },
          { id: 2, externalKey: "PROJ-8" },
        ],
        [{ caseId: 100, issueId: 1 }],
        {
          results: [resultRow(100, 1), resultRow(100, 1, 2), resultRow(50, 2)],
          stepResults: [stepResultRow(100, 1), stepResultRow(70, 2)],
        }
      );
      const resolved = await resolveLinkedIssues(db, {
        projectId: 5,
        tokens: extractIssueTokens("PROJ-7 PROJ-8"),
        includeResultLinks: true,
      });
      expect([...resolved.issues.values()]).toEqual([
        { id: 1, key: "PROJ-7", caseIds: [100] },
        { id: 2, key: "PROJ-8", caseIds: [50, 70, 100] },
      ]);
    });

    it("still drops an issue whose only results fail the filters", async () => {
      const db = makeDb([{ id: 1, externalKey: "PROJ-7" }], []);
      const resolved = await resolveLinkedIssues(db, {
        projectId: 5,
        tokens,
        includeResultLinks: true,
      });
      expect(resolved.issues.size).toBe(0);
    });
  });
});

describe("importableIssueKeys", () => {
  const tokens = extractIssueTokens(
    "PROJ-12 fixes #7 and acme/app#9, see AB#4"
  );

  it("asks Jira only for project-style keys", () => {
    expect(importableIssueKeys("JIRA", tokens)).toEqual(["PROJ-12"]);
  });

  it("asks number-keyed trackers for #n and drops project keys", () => {
    // Scoped tokens are extracted before bare ones.
    expect(importableIssueKeys("GITHUB", tokens)).toEqual(["#9", "#7", "#4"]);
    expect(importableIssueKeys("REDMINE", tokens)).toEqual(["#9", "#7", "#4"]);
  });

  it("asks GitLab and Gitea only for scoped keys", () => {
    expect(importableIssueKeys("GITLAB", tokens)).toEqual(["acme/app#9"]);
    expect(importableIssueKeys("GITEA", tokens)).toEqual(["acme/app#9"]);
  });

  it("asks Azure DevOps for bare numbers", () => {
    expect(importableIssueKeys("AZURE_DEVOPS", tokens)).toEqual([
      "9",
      "7",
      "4",
    ]);
  });

  it("asks an unknown provider for nothing", () => {
    expect(importableIssueKeys("YOUTRACK", tokens)).toEqual([]);
    expect(importableIssueKeys(null, tokens)).toEqual([]);
  });
});
