import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Review & Approval — create-time state remap.
 *
 * When gating is active, POST to `/api/model/repositoryCases/create` with a
 * `state.connect.id` pointing at a gated workflow MUST silently remap the
 * candidate to the project's default state. The schema-layer
 * `@@deny('create', state.requiresReview)` rule doesn't navigate the `state`
 * relation reliably on connect-style inputs in ZenStack 2.x, so the auto-API
 * route enforces strict-transitive create semantics in app code via
 * `resolveCreateStateRemap`. This spec is the regression test for that path.
 */

test.describe("create-time state remap (gated create bypass)", () => {
  let gatedWorkflowId: number | null = null;

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    if (gatedWorkflowId) {
      await softDeleteWorkflow(request, url, gatedWorkflowId);
      gatedWorkflowId = null;
    }
  });

  test("create with gated state.connect.id remaps to default state", async ({
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const caseName = `Remap case ${Date.now()}`;

    let projectId: number | undefined;
    let defaultStateId: number | undefined;
    let repositoryId: number | undefined;
    let templateId: number | undefined;
    let folderId: number | undefined;
    let created: any;

    await test.step("Create project and resolve its case-scope workflows", async () => {
      projectId = await api.createProject(`Reviews-CreateRemap ${Date.now()}`);

      // Two case-scope workflows: ids[0] (default — first by order) is where
      // the remap should land; ids[1] is the gated target the request hands in.
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId!,
        "CASES",
        5
      );
      expect(ids.length).toBeGreaterThanOrEqual(1);
      defaultStateId = ids[0];
    });

    await test.step("Enable review gating and create a gated workflow", async () => {
      await setProjectReviewWorkflowEnabled(request, url, projectId!, true);
      const gated = await createGatedTestWorkflow(
        request,
        url,
        projectId!,
        "CASES"
      );
      gatedWorkflowId = gated.id;
    });

    await test.step("Resolve repository, template, and folder for the create payload", async () => {
      // Resolve repository + template + folder so the create payload is valid.
      const repoRes = await request.get(
        `${url}/api/model/repositories/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { projectId, isDeleted: false },
              select: { id: true },
            }),
          },
        }
      );
      repositoryId = (await repoRes.json())?.data?.id as number;
      expect(repositoryId).toBeTruthy();

      const tplRes = await request.get(
        `${url}/api/model/templateProjectAssignment/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { projectId },
              select: { templateId: true },
            }),
          },
        }
      );
      templateId = (await tplRes.json())?.data?.templateId as number;
      expect(templateId).toBeTruthy();

      folderId = await api.createFolder(
        projectId!,
        `Remap folder ${Date.now()}`
      );
    });

    await test.step("Create a case with a gated state.connect.id", async () => {
      // POST a create with state.connect.id pointing at the gated workflow.
      // The auto-API path should remap to the default state.
      const res = await request.post(
        `${url}/api/model/repositoryCases/create`,
        {
          data: {
            data: {
              name: caseName,
              order: 0,
              automated: false,
              isArchived: false,
              isDeleted: false,
              currentVersion: 1,
              source: "MANUAL",
              project: { connect: { id: projectId } },
              repository: { connect: { id: repositoryId } },
              folder: { connect: { id: folderId } },
              template: { connect: { id: templateId } },
              state: { connect: { id: gatedWorkflowId } },
            },
          },
        }
      );

      expect(res.status()).toBeLessThan(300);
      const body = await res.json();
      created = body?.data;
      expect(created?.id).toBeTruthy();
    });

    await test.step("Verify the case landed in the default state, not the gated workflow", async () => {
      // Critical assertion: the row landed in the default state, NOT the
      // gated workflow we asked for.
      expect(created.stateId).toBe(defaultStateId);
      expect(created.stateId).not.toBe(gatedWorkflowId);
    });
  });
});
