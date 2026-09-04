import { expect, test } from "../../fixtures";

/**
 * Step-sequence scan API: submit a scan for a project whose cases share a
 * run of identical steps, wait for the worker to finish, then convert the
 * match into a shared step group.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function step(text: string, expected: string, order: number) {
  return { step: doc(text), expectedResult: doc(expected), order };
}

test.describe("Step scan API", () => {
  test("rejects a scan for a bad payload", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/step-scan/submit`, {
      data: { projectId: "not-a-number" },
    });
    expect(res.status()).toBe(400);
  });

  test("reports an unknown job as not found", async ({ request, baseURL }) => {
    const res = await request.get(
      `${baseURL}/api/step-scan/status/does-not-exist-${uid()}`
    );
    expect(res.status()).toBe(404);
  });

  test("scans a project, finds the shared sequence, and converts it", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Step Scan ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseA = await api.createTestCase(projectId, folderId, `Scan A ${ts}`);
    const caseB = await api.createTestCase(projectId, folderId, `Scan B ${ts}`);
    const shared = [
      step("Open the login page", "The form is shown", 0),
      step("Enter valid credentials", "Fields are filled", 1),
      step("Submit the form", "The dashboard opens", 2),
    ];
    await api.addStepsToTestCase(caseA, shared);
    await api.addStepsToTestCase(caseB, shared);

    let jobId = "";
    await test.step("Submit the scan", async () => {
      const res = await request.post(`${baseURL}/api/step-scan/submit`, {
        data: { projectId, minSteps: 3 },
      });
      expect(res.status()).toBe(202);
      jobId = (await res.json()).jobId;
      expect(jobId).toBeTruthy();
    });

    await test.step("The worker completes the job", async () => {
      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${baseURL}/api/step-scan/status/${jobId}`
            );
            if (!res.ok()) return `http ${res.status()}`;
            const body = await res.json();
            return body.state === "failed"
              ? `failed: ${body.failedReason}`
              : body.state;
          },
          { timeout: 90000, intervals: [500, 1000, 2000] }
        )
        .toBe("completed");
      const res = await request.get(`${baseURL}/api/step-scan/status/${jobId}`);
      expect((await res.json()).result?.matchesFound).toBeGreaterThanOrEqual(1);
    });

    let matchId = 0;
    await test.step("A pending match covers both cases", async () => {
      const res = await request.get(
        `${baseURL}/api/model/stepSequenceMatch/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { projectId, status: "PENDING", isDeleted: false },
              orderBy: { id: "desc" },
              select: {
                id: true,
                stepCount: true,
                members: { select: { caseId: true } },
              },
            }),
          },
        }
      );
      const match = (await res.json()).data;
      expect(match).toBeTruthy();
      matchId = match.id;
      expect(match.stepCount).toBeGreaterThanOrEqual(3);
      const caseIds = match.members.map((m: { caseId: number }) => m.caseId);
      expect(caseIds).toEqual(expect.arrayContaining([caseA, caseB]));
    });

    await test.step("Converting the match creates a shared step group", async () => {
      const groupName = `Login steps ${ts}`;
      const res = await request.post(`${baseURL}/api/step-scan/convert`, {
        data: {
          matchId,
          sharedStepGroupName: groupName,
          affectedCaseIds: [caseA, caseB],
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.sharedStepGroupId).toBeTruthy();
      expect(body.convertedCaseIds).toEqual(
        expect.arrayContaining([caseA, caseB])
      );

      const group = await request.get(
        `${baseURL}/api/model/sharedStepGroup/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: body.sharedStepGroupId },
              select: { name: true, projectId: true },
            }),
          },
        }
      );
      const row = (await group.json()).data;
      expect(row?.name).toBe(groupName);
      expect(row?.projectId).toBe(projectId);
    });
  });
});
