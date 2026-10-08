import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDependencyGateError } from "~/lib/utils/errors";
import {
  assertDependencyGateOpen,
  findBlockingPrerequisites,
  findUnblockedDependants,
  loadDependencyState,
} from "./dependencyGate";

// Repository: 2 depends on 1; 3 depends on 1 and 2; 4 depends on 9 (not in
// the run). Run 50 holds cases 1, 2, 3 and 4 as run cases 10, 20, 30, 40.
const LINKS = [
  { caseAId: 2, caseBId: 1, caseB: { name: "Create order" } },
  { caseAId: 3, caseBId: 1, caseB: { name: "Create order" } },
  { caseAId: 3, caseBId: 2, caseB: { name: "Verify provisioning" } },
  { caseAId: 4, caseBId: 9, caseB: { name: "Elsewhere" } },
];

function makeDb(passed: Record<number, boolean>) {
  const runCases = [
    { id: 10, repositoryCaseId: 1, assignedToId: "crm", name: "Create order" },
    {
      id: 20,
      repositoryCaseId: 2,
      assignedToId: "prov",
      name: "Verify provisioning",
    },
    { id: 30, repositoryCaseId: 3, assignedToId: null, name: "Activation" },
    { id: 40, repositoryCaseId: 4, assignedToId: "bill", name: "Billing" },
  ];
  const db = {
    repositoryCaseLink: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.caseAId) {
          return LINKS.filter((l) => where.caseAId.in.includes(l.caseAId));
        }
        return LINKS.filter((l) => l.caseBId === where.caseBId).map((l) => ({
          caseAId: l.caseAId,
        }));
      }),
    },
    testRunCases: {
      findMany: vi.fn(async ({ where, select }: any) => {
        const ids: number[] = where.repositoryCaseId.in;
        return runCases
          .filter(
            (rc) => where.testRunId === 50 && ids.includes(rc.repositoryCaseId)
          )
          .map((rc) =>
            select.status
              ? {
                  id: rc.id,
                  repositoryCaseId: rc.repositoryCaseId,
                  status: { isSuccess: passed[rc.repositoryCaseId] ?? false },
                }
              : {
                  id: rc.id,
                  repositoryCaseId: rc.repositoryCaseId,
                  assignedToId: rc.assignedToId,
                  repositoryCase: { name: rc.name },
                }
          );
      }),
    },
  };
  return db;
}

describe("dependencyGate", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("loadDependencyState", () => {
    it("runs no query for an empty case list", async () => {
      const db = makeDb({});
      const state = await loadDependencyState(db, {
        testRunId: 50,
        repositoryCaseIds: [],
      });
      expect(state.size).toBe(0);
      expect(db.repositoryCaseLink.findMany).not.toHaveBeenCalled();
    });

    it("skips the run-case query when the cases have no dependency links", async () => {
      const db = makeDb({});
      await loadDependencyState(db, { testRunId: 50, repositoryCaseIds: [1] });
      expect(db.testRunCases.findMany).not.toHaveBeenCalled();
    });

    it("reads only live DEPENDS_ON links and only live run cases of this run", async () => {
      const db = makeDb({});
      await loadDependencyState(db, {
        testRunId: 50,
        repositoryCaseIds: [3, 3],
      });
      expect(db.repositoryCaseLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { caseAId: { in: [3] }, type: "DEPENDS_ON", isDeleted: false },
        })
      );
      expect(db.testRunCases.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            testRunId: 50,
            repositoryCaseId: { in: [1, 2] },
            isDeleted: false,
          },
        })
      );
    });
  });

  describe("findBlockingPrerequisites / assertDependencyGateOpen", () => {
    it("names every prerequisite in the run that has not passed", async () => {
      const db = makeDb({ 1: true });
      await expect(
        findBlockingPrerequisites(db, { testRunId: 50, repositoryCaseId: 3 })
      ).resolves.toEqual([
        { testRunCaseId: 20, repositoryCaseId: 2, name: "Verify provisioning" },
      ]);
    });

    it("throws a DependencyGateError carrying the blockers", async () => {
      const db = makeDb({});
      const error = await assertDependencyGateOpen(db, {
        testRunId: 50,
        repositoryCaseId: 2,
      }).catch((e) => e);
      expect(isDependencyGateError(error)).toBe(true);
      expect(error.code).toBe("DEPENDENCIES_NOT_PASSED");
      expect(error.blockedBy).toEqual([
        { testRunCaseId: 10, repositoryCaseId: 1, name: "Create order" },
      ]);
    });

    it("passes once every prerequisite in the run has passed", async () => {
      const db = makeDb({ 1: true, 2: true });
      await expect(
        assertDependencyGateOpen(db, { testRunId: 50, repositoryCaseId: 3 })
      ).resolves.toBeUndefined();
    });

    it("passes when the only prerequisite is not in the run", async () => {
      const db = makeDb({});
      await expect(
        assertDependencyGateOpen(db, { testRunId: 50, repositoryCaseId: 4 })
      ).resolves.toBeUndefined();
    });

    it("passes for a case with no dependencies", async () => {
      const db = makeDb({});
      await expect(
        assertDependencyGateOpen(db, { testRunId: 50, repositoryCaseId: 1 })
      ).resolves.toBeUndefined();
    });
  });

  describe("findUnblockedDependants", () => {
    it("returns the dependants whose every prerequisite in the run has passed", async () => {
      // 1 just passed: 2 opens (its only prerequisite), 3 still waits on 2.
      const db = makeDb({ 1: true });
      await expect(
        findUnblockedDependants(db, { testRunId: 50, repositoryCaseId: 1 })
      ).resolves.toEqual([
        {
          testRunCaseId: 20,
          repositoryCaseId: 2,
          name: "Verify provisioning",
          assignedToId: "prov",
        },
      ]);
    });

    it("opens a dependant with several prerequisites only when the last one passes", async () => {
      const db = makeDb({ 1: true, 2: true });
      const opened = await findUnblockedDependants(db, {
        testRunId: 50,
        repositoryCaseId: 2,
      });
      expect(opened.map((d) => d.repositoryCaseId)).toEqual([3]);
      expect(opened[0]?.assignedToId).toBeNull();
    });

    it("returns nothing for a case nobody depends on", async () => {
      const db = makeDb({ 4: true });
      await expect(
        findUnblockedDependants(db, { testRunId: 50, repositoryCaseId: 4 })
      ).resolves.toEqual([]);
      expect(db.testRunCases.findMany).not.toHaveBeenCalled();
    });
  });
});
