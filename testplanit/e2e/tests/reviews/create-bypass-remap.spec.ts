import { expect, test } from "../../fixtures";
import {
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  setWorkflowRequiresReview,
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
      await setWorkflowRequiresReview(request, url, gatedWorkflowId, false);
      gatedWorkflowId = null;
    }
  });

  test("create with gated state.connect.id remaps to default state", async ({
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(`Reviews-CreateRemap ${Date.now()}`);

    // Two case-scope workflows: ids[0] (default — first by order) is where
    // the remap should land; ids[1] is the gated target the request hands in.
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const defaultStateId = ids[0];
    gatedWorkflowId = ids[1];

    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    await setWorkflowRequiresReview(request, url, gatedWorkflowId, true);

    // Resolve repository + template + folder so the create payload is valid.
    const repoRes = await request.get(
      `${url}/api/model/repository/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { projectId, isDeleted: false },
            select: { id: true },
          }),
        },
      }
    );
    const repositoryId = (await repoRes.json())?.data?.id as number;
    expect(repositoryId).toBeTruthy();

    const tplRes = await request.get(
      `${url}/api/model/projectTemplate/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { projectId },
            select: { templateId: true },
          }),
        },
      }
    );
    const templateId = (await tplRes.json())?.data?.templateId as number;
    expect(templateId).toBeTruthy();

    const folderId = await api.createFolder(
      projectId,
      `Remap folder ${Date.now()}`
    );
    const caseName = `Remap case ${Date.now()}`;

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
    const created = body?.data;
    expect(created?.id).toBeTruthy();
    // Critical assertion: the row landed in the default state, NOT the
    // gated workflow we asked for.
    expect(created.stateId).toBe(defaultStateId);
    expect(created.stateId).not.toBe(gatedWorkflowId);
  });
});
