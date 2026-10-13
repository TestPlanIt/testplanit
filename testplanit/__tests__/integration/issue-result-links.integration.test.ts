// Live-DB proof that a ticket added to a test result (or a step result)
// resolves to that result's repository case when result links are on, and
// that the filters hold: deleted results, deleted run cases, archived or
// deleted cases and cases of another project are left out, while a case
// linked both directly and through a result is listed once. The mocked unit
// tests only check the query shapes; this suite runs those shapes through
// the real ZenStack client, including the nested many-to-many select.
//
// Run via (scratch DB only — never the .env DATABASE_URL, which is `ew`):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/issue-result-links.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  extractIssueTokens,
  resolveLinkedIssues,
  type IssueLookupDb,
} from "~/lib/services/impact/issueKeys";
import {
  syncIssuePins,
  type IssueScanDb,
} from "~/lib/services/impact/issueScan";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `irl-${Date.now().toString(36)}`;
// A Jira-style key the token extractor recognises; the digits keep it
// unique across runs against the same scratch database.
const KEY_NUMBER = String(Date.now() % 10_000_000);
const LINKED_KEY = `RLT-${KEY_NUMBER}`;
const DELETED_ONLY_KEY = `RLD-${KEY_NUMBER}`;
const SHA = "f".repeat(40);

describeIntegration("issue links through test results (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let otherProjectId: number;
  let integrationId: number;
  let codeRepositoryId: number;
  let configId: number;
  let linkedIssueId: number;
  let deletedOnlyIssueId: number;
  const repositoryIds: number[] = [];
  const folderIds: number[] = [];
  const caseIds: number[] = [];
  const runIds: number[] = [];

  let caseDirect: number;
  let caseViaResult: number;
  let caseViaStepResult: number;
  let caseBoth: number;
  let caseDeletedResult: number;
  let caseDeletedRunCase: number;
  let caseDeletedStepResult: number;
  let caseArchived: number;
  let caseDeleted: number;
  let caseOtherProject: number;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_test" && !dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite hard-deletes fixtures and only runs against a tpi_* scratch DB (or tpi_test in CI)`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");
    const template = await db.templates.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    if (!template) throw new Error("Test prerequisite: no Templates row");
    const caseState = await db.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!caseState)
      throw new Error("Test prerequisite: no CASES-scoped Workflows row");
    const runState = await db.workflows.findFirst({
      where: { scope: "RUNS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!runState)
      throw new Error("Test prerequisite: no RUNS-scoped Workflows row");
    const status = await db.status.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    if (!status) throw new Error("Test prerequisite: no Status row");
    const templateId = template.id;
    const caseStateId = caseState.id;
    const statusId = status.id;

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Result Links Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const integration = await db.integration.create({
      data: {
        name: `${STAMP}-jira`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    async function createProject(label: string) {
      const project = await db.projects.create({
        data: { name: `${STAMP}-${label}`, createdBy: adminUserId },
        select: { id: true },
      });
      const repository = await db.repositories.create({
        data: { projectId: project.id },
        select: { id: true },
      });
      repositoryIds.push(repository.id);
      const folder = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-${label}-folder`,
          repositoryId: repository.id,
          projectId: project.id,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderIds.push(folder.id);
      const run = await db.testRuns.create({
        data: {
          projectId: project.id,
          name: `${STAMP}-${label}-run`,
          stateId: runState!.id,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      runIds.push(run.id);
      return {
        projectId: project.id,
        repositoryId: repository.id,
        folderId: folder.id,
        runId: run.id,
      };
    }

    const main = await createProject("main");
    const other = await createProject("other");
    projectId = main.projectId;
    otherProjectId = other.projectId;

    const codeRepository = await db.codeRepository.create({
      data: {
        name: `${STAMP}-code-repo`,
        provider: "GITHUB",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    codeRepositoryId = codeRepository.id;
    const config = await db.projectCodeRepositoryConfig.create({
      data: {
        projectId,
        purpose: "IMPACT",
        repositoryId: codeRepositoryId,
        pathPatterns: [],
      },
      select: { id: true },
    });
    configId = config.id;

    async function createIssue(name: string, externalKey: string) {
      const issue = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          integrationId,
          externalId: `${STAMP}-${name}`,
          externalKey,
        },
        select: { id: true },
      });
      return issue.id;
    }
    linkedIssueId = await createIssue("linked", LINKED_KEY);
    deletedOnlyIssueId = await createIssue("deleted-only", DELETED_ONLY_KEY);

    async function createCase(
      scope: typeof main,
      name: string,
      extra: { isArchived?: boolean; isDeleted?: boolean } = {}
    ) {
      const testCase = await db.repositoryCases.create({
        data: {
          projectId: scope.projectId,
          repositoryId: scope.repositoryId,
          folderId: scope.folderId,
          templateId,
          name: `${STAMP}-${name}`,
          stateId: caseStateId,
          creatorId: adminUserId,
          ...extra,
        },
        select: { id: true },
      });
      caseIds.push(testCase.id);
      return testCase.id;
    }

    // One run case per (run, case), as the schema requires.
    const runCases = new Map<string, number>();
    async function runCaseFor(
      scope: typeof main,
      caseId: number,
      deleted = false
    ) {
      const key = `${scope.runId}:${caseId}`;
      let id = runCases.get(key);
      if (id === undefined) {
        const runCase = await db.testRunCases.create({
          data: {
            testRunId: scope.runId,
            repositoryCaseId: caseId,
            isDeleted: deleted,
          },
          select: { id: true },
        });
        id = runCase.id;
        runCases.set(key, id);
      }
      return id;
    }

    /** A result for the case, with the issue added to it. */
    async function recordResult(
      scope: typeof main,
      caseId: number,
      issueId: number,
      opts: { deletedRunCase?: boolean; deletedResult?: boolean } = {}
    ) {
      const runCaseId = await runCaseFor(
        scope,
        caseId,
        opts.deletedRunCase === true
      );
      const result = await db.testRunResults.create({
        data: {
          testRunId: scope.runId,
          testRunCaseId: runCaseId,
          statusId,
          executedById: adminUserId,
          isDeleted: opts.deletedResult === true,
          issues: { connect: { id: issueId } },
        },
        select: { id: true },
      });
      return result.id;
    }

    /** A result with no issue, whose step result carries the issue. */
    async function recordStepResult(
      scope: typeof main,
      caseId: number,
      issueId: number,
      opts: { deletedStepResult?: boolean } = {}
    ) {
      const runCaseId = await runCaseFor(scope, caseId);
      const result = await db.testRunResults.create({
        data: {
          testRunId: scope.runId,
          testRunCaseId: runCaseId,
          statusId,
          executedById: adminUserId,
        },
        select: { id: true },
      });
      const step = await db.steps.create({
        data: { testCaseId: caseId, order: 0 },
        select: { id: true },
      });
      await db.testRunStepResults.create({
        data: {
          testRunResultId: result.id,
          stepId: step.id,
          statusId,
          isDeleted: opts.deletedStepResult === true,
          issues: { connect: { id: issueId } },
        },
      });
    }

    caseDirect = await createCase(main, "direct");
    caseViaResult = await createCase(main, "via-result");
    caseViaStepResult = await createCase(main, "via-step-result");
    caseBoth = await createCase(main, "both");
    caseDeletedResult = await createCase(main, "deleted-result");
    caseDeletedRunCase = await createCase(main, "deleted-run-case");
    caseDeletedStepResult = await createCase(main, "deleted-step-result");
    caseArchived = await createCase(main, "archived", { isArchived: true });
    caseDeleted = await createCase(main, "deleted", { isDeleted: true });
    caseOtherProject = await createCase(other, "other-project");

    await db.repositoryCaseIssue.createMany({
      data: [
        { caseId: caseDirect, issueId: linkedIssueId },
        { caseId: caseBoth, issueId: linkedIssueId },
      ],
    });
    await recordResult(main, caseViaResult, linkedIssueId);
    await recordStepResult(main, caseViaStepResult, linkedIssueId);
    await recordResult(main, caseBoth, linkedIssueId);
    await recordResult(main, caseDeletedResult, linkedIssueId, {
      deletedResult: true,
    });
    await recordResult(main, caseDeletedRunCase, linkedIssueId, {
      deletedRunCase: true,
    });
    await recordStepResult(main, caseDeletedStepResult, linkedIssueId, {
      deletedStepResult: true,
    });
    await recordResult(main, caseArchived, linkedIssueId);
    await recordResult(main, caseDeleted, linkedIssueId);
    await recordResult(other, caseOtherProject, linkedIssueId);
    // This ticket is only ever reached through a deleted result.
    await recordResult(main, caseViaResult, deletedOnlyIssueId, {
      deletedResult: true,
    });
  });

  afterAll(async () => {
    await db.repositoryCaseCodePin.deleteMany({ where: { configId } });
    await db.projectCodeRepositoryConfig.delete({ where: { id: configId } });
    await db.codeRepository.delete({ where: { id: codeRepositoryId } });
    await db.testRunStepResults.deleteMany({
      where: { testRunResult: { testRunId: { in: runIds } } },
    });
    await db.testRunResults.deleteMany({
      where: { testRunId: { in: runIds } },
    });
    await db.testRunCases.deleteMany({ where: { testRunId: { in: runIds } } });
    await db.testRuns.deleteMany({ where: { id: { in: runIds } } });
    await db.steps.deleteMany({ where: { testCaseId: { in: caseIds } } });
    await db.repositoryCaseIssue.deleteMany({
      where: { caseId: { in: caseIds } },
    });
    await db.repositoryCases.deleteMany({ where: { id: { in: caseIds } } });
    await db.issue.deleteMany({
      where: { id: { in: [linkedIssueId, deletedOnlyIssueId] } },
    });
    await db.repositoryFolders.deleteMany({ where: { id: { in: folderIds } } });
    await db.repositories.deleteMany({ where: { id: { in: repositoryIds } } });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.deleteMany({
      where: { id: { in: [projectId, otherProjectId] } },
    });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  const lookupDb = () => db as unknown as IssueLookupDb;
  const tokens = () => extractIssueTokens(`${LINKED_KEY} ${DELETED_ONLY_KEY}`);

  it("counts only direct case links when result links are off", async () => {
    const resolved = await resolveLinkedIssues(lookupDb(), {
      projectId,
      tokens: tokens(),
      caseFilter: { isArchived: false },
    });
    expect([...resolved.issues.keys()]).toEqual([linkedIssueId]);
    expect(resolved.issues.get(linkedIssueId)?.caseIds).toEqual(
      [caseDirect, caseBoth].sort((a, b) => a - b)
    );
  });

  it("adds the cases of live results and step results in the project when result links are on", async () => {
    const resolved = await resolveLinkedIssues(lookupDb(), {
      projectId,
      tokens: tokens(),
      caseFilter: { isArchived: false },
      includeResultLinks: true,
    });
    // The deleted-only ticket is found by key but has no live link.
    expect([...resolved.issues.keys()]).toEqual([linkedIssueId]);
    expect(resolved.issues.get(linkedIssueId)?.caseIds).toEqual(
      [caseDirect, caseViaResult, caseViaStepResult, caseBoth].sort(
        (a, b) => a - b
      )
    );
    expect(resolved.issues.get(linkedIssueId)?.key).toBe(LINKED_KEY);
  });

  it("sees the other project's result only from that project", async () => {
    const resolved = await resolveLinkedIssues(lookupDb(), {
      projectId: otherProjectId,
      tokens: tokens(),
      includeResultLinks: true,
    });
    expect(resolved.issues.get(linkedIssueId)?.caseIds).toEqual([
      caseOtherProject,
    ]);
  });

  it("pins the result's case when a commit names the ticket", async () => {
    const report = await syncIssuePins(
      db as unknown as IssueScanDb,
      { id: configId, projectId },
      {
        commits: [
          {
            sha: SHA,
            shortSha: SHA.slice(0, 7),
            message: `${LINKED_KEY} handle the regression`,
            authorName: "dev",
            authoredAt: "2026-09-01T00:00:00Z",
            parents: ["0".repeat(40)],
          },
        ],
        truncated: false,
        getCommitFiles: async () => ({ paths: ["src/app.ts"], capped: false }),
        maxCommitFetches: 10,
        maxFilesPerCommit: 50,
        actorId: adminUserId,
        includeResultLinks: true,
      }
    );
    expect(report).toMatchObject({ matchedCommits: 1, issues: 1, created: 4 });

    const pins = await db.repositoryCaseCodePin.findMany({
      where: { configId, isDeleted: false },
      select: { caseId: true, filePath: true, source: true, note: true },
      orderBy: { caseId: "asc" },
    });
    expect(pins).toEqual(
      [caseDirect, caseViaResult, caseViaStepResult, caseBoth]
        .sort((a, b) => a - b)
        .map((caseId) => ({
          caseId,
          filePath: "src/app.ts",
          source: "ISSUE",
          note: LINKED_KEY,
        }))
    );
  });
});
