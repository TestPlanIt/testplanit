/**
 * Live-DB integration test for the copy/move workflow-state lookup helpers
 * in `lib/services/workflowStateMapping.ts`.
 *
 * Per feedback_prisma_helper_live_db_test: mocked-Prisma tests can't catch
 * unknown-column errors or relation-filter shape mismatches. The helpers'
 * logic is covered through the preflight-route and copyMoveWorker suites
 * with mocked clients; this file proves the query shapes — the
 * `workflow: { scope, isDeleted }` relation filter, the nested select, and
 * the ordered repositories lookup — against a real Postgres schema.
 *
 * Execution model:
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a development/test database.
 *   - Every created row id is tracked and hard-deleted in `afterEach`,
 *     leaving the DB exactly as it was found.
 */

import { afterEach, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("workflowStateMapping helpers (live DB)", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const helpers = await import("~/lib/services/workflowStateMapping");
    return { baseDb, ...helpers };
  };

  const cleanup: {
    assignmentKeys: Array<{ workflowId: number; projectId: number }>;
    workflowIds: number[];
    repositoryIds: number[];
    projectIds: number[];
  } = {
    assignmentKeys: [],
    workflowIds: [],
    repositoryIds: [],
    projectIds: [],
  };

  afterEach(async () => {
    const { baseDb } = await importDeps();
    for (const key of cleanup.assignmentKeys) {
      await baseDb.projectWorkflowAssignment
        .delete({ where: { workflowId_projectId: key } })
        .catch(() => {});
    }
    if (cleanup.workflowIds.length) {
      await baseDb.workflows
        .deleteMany({ where: { id: { in: cleanup.workflowIds } } })
        .catch(() => {});
    }
    if (cleanup.repositoryIds.length) {
      await baseDb.repositories
        .deleteMany({ where: { id: { in: cleanup.repositoryIds } } })
        .catch(() => {});
    }
    if (cleanup.projectIds.length) {
      await baseDb.projects
        .deleteMany({ where: { id: { in: cleanup.projectIds } } })
        .catch(() => {});
    }
    cleanup.assignmentKeys = [];
    cleanup.workflowIds = [];
    cleanup.repositoryIds = [];
    cleanup.projectIds = [];
  });

  async function seedFixture(baseDb: any) {
    const creator = await baseDb.user.findFirst({ select: { id: true } });
    const anyColor = await baseDb.color.findFirst({ select: { id: true } });
    const anyIcon = await baseDb.fieldIcon.findFirst({ select: { id: true } });
    if (!creator || !anyColor || !anyIcon) {
      throw new Error(
        "Seed the DB (User/Color/FieldIcon) before running this integration test"
      );
    }

    const tag = `wf-state-map-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const project = await baseDb.projects.create({
      data: { name: tag, createdBy: creator.id },
      select: { id: true },
    });
    cleanup.projectIds.push(project.id);

    const makeWorkflow = async (
      name: string,
      scope: "CASES" | "SESSIONS",
      opts: { isDefault?: boolean; isDeleted?: boolean } = {}
    ) => {
      const wf = await baseDb.workflows.create({
        data: {
          name,
          order: 1,
          iconId: anyIcon.id,
          colorId: anyColor.id,
          scope,
          isDefault: opts.isDefault ?? false,
          isDeleted: opts.isDeleted ?? false,
        },
        select: { id: true },
      });
      cleanup.workflowIds.push(wf.id);
      await baseDb.projectWorkflowAssignment.create({
        data: { workflowId: wf.id, projectId: project.id },
      });
      cleanup.assignmentKeys.push({
        workflowId: wf.id,
        projectId: project.id,
      });
      return wf.id;
    };

    return { project, tag, makeWorkflow };
  }

  it("getCasesWorkflowAssignments returns only live CASES-scoped states", async () => {
    const { baseDb, getCasesWorkflowAssignments } = await importDeps();
    const { project, tag, makeWorkflow } = await seedFixture(baseDb);

    const caseStateId = await makeWorkflow(`${tag}-draft`, "CASES", {
      isDefault: true,
    });
    await makeWorkflow(`${tag}-session`, "SESSIONS");
    await makeWorkflow(`${tag}-deleted`, "CASES", { isDeleted: true });

    const states = await getCasesWorkflowAssignments(baseDb as any, project.id);

    expect(states.map((s) => s.id)).toEqual([caseStateId]);
    expect(states[0]).toMatchObject({
      name: `${tag}-draft`,
      isDefault: true,
    });
  });

  it("getWorkflowNamesByIds resolves names straight from the workflows table", async () => {
    const { baseDb, getWorkflowNamesByIds } = await importDeps();
    const { tag, makeWorkflow } = await seedFixture(baseDb);

    const stateId = await makeWorkflow(`${tag}-active`, "CASES");

    const names = await getWorkflowNamesByIds(baseDb as any, [stateId]);
    expect(names.get(stateId)).toBe(`${tag}-active`);
  });

  it("findActiveRepository picks the lowest-id active repository deterministically", async () => {
    const { baseDb, findActiveRepository } = await importDeps();
    const { project } = await seedFixture(baseDb);

    const makeRepo = async (isActive: boolean) => {
      const repo = await baseDb.repositories.create({
        data: { projectId: project.id, isActive },
        select: { id: true },
      });
      cleanup.repositoryIds.push(repo.id);
      return repo.id;
    };

    const firstActive = await makeRepo(true);
    await makeRepo(true);

    const resolved = await findActiveRepository(baseDb as any, project.id);
    expect(resolved?.id).toBe(firstActive);
  });
});
