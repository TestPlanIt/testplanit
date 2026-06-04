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
    const projectId = await api.createProject(`E2E Session Required RF ${ts}`);

    // Fresh template scoped to this project + a required Text-String result
    // field assigned to it. Using a fresh template avoids racing with other
    // tests that rely on the seeded "Default Template".
    const templateId = await api.createTemplate({
      name: `Required RF Template ${ts}`,
      projectIds: [projectId],
    });
    const requiredFieldId = await api.createResultField({
      displayName: `Build ${ts}`,
      systemName: `e2e_required_build_${ts}`,
      typeName: "Text String",
      isRequired: true,
    });
    await api.assignResultFieldToTemplate(templateId, requiredFieldId);

    const sessionId = await api.createSession(
      projectId,
      `Session Required RF ${ts}`,
      { templateId }
    );

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
    const statusId = (await statusResp.json()).data.id;

    // Raw POST with NO resultFieldValues — the guard must reject. Note that
    // `createdById` is set so the rejection isolates the required-field
    // scenario (rather than racing the missing-FK validation).
    const userId = await api.getCurrentUserId();
    const rejected = await request.post(
      `${baseURL}/api/model/sessionResults/create`,
      {
        data: {
          data: {
            sessionId,
            statusId,
            createdById: userId,
            resultData: { type: "doc", content: [{ type: "paragraph" }] },
          },
        },
      }
    );
    expect(rejected.status()).toBe(400);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error?.code).toBe("REQUIRED_FIELDS_MISSING");
  });

  test("raw API accepts sessionResults.create when nested field values cover all required fields", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(
      `E2E Session Required RF OK ${ts}`
    );

    const templateId = await api.createTemplate({
      name: `Required RF Template OK ${ts}`,
      projectIds: [projectId],
    });
    const requiredFieldId = await api.createResultField({
      displayName: `Build ${ts}`,
      systemName: `e2e_required_build_ok_${ts}`,
      typeName: "Text String",
      isRequired: true,
    });
    await api.assignResultFieldToTemplate(templateId, requiredFieldId);

    const sessionId = await api.createSession(
      projectId,
      `Session Required RF OK ${ts}`,
      { templateId }
    );

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
    const statusId = (await statusResp.json()).data.id;

    // Atomic create with the required field nested in the same payload —
    // the same shape SessionResultForm now sends. `createdById` is required
    // explicitly here because `sessionResults` isn't in the route's
    // AUTO_INJECT_USER_FIELDS map (route.ts:80) the way sessions / testRuns
    // are; the UI sets it directly off `session.user.id`.
    const userId = await api.getCurrentUserId();
    const ok = await request.post(
      `${baseURL}/api/model/sessionResults/create`,
      {
        data: {
          data: {
            sessionId,
            statusId,
            createdById: userId,
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

  test("raw API accepts sessionResults.create when the template has no required fields", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(
      `E2E Session No Required RF ${ts}`
    );

    // No required fields — the guard should be a no-op even though the
    // payload omits `resultFieldValues` entirely.
    const sessionId = await api.createSession(
      projectId,
      `Session No Required RF ${ts}`
    );

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
    const statusId = (await statusResp.json()).data.id;

    const userId = await api.getCurrentUserId();
    const ok = await request.post(
      `${baseURL}/api/model/sessionResults/create`,
      {
        data: {
          data: {
            sessionId,
            statusId,
            createdById: userId,
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
