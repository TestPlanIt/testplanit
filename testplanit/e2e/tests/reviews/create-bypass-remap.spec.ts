import { expect, test } from "../../fixtures";
import { sameOriginRequestHeaders } from "../../utils/secondary-context-login";
import {
  createGatedTestWorkflow,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  signInGateActor,
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
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    if (gatedWorkflowId) {
      await softDeleteWorkflow(request, url, gatedWorkflowId);
      gatedWorkflowId = null;
    }
    while (createdUserIds.length) {
      const id = createdUserIds.pop();
      if (id) {
        await request
          .patch(`${url}/api/model/user/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {});
      }
    }
  });

  test("create with gated state.connect.id remaps to default state", async ({
    browser,
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

    // The remap only applies to non-admins — system ADMINs bypass gating and
    // keep the state they asked for — so the create must come from a
    // non-admin session.
    const { context: actorContext, userId: actorUserId } =
      await signInGateActor(browser, request, url, api, createdUserIds);

    // Assign the actor to the project: the PROJECTADMIN blanket-write branch
    // in the schema is assignment-gated, which keeps this create authorized
    // even while a parallel admin spec edits role permission grids (the
    // default-access write branch depends on the actor's role grid).
    await api.assignUserToProject(actorUserId, projectId!);

    await test.step("Create a case with a gated state.connect.id as a non-admin", async () => {
      // POST a create with state.connect.id pointing at the gated workflow.
      // The auto-API path should remap to the default state.
      const postCreate = () =>
        actorContext.request.post(`${url}/api/model/repositoryCases/create`, {
          headers: sameOriginRequestHeaders(),
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
        });

      // The remap resolves "the default state" through the project's workflow
      // assignments, and admin-workflows-default-edit.spec.ts saves the seeded
      // default workflow by delete-then-recreating those assignment rows for
      // EVERY project. While that window is open the remap finds no default
      // and the route fails loudly with 422 by design. That is an unrelated
      // spec's window, not this contract — retry briefly before failing.
      let res = await postCreate();
      for (let attempt = 0; res.status() === 422 && attempt < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        res = await postCreate();
      }

      expect(res.status(), await res.text()).toBeLessThan(300);
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

    await actorContext.close();
  });
});
