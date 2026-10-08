import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";

/**
 * Test case dependency gating (#645).
 *
 * A `DEPENDS_ON` link reads "caseA depends on caseB". With the per-project
 * `enforceCaseDependencies` setting on, a run case is blocked — the server
 * refuses a result with `DEPENDENCIES_NOT_PASSED` — until every prerequisite
 * that is in the same run has passed. Prerequisites outside the run never
 * block. When the last prerequisite passes, the dependant's assignee gets a
 * RUN_CASE_UNBLOCKED notification through the ordinary worker path.
 *
 * All calls send `sec-fetch-site: same-origin` (the proxy blocks header-less
 * calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

async function countNotifications(
  request: APIRequestContext,
  baseURL: string | undefined,
  userId: string,
  type: string
): Promise<number> {
  const q = encodeURIComponent(
    JSON.stringify({
      where: { userId, type, isDeleted: false },
      select: { id: true },
    })
  );
  const response = await request.get(
    `${baseURL}/api/model/notification/findMany?q=${q}`
  );
  if (!response.ok()) return -1;
  const json = await response.json();
  return Array.isArray(json.data) ? json.data.length : -1;
}

test("dependency links are directional and the server rejects cycles and self-links", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  const projectId = await api.createProject(`E2E DepLinks ${ts}`);
  const folderId = await api.createFolder(projectId, `DepLinks Folder ${ts}`);
  const caseA = await api.createTestCase(
    projectId,
    folderId,
    `DepLinks A ${ts}`
  );
  const caseB = await api.createTestCase(
    projectId,
    folderId,
    `DepLinks B ${ts}`
  );
  const caseC = await api.createTestCase(
    projectId,
    folderId,
    `DepLinks C ${ts}`
  );
  const userId = await api.getCurrentUserId();

  const link = (dependant: number, prerequisite: number) =>
    request.post(`${baseURL}/api/model/repositoryCaseLink/create`, {
      headers: sameOrigin,
      data: {
        data: {
          caseA: { connect: { id: dependant } },
          caseB: { connect: { id: prerequisite } },
          type: "DEPENDS_ON",
          createdBy: { connect: { id: userId } },
        },
      },
    });

  await test.step("A chain B → A, C → B is accepted", async () => {
    expect((await link(caseB, caseA)).ok()).toBe(true);
    expect((await link(caseC, caseB)).ok()).toBe(true);
  });

  await test.step("Closing the chain into a cycle is rejected", async () => {
    const cycle = await link(caseA, caseC);
    expect(cycle.ok()).toBe(false);
    expect(cycle.status()).toBeLessThan(500);
    expect(await cycle.text()).toMatch(/circular/i);
  });

  await test.step("The direct reverse of an existing dependency is rejected", async () => {
    const reverse = await link(caseA, caseB);
    expect(reverse.ok()).toBe(false);
    expect(await reverse.text()).toMatch(/circular/i);
  });

  await test.step("A self-link is rejected", async () => {
    const self = await link(caseA, caseA);
    expect(self.ok()).toBe(false);
    expect(await self.text()).toMatch(/itself/i);
  });
});

test("blocks dependants until their prerequisites pass in the same run, then hands off", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId!: number;
  let runId!: number;
  let caseA!: number;
  let trcA!: number;
  let trcB!: number;
  let trcC!: number;
  let trcD!: number;
  let passedId!: number;
  let failedId!: number;
  let testerId!: string;

  await test.step("Set up a four-step scenario; D depends on a case that is not in the run", async () => {
    projectId = await api.createProject(`E2E DepGate ${ts}`);
    const folderId = await api.createFolder(projectId, `DepGate Folder ${ts}`);
    caseA = await api.createTestCase(
      projectId,
      folderId,
      `DepGate A order ${ts}`
    );
    const caseB = await api.createTestCase(
      projectId,
      folderId,
      `DepGate B provisioning ${ts}`
    );
    const caseC = await api.createTestCase(
      projectId,
      folderId,
      `DepGate C billing ${ts}`
    );
    const caseD = await api.createTestCase(
      projectId,
      folderId,
      `DepGate D standalone ${ts}`
    );
    const caseE = await api.createTestCase(
      projectId,
      folderId,
      `DepGate E not in run ${ts}`
    );
    const userId = await api.getCurrentUserId();
    for (const [dependant, prerequisite] of [
      [caseB, caseA],
      [caseC, caseB],
      [caseD, caseE],
    ]) {
      const created = await request.post(
        `${baseURL}/api/model/repositoryCaseLink/create`,
        {
          headers: sameOrigin,
          data: {
            data: {
              caseA: { connect: { id: dependant } },
              caseB: { connect: { id: prerequisite } },
              type: "DEPENDS_ON",
              createdBy: { connect: { id: userId } },
            },
          },
        }
      );
      expect(created.ok(), await created.text()).toBe(true);
    }

    runId = await api.createTestRun(projectId, `DepGate Run ${ts}`);
    trcA = await api.addTestCaseToTestRun(runId, caseA);
    trcB = await api.addTestCaseToTestRun(runId, caseB);
    trcC = await api.addTestCaseToTestRun(runId, caseC);
    trcD = await api.addTestCaseToTestRun(runId, caseD);
    passedId = await api.getStatusId("passed");
    failedId = await api.getStatusId("failed");

    const tester = await api.createUser({
      name: `DepGate Tester ${ts}`,
      email: `depgate-${ts}@example.com`,
      password: "DepGate!Pass123",
    });
    testerId = tester.data.id;
    await api.assignTestRunCase(trcB, testerId);
  });

  const submit = (testRunCaseId: number, statusId: number) =>
    request.post(`${baseURL}/api/test-runs/submit-result`, {
      headers: sameOrigin,
      data: {
        testRunId: runId,
        testRunCaseId,
        statusId,
        attempt: 1,
        testRunCaseVersion: 1,
      },
    });

  await test.step("Enable dependency enforcement for the project", async () => {
    const patched = await request.patch(
      `${baseURL}/api/model/projects/update`,
      {
        headers: sameOrigin,
        data: {
          where: { id: projectId },
          data: { enforceCaseDependencies: true },
        },
      }
    );
    expect(patched.ok(), await patched.text()).toBe(true);
  });

  await test.step("B is blocked while A is untested, naming A", async () => {
    const blocked = await submit(trcB, passedId);
    expect(blocked.status()).toBe(409);
    const body = await blocked.json();
    expect(body.code).toBe("DEPENDENCIES_NOT_PASSED");
    expect(body.blockedBy).toEqual([
      expect.objectContaining({ testRunCaseId: trcA, repositoryCaseId: caseA }),
    ]);
  });

  await test.step("A direct model-API result create is refused the same way", async () => {
    const rpc = await request.post(
      `${baseURL}/api/model/testRunResults/create`,
      {
        headers: sameOrigin,
        data: {
          data: {
            executedAt: new Date().toISOString(),
            testRun: { connect: { id: runId } },
            testRunCase: { connect: { id: trcB } },
            status: { connect: { id: passedId } },
            executedBy: { connect: { id: await api.getCurrentUserId() } },
          },
        },
      }
    );
    expect(rpc.status()).toBe(409);
    expect((await rpc.json()).error.code).toBe("DEPENDENCIES_NOT_PASSED");
  });

  await test.step("A createMany batch and a nested create are refused too", async () => {
    const userId = await api.getCurrentUserId();
    const batch = await request.post(
      `${baseURL}/api/model/testRunResults/createMany`,
      {
        headers: sameOrigin,
        data: {
          data: [
            {
              executedAt: new Date().toISOString(),
              testRunId: runId,
              testRunCaseId: trcB,
              statusId: passedId,
              executedById: userId,
            },
          ],
        },
      }
    );
    expect(batch.status()).toBe(409);
    expect((await batch.json()).error.code).toBe("DEPENDENCIES_NOT_PASSED");

    const upsert = await request.post(
      `${baseURL}/api/model/testRunResults/upsert`,
      {
        headers: sameOrigin,
        data: {
          where: { id: -1 },
          update: {},
          create: {
            executedAt: new Date().toISOString(),
            testRun: { connect: { id: runId } },
            testRunCase: { connect: { id: trcB } },
            status: { connect: { id: passedId } },
            executedBy: { connect: { id: userId } },
          },
        },
      }
    );
    expect(upsert.status()).toBe(409);
    expect((await upsert.json()).error.code).toBe("DEPENDENCIES_NOT_PASSED");

    // A nested create rides on a TestRunCases update, which the route's
    // preflight does not see; the database trigger refuses it instead.
    const nested = await request.patch(
      `${baseURL}/api/model/testRunCases/update`,
      {
        headers: sameOrigin,
        data: {
          where: { id: trcB },
          data: {
            results: {
              create: {
                executedAt: new Date().toISOString(),
                testRun: { connect: { id: runId } },
                status: { connect: { id: passedId } },
                executedBy: { connect: { id: userId } },
              },
            },
          },
        },
      }
    );
    expect(nested.ok()).toBe(false);
    expect(nested.status()).toBeLessThan(500);
    expect(await nested.text()).toMatch(/blocked until its prerequisites/i);
  });

  await test.step("A prerequisite outside the run does not block", async () => {
    const ok = await submit(trcD, passedId);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  await test.step("A failing A keeps B blocked", async () => {
    expect((await submit(trcA, failedId)).status()).toBe(200);
    expect((await submit(trcB, passedId)).status()).toBe(409);
  });

  await test.step("A passing A opens B and notifies B's assignee", async () => {
    const ok = await submit(trcA, passedId);
    expect(ok.status(), await ok.text()).toBe(200);
    await expect
      .poll(
        () =>
          countNotifications(request, baseURL, testerId, "RUN_CASE_UNBLOCKED"),
        { timeout: 30000 }
      )
      .toBe(1);
    // C still waits on B.
    expect((await submit(trcC, passedId)).status()).toBe(409);
  });

  await test.step("Re-submitting A as passed does not notify again", async () => {
    expect((await submit(trcA, passedId)).status()).toBe(200);
    // The first notification arrived within the poll above; a duplicate
    // would be queued immediately by the same path, so a short wait is enough.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(
      await countNotifications(request, baseURL, testerId, "RUN_CASE_UNBLOCKED")
    ).toBe(1);
  });

  await test.step("B passing opens C", async () => {
    expect((await submit(trcB, passedId)).status()).toBe(200);
    const ok = await submit(trcC, passedId);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  await test.step("Flipping A back to failed re-blocks B", async () => {
    expect((await submit(trcA, failedId)).status()).toBe(200);
    expect((await submit(trcB, passedId)).status()).toBe(409);
  });

  await test.step("Disabling enforcement re-opens every case", async () => {
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { enforceCaseDependencies: false },
      },
    });
    const ok = await submit(trcB, passedId);
    expect(ok.status(), await ok.text()).toBe(200);
  });
});
