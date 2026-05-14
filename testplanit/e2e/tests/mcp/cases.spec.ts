import { expect, test, type APIRequestContext } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 6 E2E — Case CRUD lifecycle (CASE-01, CASE-02, CASE-03, CASE-04, CASE-05).
 *
 * Exercises the same REST endpoints that the MCP tools call internally
 * (`zenstack` helper from packages/mcp-server/src/api.ts). Running these
 * tests against a production build proves the host accepts the request
 * shapes the MCP tools generate.
 *
 * Test mode: serial — tests share resolved seed-context state (projectId,
 * folderId, etc.) and depend on each other.
 */

interface SeedContext {
  projectId: number;
  repositoryId: number;
  folderId: number;
  templateId: number;
  stateId: number;
  token: string;
  headers: Record<string, string>;
}

async function findFirst(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  model: string,
  where: Record<string, unknown>,
  select?: Record<string, unknown>
): Promise<{ id: number }> {
  const q = encodeURIComponent(
    JSON.stringify({ where, ...(select ? { select } : {}) })
  );
  const r = await request.get(
    `${baseURL}/api/model/${model}/findFirst?q=${q}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  expect(r.status(), `findFirst ${model}`).toBe(200);
  const body = await r.json();
  const item = body.data;
  expect(item, `findFirst ${model} returned no row`).not.toBeNull();
  return item;
}

test.describe("MCP test-case CRUD lifecycle (Phase 6)", () => {
  let ctx: SeedContext;
  let createdCaseId: number;

  test.beforeAll(async ({ request, baseURL }) => {
    // Mint a full-access token (empty scopes — TOK-06 default).
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase6-Cases-${Date.now()}` },
    });
    expect(r.status()).toBe(200);
    const token = (await r.json()).token as string;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const project = await findFirst(request, baseURL!, token, "projects", {
      isDeleted: false,
    });
    const repository = await findFirst(
      request,
      baseURL!,
      token,
      "repositories",
      {
        projectId: project.id,
        isActive: true,
        isDeleted: false,
        isArchived: false,
      }
    );
    const folder = await findFirst(
      request,
      baseURL!,
      token,
      "repositoryFolders",
      {
        projectId: project.id,
        isDeleted: false,
      }
    );
    const template = await findFirst(request, baseURL!, token, "templates", {
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: project.id } },
    });
    const state = await findFirst(request, baseURL!, token, "workflows", {
      isEnabled: true,
      isDeleted: false,
      scope: "CASES",
      projects: { some: { projectId: project.id } },
    });

    ctx = {
      projectId: project.id,
      repositoryId: repository.id,
      folderId: folder.id,
      templateId: template.id,
      stateId: state.id,
      token,
      headers,
    };
  });

  test("CASE-03 — create a test case via REST (mirrors testplanit_cases_create)", async ({
    request,
    baseURL,
  }) => {
    const name = `MCP-E2E-${Date.now()}`;
    const r = await request.post(
      `${baseURL}/api/model/repositoryCases/create`,
      {
        headers: ctx.headers,
        data: {
          data: {
            name,
            source: "MANUAL",
            automated: false,
            project: { connect: { id: ctx.projectId } },
            repository: { connect: { id: ctx.repositoryId } },
            folder: { connect: { id: ctx.folderId } },
            template: { connect: { id: ctx.templateId } },
            state: { connect: { id: ctx.stateId } },
          },
        },
      }
    );
    expect(
      r.status(),
      `create body=${await r.text().catch(() => "")}`
    ).toBeLessThan(300);
    const body = await r.json();
    const created = body.data ?? body;
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe(name);
    expect(created.isDeleted).toBe(false);
    createdCaseId = created.id;
  });

  test("CASE-01 — list includes the new case (mirrors testplanit_cases_list)", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          id: createdCaseId,
        },
        take: 1,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(createdCaseId);
  });

  test("CASE-02 — fetch full detail via findUnique (mirrors testplanit_cases_get)", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: { id: createdCaseId },
        include: {
          project: { select: { id: true, name: true } },
          folder: { select: { id: true, name: true, parentId: true } },
          state: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryCases/findUnique?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).not.toBeNull();
    expect(body.data.project.id).toBe(ctx.projectId);
    expect(body.data.folder.id).toBe(ctx.folderId);
    expect(body.data.state.id).toBe(ctx.stateId);
    expect(body.data.creator.email).toBeTruthy();
  });

  test("CASE-04 — update name via PATCH (mirrors testplanit_cases_update)", async ({
    request,
    baseURL,
  }) => {
    const newName = `Renamed-${Date.now()}`;
    const r = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        headers: ctx.headers,
        data: { where: { id: createdCaseId }, data: { name: newName } },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).name).toBe(newName);
  });

  test("CASE-05 — soft-delete via PATCH update isDeleted=true (mirrors testplanit_cases_delete)", async ({
    request,
    baseURL,
  }) => {
    const r = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        headers: ctx.headers,
        data: { where: { id: createdCaseId }, data: { isDeleted: true } },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).isDeleted).toBe(true);
  });

  test("CASE-05 — soft-deleted case is hidden from subsequent list", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          id: createdCaseId,
        },
        take: 1,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).toHaveLength(0);
  });

  // -- Phase 8 REPO-02 maintenance smoke -------------------------------------
  // Proves the new `automated: true` filter dimension survives a production-
  // build round-trip. The MCP tool layer adds 7 maintenance filters on top of
  // the existing cases_list shape; the `automated` boolean is the simplest one
  // to assert on the wire and pins the contract at the host gateway.
  test("Phase 8 REPO-02 maintenance filter — automated: true narrows correctly", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: { projectId: ctx.projectId, isDeleted: false, automated: true },
        orderBy: [{ id: "asc" }],
        take: 5,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "Phase 8 REPO-02 maintenance smoke: project has 0 automated:true cases — filter shape verified, row-shape assertion skipped"
      );
      return;
    }
    for (const row of body.data) {
      expect(row.automated).toBe(true);
      expect(row.projectId).toBe(ctx.projectId);
      expect(row.isDeleted).toBe(false);
    }
  });
});
