import { expect, test } from "../../fixtures";

/**
 * Session result required-field server-side enforcement.
 *
 * Covers the bypass closed by the handler-level guard added to
 * `app/api/model/[...path]/route.ts`. The guard intercepts every
 * `sessionResults.create` request — first-party UI and raw API alike — and
 * rejects with `REQUIRED_FIELDS_MISSING` (HTTP 400) when the parent session's
 * template marks any Result Field as required and the supplied nested
 * `resultFieldValues.create[]` doesn't cover it.
 *
 * Each test creates its own template + required result field so we never
 * pollute the seeded "Default Template" that other suites depend on.
 */
test.describe("Sessions — required result-field enforcement", () => {
  test("raw API rejects sessionResults.create when a required field is missing", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();

    let projectId: number | undefined;
    let templateId: number | undefined;
    let requiredFieldId: number | undefined;
    let sessionId: number | undefined;
    let statusId: number | undefined;

    await test.step("Create project, template with a required result field, and session", async () => {
      projectId = await api.createProject(`E2E Session Required RF ${ts}`);

      // Fresh template scoped to this project + a required Text-String result
      // field assigned to it. Using a fresh template avoids racing with other
      // tests that rely on the seeded "Default Template".
      templateId = await api.createTemplate({
        name: `Required RF Template ${ts}`,
        projectIds: [projectId],
      });
      requiredFieldId = await api.createResultField({
        displayName: `Build ${ts}`,
        systemName: `e2e_required_build_${ts}`,
        typeName: "Text String",
        isRequired: true,
      });
      await api.assignResultFieldToTemplate(templateId, requiredFieldId);

      sessionId = await api.createSession(
        projectId,
        `Session Required RF ${ts}`,
        { templateId }
      );
    });

    await test.step("Look up an enabled status for the project", async () => {
      // Find a status enabled for the project.
      const statusResp = await request.get(
        `${baseURL}/api/model/status/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                isDeleted: false,
                isEnabled: true,
                projects: { some: { projectId } },
              },
            }),
          },
        }
      );
      expect(statusResp.ok()).toBe(true);
      statusId = (await statusResp.json()).data.id;
    });

    await test.step("Submit a session result without the required field and expect rejection", async () => {
      // Raw POST with NO resultFieldValues — the guard must reject. The handler
      // auto-injects `createdBy` for sessionResults (AUTO_INJECT_USER_FIELDS),
      // so the failure isolates the required-field scenario.
      const rejected = await request.post(
        `${baseURL}/api/model/sessionResults/create`,
        {
          data: {
            data: {
              session: { connect: { id: sessionId } },
              status: { connect: { id: statusId } },
              resultData: { type: "doc", content: [{ type: "paragraph" }] },
            },
          },
        }
      );
      expect(rejected.status()).toBe(400);
      const rejectedBody = await rejected.json();
      expect(rejectedBody.error?.code).toBe("REQUIRED_FIELDS_MISSING");
    });
  });

  test("raw API accepts sessionResults.create when nested field values cover all required fields", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();

    let projectId: number | undefined;
    let templateId: number | undefined;
    let requiredFieldId: number | undefined;
    let sessionId: number | undefined;
    let statusId: number | undefined;

    await test.step("Create project, template with a required result field, and session", async () => {
      projectId = await api.createProject(`E2E Session Required RF OK ${ts}`);

      templateId = await api.createTemplate({
        name: `Required RF Template OK ${ts}`,
        projectIds: [projectId],
      });
      requiredFieldId = await api.createResultField({
        displayName: `Build ${ts}`,
        systemName: `e2e_required_build_ok_${ts}`,
        typeName: "Text String",
        isRequired: true,
      });
      await api.assignResultFieldToTemplate(templateId, requiredFieldId);

      sessionId = await api.createSession(
        projectId,
        `Session Required RF OK ${ts}`,
        { templateId }
      );
    });

    await test.step("Look up an enabled status for the project", async () => {
      const statusResp = await request.get(
        `${baseURL}/api/model/status/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                isDeleted: false,
                isEnabled: true,
                projects: { some: { projectId } },
              },
            }),
          },
        }
      );
      expect(statusResp.ok()).toBe(true);
      statusId = (await statusResp.json()).data.id;
    });

    await test.step("Submit a session result with the required field nested and expect success", async () => {
      // Atomic create with the required field nested in the same payload —
      // the same shape SessionResultForm now sends. `createdBy` is filled in
      // server-side via AUTO_INJECT_USER_FIELDS off the authenticated user.
      const ok = await request.post(
        `${baseURL}/api/model/sessionResults/create`,
        {
          data: {
            data: {
              session: { connect: { id: sessionId } },
              status: { connect: { id: statusId } },
              resultData: { type: "doc", content: [{ type: "paragraph" }] },
              resultFieldValues: {
                create: [{ fieldId: requiredFieldId, value: "1.2.3" }],
              },
            },
          },
        }
      );
      expect(ok.status()).toBe(201);
      const body = await ok.json();
      expect(body.data?.id).toBeGreaterThan(0);
    });
  });

  test("raw API accepts sessionResults.create when the template has no required fields", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();

    let projectId: number | undefined;
    let sessionId: number | undefined;
    let statusId: number | undefined;

    await test.step("Create project and session with no required fields", async () => {
      projectId = await api.createProject(`E2E Session No Required RF ${ts}`);

      // No required fields — the guard should be a no-op even though the
      // payload omits `resultFieldValues` entirely.
      sessionId = await api.createSession(
        projectId,
        `Session No Required RF ${ts}`
      );
    });

    await test.step("Look up an enabled status for the project", async () => {
      const statusResp = await request.get(
        `${baseURL}/api/model/status/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                isDeleted: false,
                isEnabled: true,
                projects: { some: { projectId } },
              },
            }),
          },
        }
      );
      expect(statusResp.ok()).toBe(true);
      statusId = (await statusResp.json()).data.id;
    });

    await test.step("Submit a session result without result field values and expect success", async () => {
      const ok = await request.post(
        `${baseURL}/api/model/sessionResults/create`,
        {
          data: {
            data: {
              session: { connect: { id: sessionId } },
              status: { connect: { id: statusId } },
              resultData: { type: "doc", content: [{ type: "paragraph" }] },
            },
          },
        }
      );
      expect(ok.status()).toBe(201);
      const body = await ok.json();
      expect(body.data?.id).toBeGreaterThan(0);
    });
  });
});
