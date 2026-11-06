import { expect, test } from "../../fixtures";

/**
 * Never-executed cases: Pending vs Untested
 *
 * A run-case with no result keeps a null status. While the run is open the
 * case is still Pending; once the run is completed it is locked, so the same
 * case is Untested. Both summary endpoints (per-run and batch) derive that
 * label from the run's completion state, in the status counts and in the
 * per-case details, and expose `isCompleted` alongside.
 *
 * Model-API calls send `sec-fetch-site: same-origin` (the proxy blocks
 * header-less calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

type Summary = {
  isCompleted?: boolean;
  totalCases: number;
  statusCounts: Array<{
    statusId: number | null;
    statusName: string;
    count: number;
  }>;
  caseDetails?: Array<{ statusId: number | null; statusName: string }>;
};

test("never-executed cases read Pending on an open run and Untested once it is completed", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  let projectId: number | undefined;
  let runId: number | undefined;
  let passedId: number | undefined;

  await test.step("Create a run with one executed and one never-executed case", async () => {
    projectId = await api.createProject(`E2E Unexecuted ${ts}`);
    const folderId = await api.createFolder(projectId, `UL Folder ${ts}`);
    const executed = await api.createTestCase(
      projectId,
      folderId,
      `UL Executed ${ts}`
    );
    const unexecuted = await api.createTestCase(
      projectId,
      folderId,
      `UL Unexecuted ${ts}`
    );
    runId = await api.createTestRun(projectId, `UL Run ${ts}`);
    passedId = await api.getStatusId("passed");
    const trc = await api.addTestCaseToTestRun(runId, executed, {
      statusId: passedId,
    });
    await api.addTestCaseToTestRun(runId, unexecuted);
    await api.createTestResult(runId, trc, passedId);
  });

  const readBoth = async (): Promise<Record<"single" | "batch", Summary>> => {
    const single = await request.get(
      `/api/test-runs/${runId}/summary?includeCaseDetails=true`
    );
    expect(single.ok(), await single.text()).toBeTruthy();
    const batch = await request.get(
      `/api/test-runs/summaries?testRunIds=${runId}`
    );
    expect(batch.ok(), await batch.text()).toBeTruthy();
    return {
      single: await single.json(),
      batch: (await batch.json()).summaries[runId!],
    };
  };

  const expectUnexecutedLabel = (summary: Summary, label: string) => {
    expect(summary.totalCases).toBe(2);
    const unexecuted = summary.statusCounts.filter((c) => c.statusId === null);
    expect(unexecuted).toEqual([
      expect.objectContaining({ statusName: label, count: 1 }),
    ]);
    expect(
      summary.statusCounts.find((c) => c.statusId === passedId)?.count
    ).toBe(1);
    expect(
      summary
        .caseDetails!.filter((c) => c.statusId === null)
        .map((c) => c.statusName)
    ).toEqual([label]);
  };

  await test.step("While open, both endpoints report the case as Pending", async () => {
    const { single, batch } = await readBoth();
    for (const summary of [single, batch]) {
      expect(summary.isCompleted).toBe(false);
      expectUnexecutedLabel(summary, "Pending");
    }
  });

  await test.step("Complete the run", async () => {
    const complete = await request.patch(
      `${baseURL}/api/model/testRuns/update`,
      {
        headers: sameOrigin,
        data: {
          where: { id: runId },
          data: { isCompleted: true, completedAt: new Date().toISOString() },
        },
      }
    );
    expect(complete.status(), await complete.text()).toBeLessThan(300);
  });

  await test.step("Once completed, both endpoints report the same case as Untested", async () => {
    const { single, batch } = await readBoth();
    for (const summary of [single, batch]) {
      expect(summary.isCompleted).toBe(true);
      expectUnexecutedLabel(summary, "Untested");
    }
  });

  await test.step("Clean up", async () => {
    await api.deleteProject(projectId!);
  });
});
