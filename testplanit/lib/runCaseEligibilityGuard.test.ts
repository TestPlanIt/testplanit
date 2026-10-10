import { ORMError } from "@zenstackhq/orm";
import { describe, expect, it, vi } from "vitest";
import {
  applyRunCaseEligibility,
  type EligibilityClient,
} from "./runCaseEligibilityGuard";

// Project 1 excludes Not Started cases; project 2 does not.
// Cases 10, 11 are ready; case 12 is Not Started. Run 7 is in project 1, run 8 in project 2.
const PROJECTS: Record<number, { excludeNotStartedFromRuns: boolean }> = {
  1: { excludeNotStartedFromRuns: true },
  2: { excludeNotStartedFromRuns: false },
};
const CASES = [
  { id: 10, projectId: 1, notStarted: false },
  { id: 11, projectId: 1, notStarted: false },
  { id: 12, projectId: 1, notStarted: true },
];
const RUNS: Record<number, { projectId: number }> = {
  7: { projectId: 1 },
  8: { projectId: 2 },
};
const RUN_CASES = [
  { id: 1, testRunId: 7, repositoryCaseId: 10, isDeleted: true },
  { id: 2, testRunId: 7, repositoryCaseId: 12, isDeleted: true },
];

const client = () =>
  ({
    projects: {
      findUnique: vi.fn(async ({ where }: any) => PROJECTS[where.id] ?? null),
    },
    repositoryCases: {
      findMany: vi.fn(async ({ where }: any) =>
        CASES.filter(
          (c) =>
            where.id.in.includes(c.id) &&
            c.projectId === where.projectId &&
            !c.notStarted
        ).map(({ id }) => ({ id }))
      ),
    },
    testRuns: {
      findUnique: vi.fn(async ({ where }: any) => RUNS[where.id] ?? null),
    },
    testRunCases: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: number[] | null =
          where.AND?.[0]?.id?.in ??
          (where.AND?.[0]?.id !== undefined ? [where.AND[0].id] : null);
        return RUN_CASES.filter(
          (r) => (ids === null || ids.includes(r.id)) && r.isDeleted
        ).map(({ id, repositoryCaseId, testRunId }) => ({
          id,
          repositoryCaseId,
          testRunId,
        }));
      }),
    },
  }) as unknown as EligibilityClient;

describe("applyRunCaseEligibility", () => {
  it("drops Not Started cases from a batch add, as the run dialog did", async () => {
    const args = {
      data: [
        { testRunId: 7, repositoryCaseId: 10, order: 1 },
        { testRunId: 7, repositoryCaseId: 12, order: 2 },
        { testRunId: 7, repositoryCaseId: 11, order: 3 },
      ],
    };
    await applyRunCaseEligibility("TestRunCases", "createMany", args, client());
    expect(args.data.map((r) => r.repositoryCaseId)).toEqual([10, 11]);
  });

  it("refuses a single add of a Not Started case, naming it", async () => {
    await expect(
      applyRunCaseEligibility(
        "TestRunCases",
        "create",
        {
          data: {
            testRun: { connect: { id: 7 } },
            repositoryCase: { connect: { id: 12 } },
          },
        },
        client()
      )
    ).rejects.toThrow(/Test case 12 is in a Not Started workflow state/);
  });

  it("lets everything through when the project does not exclude them", async () => {
    const args = { data: [{ testRunId: 8, repositoryCaseId: 12, order: 1 }] };
    const c = client();
    await applyRunCaseEligibility("TestRunCases", "createMany", args, c);
    expect(args.data).toHaveLength(1);
    expect(c.repositoryCases.findMany).not.toHaveBeenCalled();
  });

  it("filters a run create's nested cases by the run's project", async () => {
    const args = {
      data: {
        name: "Nightly",
        project: { connect: { id: 1 } },
        testCases: {
          create: [
            { repositoryCase: { connect: { id: 10 } }, order: 1 },
            { repositoryCase: { connect: { id: 12 } }, order: 2 },
          ],
        },
      },
    };
    await applyRunCaseEligibility("TestRuns", "create", args, client());
    expect(
      args.data.testCases.create.map((e) => e.repositoryCase.connect.id)
    ).toEqual([10]);
  });

  it("narrows a batch restore to the eligible rows and refuses a single one", async () => {
    const many = { where: { id: { in: [1, 2] } }, data: { isDeleted: false } };
    await applyRunCaseEligibility("TestRunCases", "updateMany", many, client());
    expect(many.where).toEqual({
      AND: [{ id: { in: [1, 2] } }, { id: { notIn: [2] } }],
    });

    await expect(
      applyRunCaseEligibility(
        "TestRunCases",
        "update",
        { where: { id: 2 }, data: { isDeleted: false } },
        client()
      )
    ).rejects.toBeInstanceOf(ORMError);
  });

  it("checks the create branch of an upsert for a case not yet in the run", async () => {
    await expect(
      applyRunCaseEligibility(
        "TestRunCases",
        "upsert",
        {
          where: {
            testRunId_repositoryCaseId: { testRunId: 7, repositoryCaseId: 12 },
          },
          create: { testRunId: 7, repositoryCaseId: 12, order: 1 },
          update: { order: 1 },
        },
        client()
      )
    ).rejects.toThrow(/Test case 12/);
  });
});
