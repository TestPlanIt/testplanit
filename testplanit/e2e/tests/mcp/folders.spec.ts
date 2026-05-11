import { expect, test, type APIRequestContext } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 6 E2E — Folder CRUD lifecycle (CASE-06, CASE-08, CASE-09, CASE-10).
 *
 * Exercises the same REST endpoints that the MCP folder tools call internally
 * (`zenstack` helper from packages/mcp-server/src/api.ts). Running these
 * tests against a production build proves the host accepts the request
 * shapes the MCP tools generate.
 *
 * Test mode: serial — tests share resolved seed-context state and depend on
 * each other: create root → create child → get tree → rename → reparent →
 * soft-delete child → soft-delete root.
 *
 * T-06-06: All deletes use PATCH update with isDeleted:true.
 *          NEVER uses DELETE /api/model/repositoryFolders/delete.
 */

interface FolderSeedContext {
  projectId: number;
  repositoryId: number;
  token: string;
  headers: Record<string, string>;
}

async function findFirst(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  model: string,
  where: Record<string, unknown>
): Promise<{ id: number }> {
  const q = encodeURIComponent(JSON.stringify({ where }));
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

test.describe("MCP folder CRUD lifecycle (Phase 6)", () => {
  let ctx: FolderSeedContext;
  let rootFolderId: number;
  let childFolderId: number;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase6-Folders-${Date.now()}` },
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

    ctx = {
      projectId: project.id,
      repositoryId: repository.id,
      token,
      headers,
    };
  });

  test("CASE-08 — create root folder (parentId null) via REST (mirrors testplanit_folders_create)", async ({
    request,
    baseURL,
  }) => {
    const name = `MCP-Root-${Date.now()}`;
    const r = await request.post(
      `${baseURL}/api/model/repositoryFolders/create`,
      {
        headers: ctx.headers,
        data: {
          data: {
            name,
            project: { connect: { id: ctx.projectId } },
            repository: { connect: { id: ctx.repositoryId } },
          },
        },
      }
    );
    expect(r.status(), `create root folder status`).toBeLessThan(300);
    const body = await r.json();
    const created = body.data ?? body;
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe(name);
    expect(created.parentId).toBeNull();
    expect(created.isDeleted).toBe(false);
    rootFolderId = created.id;
  });

  test("CASE-08 — create child folder under root via REST (mirrors testplanit_folders_create with parentId)", async ({
    request,
    baseURL,
  }) => {
    const name = `MCP-Child-${Date.now()}`;
    const r = await request.post(
      `${baseURL}/api/model/repositoryFolders/create`,
      {
        headers: ctx.headers,
        data: {
          data: {
            name,
            project: { connect: { id: ctx.projectId } },
            repository: { connect: { id: ctx.repositoryId } },
            parent: { connect: { id: rootFolderId } },
          },
        },
      }
    );
    expect(r.status(), `create child folder status`).toBeLessThan(300);
    const body = await r.json();
    const created = body.data ?? body;
    expect(created.id).toBeGreaterThan(0);
    expect(created.parentId).toBe(rootFolderId);
    expect(created.isDeleted).toBe(false);
    childFolderId = created.id;
  });

  test("CASE-06 — GET folder tree with case counts (mirrors testplanit_folders_list)", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          id: rootFolderId,
        },
        include: {
          _count: { select: { cases: { where: { isDeleted: false } } } },
          children: {
            where: { isDeleted: false },
          },
        },
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryFolders/findMany?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data.length).toBeGreaterThan(0);
    const root = body.data.find((f: { id: number }) => f.id === rootFolderId);
    expect(root).toBeDefined();
    expect(root._count).toBeDefined();
    expect(
      root.children.some((c: { id: number }) => c.id === childFolderId)
    ).toBe(true);
  });

  test("CASE-09 — rename root folder via PATCH (mirrors testplanit_folders_update)", async ({
    request,
    baseURL,
  }) => {
    const newName = `MCP-Root-Renamed-${Date.now()}`;
    const r = await request.patch(
      `${baseURL}/api/model/repositoryFolders/update`,
      {
        headers: ctx.headers,
        data: { where: { id: rootFolderId }, data: { name: newName } },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).name).toBe(newName);
  });

  test("CASE-09 — reparent child to root (disconnect) via PATCH (mirrors testplanit_folders_update with parentId:null)", async ({
    request,
    baseURL,
  }) => {
    const r = await request.patch(
      `${baseURL}/api/model/repositoryFolders/update`,
      {
        headers: ctx.headers,
        data: {
          where: { id: childFolderId },
          data: { parent: { disconnect: true } },
        },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).parentId).toBeNull();
  });

  test("CASE-10 — soft-delete the child folder (now root-level and empty) via PATCH isDeleted=true (mirrors testplanit_folders_delete)", async ({
    request,
    baseURL,
  }) => {
    const r = await request.patch(
      `${baseURL}/api/model/repositoryFolders/update`,
      {
        headers: ctx.headers,
        data: { where: { id: childFolderId }, data: { isDeleted: true } },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).isDeleted).toBe(true);
  });

  test("CASE-10 — soft-deleted child folder is hidden from subsequent list", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          id: childFolderId,
        },
        take: 1,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryFolders/findMany?q=${q}`,
      { headers: ctx.headers }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).toHaveLength(0);
  });

  test("CASE-10 — soft-delete the root folder (empty after child was removed) via PATCH isDeleted=true (mirrors testplanit_folders_delete)", async ({
    request,
    baseURL,
  }) => {
    const r = await request.patch(
      `${baseURL}/api/model/repositoryFolders/update`,
      {
        headers: ctx.headers,
        data: { where: { id: rootFolderId }, data: { isDeleted: true } },
      }
    );
    expect(r.status()).toBeLessThan(300);
    const body = await r.json();
    expect((body.data ?? body).isDeleted).toBe(true);
  });
});
