import { expect, test } from "../../fixtures";

/**
 * Small API surfaces with no spec of their own: health, the API docs feed,
 * the CLI lookup, record-key resolution, the tag aggregate readers, and the
 * synchronous forecast refresh.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Miscellaneous API endpoints", () => {
  test("GET /api/health reports each dependency", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(`${baseURL}/api/health`);
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(["healthy", "degraded", "unhealthy"]).toContain(body.status);
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks).toHaveProperty("redis");
    expect(body.checks).toHaveProperty("elasticsearch");
  });

  test("GET /api/docs lists categories and serves a category spec", async ({
    request,
    baseURL,
  }) => {
    const list = await request.get(`${baseURL}/api/docs`, {
      params: { list: "true" },
    });
    expect(list.status()).toBe(200);
    const categories = (await list.json()).categories;
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);

    const spec = await request.get(`${baseURL}/api/docs`, {
      params: { category: "custom" },
    });
    expect(spec.status()).toBe(200);
    expect((await spec.json()).openapi).toBeTruthy();

    const bad = await request.get(`${baseURL}/api/docs`, {
      params: { category: "nope" },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).availableCategories).toBeTruthy();
  });

  test("POST /api/cli/lookup resolves records by name and can create tags", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectName = `E2E CLI ${ts}`;
    const projectId = await api.createProject(projectName);

    const found = await request.post(`${baseURL}/api/cli/lookup`, {
      data: { type: "project", name: projectName },
    });
    expect(found.status()).toBe(200);
    expect((await found.json()).id).toBe(projectId);

    const missing = await request.post(`${baseURL}/api/cli/lookup`, {
      data: { type: "project", name: `nonexistent ${ts}` },
    });
    expect(missing.status()).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");

    const tagName = `cli-tag-${ts}`;
    const created = await request.post(`${baseURL}/api/cli/lookup`, {
      data: { type: "tag", name: tagName, createIfMissing: true },
    });
    expect(created.status()).toBe(200);
    const tag = await created.json();
    expect(tag.created).toBe(true);
    api.untrackTag(tag.id);
    await request
      .patch(`${baseURL}/api/model/tags/update`, {
        data: { where: { id: tag.id }, data: { isDeleted: true } },
      })
      .catch(() => {});
  });

  test("GET /api/record-key/resolve resolves a case by its key", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Record Key ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Keyed case ${ts}`
    );

    const missing = await request.get(`${baseURL}/api/record-key/resolve`);
    expect(missing.status()).toBe(400);

    const res = await request.get(`${baseURL}/api/record-key/resolve`, {
      params: { key: `TC-${caseId}` },
    });
    expect(res.status()).toBe(200);
    const hits = await res.json();
    const list = Array.isArray(hits) ? hits : (hits.results ?? hits.hits ?? []);
    expect(JSON.stringify(list)).toContain(`Keyed case ${ts}`);
  });

  test("tag aggregate readers return zero-filled counts and project usage", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Tag Readers ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Tagged ${ts}`
    );
    const tagId = await api.createTag(`readers-${ts}`);
    await api.addTagToTestCase(caseId, tagId);

    const counts = await request.post(`${baseURL}/api/tags/counts`, {
      data: { tagIds: [tagId] },
    });
    expect(counts.status()).toBe(200);
    expect((await counts.json()).counts[String(tagId)].repositoryCases).toBe(1);

    const empty = await request.post(`${baseURL}/api/tags/counts`, {
      data: { tagIds: [] },
    });
    expect((await empty.json()).counts).toEqual({});

    const forProject = await request.get(`${baseURL}/api/tags/project-list`, {
      params: { projectId: String(projectId) },
    });
    expect(forProject.status()).toBe(200);
    const names = (await forProject.json()).tags.map(
      (t: { name: string }) => t.name
    );
    expect(names).toContain(`readers-${ts}`);
  });

  test("GET /api/forecast/update refreshes a case forecast synchronously", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Forecast ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Forecast ${ts}`
    );

    const bad = await request.get(`${baseURL}/api/forecast/update`, {
      params: { caseId: "abc" },
    });
    expect(bad.status()).toBe(400);

    const res = await request.get(`${baseURL}/api/forecast/update`, {
      params: { caseId: String(caseId) },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
