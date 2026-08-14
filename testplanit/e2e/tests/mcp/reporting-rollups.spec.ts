import { expect, test, type APIRequestContext } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * MCP reporting rollups — host acceptance for the request shapes behind
 * testplanit_cases_count, cases_list includeDescendants/includeFolderPath,
 * folders_list includeRecursiveCounts, and the nulls-last JUnit ordering.
 *
 * Exercises the same REST endpoints the MCP tools call internally
 * (`zenstack` helper from packages/mcp-server/src/api.ts). The unit suite
 * proves the tools GENERATE these shapes; this spec proves a production
 * host ACCEPTS them — specifically the shapes with no prior precedent in
 * the package: repositoryCases groupBy (single and two-field `by`),
 * repositoryCases count, relation-filtered repositoryCaseTag groupBy,
 * select-form `_count` on repositoryFolders, and the object-form
 * `{ sort, nulls }` orderBy inside an include.
 *
 * Test mode: serial — tests share the folder/case fixture created in
 * beforeAll and clean it up in afterAll (soft-delete only, T-06-06).
 */

interface SeedContext {
  projectId: number;
  repositoryId: number;
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

async function readQuery<T>(
  request: APIRequestContext,
  baseURL: string,
  headers: Record<string, string>,
  model: string,
  operation: string,
  body: Record<string, unknown>
): Promise<T> {
  const q = encodeURIComponent(JSON.stringify(body));
  const r = await request.get(
    `${baseURL}/api/model/${model}/${operation}?q=${q}`,
    { headers }
  );
  expect(
    r.status(),
    `${operation} ${model} body=${await r.text().catch(() => "")}`
  ).toBe(200);
  return (await r.json()).data as T;
}

test.describe("MCP reporting rollups host acceptance", () => {
  let ctx: SeedContext;
  const stamp = Date.now();
  let rootFolderId: number;
  let childFolderId: number;
  const caseIds: number[] = [];

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `MCP-Rollups-${stamp}` },
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
      templateId: template.id,
      stateId: state.id,
      token,
      headers,
    };

    // Fixture: Rollup-Root > Rollup-Child, with 2 automated cases in the
    // child and 1 manual case in the root — deterministic subtree numbers.
    const createFolder = async (name: string, parentId?: number) => {
      const res = await request.post(
        `${baseURL}/api/model/repositoryFolders/create`,
        {
          headers,
          data: {
            data: {
              name,
              project: { connect: { id: ctx.projectId } },
              repository: { connect: { id: ctx.repositoryId } },
              ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
            },
          },
        }
      );
      expect(res.status(), `create folder ${name}`).toBeLessThan(300);
      const body = await res.json();
      return (body.data ?? body).id as number;
    };
    rootFolderId = await createFolder(`Rollup-Root-${stamp}`);
    childFolderId = await createFolder(`Rollup-Child-${stamp}`, rootFolderId);

    const createCase = async (
      name: string,
      folderId: number,
      automated: boolean
    ) => {
      const res = await request.post(
        `${baseURL}/api/model/repositoryCases/create`,
        {
          headers,
          data: {
            data: {
              name,
              source: "MANUAL",
              automated,
              project: { connect: { id: ctx.projectId } },
              repository: { connect: { id: ctx.repositoryId } },
              folder: { connect: { id: folderId } },
              template: { connect: { id: ctx.templateId } },
              state: { connect: { id: ctx.stateId } },
            },
          },
        }
      );
      expect(res.status(), `create case ${name}`).toBeLessThan(300);
      const body = await res.json();
      caseIds.push((body.data ?? body).id as number);
    };
    await createCase(`Rollup-Auto-A-${stamp}`, childFolderId, true);
    await createCase(`Rollup-Auto-B-${stamp}`, childFolderId, true);
    await createCase(`Rollup-Manual-${stamp}`, rootFolderId, false);
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Soft-delete only (T-06-06) — cases first, then folders leaf-up.
    for (const id of caseIds) {
      await request.patch(`${baseURL}/api/model/repositoryCases/update`, {
        headers: ctx.headers,
        data: { where: { id }, data: { isDeleted: true } },
      });
    }
    for (const id of [childFolderId, rootFolderId]) {
      await request.patch(`${baseURL}/api/model/repositoryFolders/update`, {
        headers: ctx.headers,
        data: { where: { id }, data: { isDeleted: true } },
      });
    }
  });

  test("repositoryCases groupBy folderId (cases_count / fetchAutomatedCaseCounts shape)", async ({
    request,
    baseURL,
  }) => {
    const groups = await readQuery<
      Array<{ folderId: number; _count: { id: number } }>
    >(request, baseURL!, ctx.headers, "repositoryCases", "groupBy", {
      by: ["folderId"],
      where: { projectId: ctx.projectId, isDeleted: false, automated: true },
      _count: { id: true },
    });

    const child = groups.find((g) => g.folderId === childFolderId);
    expect(child, "automated groupBy misses the fixture folder").toBeTruthy();
    expect(child!._count.id).toBe(2);
    expect(groups.find((g) => g.folderId === rootFolderId)).toBeUndefined();
  });

  test("repositoryCases two-field groupBy [stateId, folderId] (subtree-scoped dimension counts)", async ({
    request,
    baseURL,
  }) => {
    const groups = await readQuery<
      Array<{ stateId: number; folderId: number; _count: { id: number } }>
    >(request, baseURL!, ctx.headers, "repositoryCases", "groupBy", {
      by: ["stateId", "folderId"],
      where: { projectId: ctx.projectId, isDeleted: false },
      _count: { id: true },
    });

    const child = groups.find(
      (g) => g.folderId === childFolderId && g.stateId === ctx.stateId
    );
    expect(child, "two-field groupBy misses the fixture rows").toBeTruthy();
    expect(child!._count.id).toBe(2);
  });

  test("repositoryCases count with folderId in-clause (cases_list includeDescendants scope)", async ({
    request,
    baseURL,
  }) => {
    const total = await readQuery<number>(
      request,
      baseURL!,
      ctx.headers,
      "repositoryCases",
      "count",
      {
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          folderId: { in: [rootFolderId, childFolderId] },
        },
      }
    );
    expect(total).toBe(3);
  });

  test("repositoryCaseTag groupBy through the case relation (cases_count groupBy: 'tag' shape)", async ({
    request,
    baseURL,
  }) => {
    // Shape acceptance: an invalid where/by would 4xx — the fixture carries
    // no tags, so content-wise we only require a well-formed group array.
    const groups = await readQuery<Array<{ tagId: number }>>(
      request,
      baseURL!,
      ctx.headers,
      "repositoryCaseTag",
      "groupBy",
      {
        by: ["tagId"],
        where: {
          case: { projectId: ctx.projectId, isDeleted: false },
        },
        _count: { caseId: true },
      }
    );
    expect(Array.isArray(groups)).toBe(true);
  });

  test("repositoryFolders flat fetch with select-form filtered _count (folders/tree.ts shape)", async ({
    request,
    baseURL,
  }) => {
    const rows = await readQuery<
      Array<{
        id: number;
        name: string;
        parentId: number | null;
        order: number;
        _count?: { cases?: number };
      }>
    >(request, baseURL!, ctx.headers, "repositoryFolders", "findMany", {
      where: { projectId: ctx.projectId, isDeleted: false },
      select: {
        id: true,
        name: true,
        parentId: true,
        order: true,
        _count: { select: { cases: { where: { isDeleted: false } } } },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });

    const root = rows.find((f) => f.id === rootFolderId);
    const child = rows.find((f) => f.id === childFolderId);
    expect(root?._count?.cases).toBe(1);
    expect(child?._count?.cases).toBe(2);
    expect(child?.parentId).toBe(rootFolderId);
  });

  test("case rows with nulls-last junitResults ordering (CASE_ROW_INCLUDE shape)", async ({
    request,
    baseURL,
  }) => {
    const rows = await readQuery<
      Array<{ id: number; junitResults: unknown[] }>
    >(request, baseURL!, ctx.headers, "repositoryCases", "findMany", {
      where: {
        projectId: ctx.projectId,
        isDeleted: false,
        folderId: childFolderId,
      },
      include: {
        junitResults: {
          orderBy: [
            { executedAt: { sort: "desc", nulls: "last" } },
            { id: "desc" },
          ],
          take: 1,
          select: {
            id: true,
            executedAt: true,
            status: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 5,
    });

    expect(rows.length).toBe(2);
    expect(Array.isArray(rows[0]!.junitResults)).toBe(true);
  });

  test("automation-reality filters: junitResults some/none where shapes (§4.6)", async ({
    request,
    baseURL,
  }) => {
    // The fixture cases have no JUnit results: hasAutomatedResults:false
    // (none: {}) must return them, the gte-bounded some must not.
    const withoutEvidence = await readQuery<number>(
      request,
      baseURL!,
      ctx.headers,
      "repositoryCases",
      "count",
      {
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          folderId: childFolderId,
          AND: [{ junitResults: { none: {} } }],
        },
      }
    );
    expect(withoutEvidence).toBe(2);

    const ranRecently = await readQuery<number>(
      request,
      baseURL!,
      ctx.headers,
      "repositoryCases",
      "count",
      {
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          folderId: childFolderId,
          AND: [
            {
              junitResults: {
                some: { executedAt: { gte: new Date(0).toISOString() } },
              },
            },
          ],
        },
      }
    );
    expect(ranRecently).toBe(0);
  });
});
