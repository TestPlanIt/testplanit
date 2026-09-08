import { expect, test } from "../../fixtures";

/**
 * Execution-start composition lock (BOR-1).
 *
 * A composition-locked run freezes which cases are in it (add / remove /
 * reorder) while execution continues — the opposite of the completion lock,
 * which freezes everything. Verifies, against a live database:
 *  - before locking, adding cases and recording results works;
 *  - while locked, adding / reordering / removing cases is rejected at BOTH the
 *    policy layer (model API) and — implicitly — the DB trigger, yet recording a
 *    result still succeeds;
 *  - unlocking restores the ability to change the case set.
 *
 * Model-API calls send `sec-fetch-site: same-origin` (the proxy blocks
 * header-less calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

test("composition-locked runs freeze the case set but still allow execution", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  let projectId: number | undefined;
  let folderId: number | undefined;
  let case1: number | undefined;
  let case2: number | undefined;
  let runId: number | undefined;
  let passedId: number | undefined;
  let trc1: number | undefined;

  const setLock = (locked: boolean) =>
    request.patch(`${baseURL}/api/test-runs/${runId}/composition-lock`, {
      headers: sameOrigin,
      data: { locked },
    });

  await test.step("Create project, folder, cases, run and resolve passed status", async () => {
    projectId = await api.createProject(`E2E CompositionLock ${ts}`);
    folderId = await api.createFolder(projectId, `CO Folder ${ts}`);
    case1 = await api.createTestCase(projectId!, folderId!, `CO Case A ${ts}`);
    case2 = await api.createTestCase(projectId!, folderId!, `CO Case B ${ts}`);
    runId = await api.createTestRun(projectId!, `CO Run ${ts}`);
    passedId = await api.getStatusId("passed");
  });

  await test.step("Before locking, add a case and record a result", async () => {
    trc1 = await api.addTestCaseToTestRun(runId!, case1!);
    await api.createTestResult(runId!, trc1!, passedId!);
  });

  await test.step("Lock the composition", async () => {
    const res = await setLock(true);
    expect(res.status(), await res.text()).toBeLessThan(300);
    expect((await res.json())?.locked).toBe(true);
  });

  await test.step("Composition is frozen: add, reorder and remove are rejected", async () => {
    // Add a case (model API create) → denied.
    await expect(api.addTestCaseToTestRun(runId!, case2!)).rejects.toThrow();

    // Reorder a case (update order) → denied.
    const reorder = await request.patch(
      `${baseURL}/api/model/testRunCases/update`,
      { headers: sameOrigin, data: { where: { id: trc1 }, data: { order: 5 } } }
    );
    expect(reorder.status()).toBeGreaterThanOrEqual(400);

    // Remove a case (soft-delete) → denied.
    const remove = await request.patch(
      `${baseURL}/api/model/testRunCases/update`,
      {
        headers: sameOrigin,
        data: { where: { id: trc1 }, data: { isDeleted: true } },
      }
    );
    expect(remove.status()).toBeGreaterThanOrEqual(400);
  });

  await test.step("Execution still works on a locked run", async () => {
    // Recording another result on the existing case is NOT composition — allowed.
    const submit = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: {
          testRunId: runId,
          testRunCaseId: trc1,
          statusId: passedId,
          attempt: 2,
          testRunCaseVersion: 1,
        },
      }
    );
    expect(submit.status(), await submit.text()).toBeLessThan(300);
  });

  await test.step("Unlock restores the ability to change the case set", async () => {
    const res = await setLock(false);
    expect(res.status(), await res.text()).toBeLessThan(300);
    expect((await res.json())?.locked).toBe(false);

    // Adding a case now works again.
    const trc2 = await api.addTestCaseToTestRun(runId!, case2!);
    expect(trc2).toBeGreaterThan(0);
  });
});

test("run auto-locks when it enters an In Progress state with the project opt-in", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  const projectId = await api.createProject(`E2E AutoLock ${ts}`);
  const folderId = await api.createFolder(projectId, `AL Folder ${ts}`);
  const caseId = await api.createTestCase(projectId, folderId, `AL Case ${ts}`);
  const runId = await api.createTestRun(projectId, `AL Run ${ts}`);
  await api.addTestCaseToTestRun(runId, caseId);

  const stateIdOfType = async (workflowType: "NOT_STARTED" | "IN_PROGRESS") => {
    const res = await request.get(`${baseURL}/api/model/workflows/findFirst`, {
      headers: sameOrigin,
      params: {
        q: JSON.stringify({
          where: {
            workflowType,
            isDeleted: false,
            projects: { some: { projectId } },
          },
          select: { id: true },
        }),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const id: number | undefined = (await res.json())?.data?.id;
    expect(
      id,
      `project ${projectId} needs a ${workflowType} workflow`
    ).toBeTruthy();
    return id!;
  };

  const compositionLockedAt = async () => {
    const res = await request.get(`${baseURL}/api/model/testRuns/findUnique`, {
      headers: sameOrigin,
      params: {
        q: JSON.stringify({
          where: { id: runId },
          select: { compositionLockedAt: true },
        }),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json())?.data?.compositionLockedAt as string | null;
  };

  const setState = async (stateId: number) => {
    const res = await request.patch(`${baseURL}/api/model/testRuns/update`, {
      headers: sameOrigin,
      data: {
        where: { id: runId },
        data: { state: { connect: { id: stateId } } },
      },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  };

  await test.step("Enable the project auto-lock opt-in", async () => {
    const res = await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { autoLockCompositionOnInProgress: true },
      },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  });

  await test.step("Moving to a Not Started state does NOT lock", async () => {
    await setState(await stateIdOfType("NOT_STARTED"));
    expect(await compositionLockedAt()).toBeFalsy();
  });

  await test.step("Moving to an In Progress state auto-locks the composition", async () => {
    await setState(await stateIdOfType("IN_PROGRESS"));
    expect(await compositionLockedAt()).toBeTruthy();
  });
});
