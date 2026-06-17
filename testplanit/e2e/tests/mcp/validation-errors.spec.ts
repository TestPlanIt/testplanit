import { expect, test, type APIRequestContext } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 6 E2E — CASE-12 validation error surfaces.
 *
 * Two test groups proving that the host enforces expected validation at
 * the REST API layer:
 *
 * Group 1: Case create with missing required relation (`template` omitted).
 *   The host's ZenStack policy engine returns an error when a non-nullable
 *   FK is absent. Expected: non-2xx response (422 or 400) with an error body.
 *
 * Group 2: Folder delete enforcement.
 *   NOTE: After research, the host REST API does NOT enforce the "no cases,
 *   no sub-folders" delete rule at the ZenStack PATCH layer — it allows
 *   setting isDeleted:true on a non-empty folder. The enforcement lives in the
 *   MCP tool layer (testplanit_folders_delete checks case/child counts before
 *   issuing the PATCH). This test confirms the actual host behavior, which
 *   is the contract the MCP tool relies on: a soft-delete PATCH always
 *   succeeds at the REST layer (tool pre-checks the empty constraint).
 *
 * T-06-06: All delete operations use PATCH update + isDeleted:true.
 *          NEVER uses DELETE /api/model/repositoryFolders/delete.
 */

interface ValidationSeedContext {
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

test.describe("CASE-12 — validation error surfaces at the REST API layer", () => {
  let ctx: ValidationSeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase6-Validation-${Date.now()}` },
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

  test.describe("Group 1 — case create with missing required relation (CASE-12 missing template)", () => {
    test("CASE-12 — POST create without template: connect returns non-2xx (host FK enforcement)", async ({
      request,
      baseURL,
    }) => {
      let r: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Attempt to create a case with the required template relation omitted", async () => {
        // Omit `template: { connect: { id } }` — a required non-nullable FK.
        // The host should reject this with an error response (422 or 400).
        r = await request.post(
          `${baseURL}/api/model/repositoryCases/create`,
          {
            headers: ctx.headers,
            data: {
              data: {
                name: `CASE12-Missing-Template-${Date.now()}`,
                source: "MANUAL",
                automated: false,
                project: { connect: { id: ctx.projectId } },
                repository: { connect: { id: ctx.repositoryId } },
                folder: { connect: { id: ctx.folderId } },
                // template intentionally omitted — CASE-12 trigger
                state: { connect: { id: ctx.stateId } },
              },
            },
          }
        );
      });

      await test.step("Verify the host rejects with a non-2xx status and an error body", async () => {
        // Host must reject: templateId is non-nullable in schema
        expect(r!.status()).toBeGreaterThanOrEqual(400);
        const body = await r!.json();
        // Response must have an error field (ZenStack error envelope or Next.js error)
        const hasError =
          body.error != null ||
          body.message != null ||
          body.errors != null ||
          body.code != null;
        expect(
          hasError,
          `Expected error body, got: ${JSON.stringify(body)}`
        ).toBe(true);
      });
    });
  });

  test.describe("Group 2 — folder soft-delete enforcement (CASE-10 / CASE-12 MCP layer)", () => {
    let testFolderId: number;
    let testCaseId: number;

    test("setup — create a test folder for the enforcement check", async ({
      request,
      baseURL,
    }) => {
      const r = await request.post(
        `${baseURL}/api/model/repositoryFolders/create`,
        {
          headers: ctx.headers,
          data: {
            data: {
              name: `CASE12-Folder-${Date.now()}`,
              project: { connect: { id: ctx.projectId } },
              repository: { connect: { id: ctx.repositoryId } },
            },
          },
        }
      );
      expect(r.status()).toBeLessThan(300);
      const body = await r.json();
      testFolderId = (body.data ?? body).id;
    });

    test("setup — create a case inside the folder", async ({
      request,
      baseURL,
    }) => {
      const r = await request.post(
        `${baseURL}/api/model/repositoryCases/create`,
        {
          headers: ctx.headers,
          data: {
            data: {
              name: `CASE12-InFolder-${Date.now()}`,
              source: "MANUAL",
              automated: false,
              project: { connect: { id: ctx.projectId } },
              repository: { connect: { id: ctx.repositoryId } },
              folder: { connect: { id: testFolderId } },
              template: { connect: { id: ctx.templateId } },
              state: { connect: { id: ctx.stateId } },
            },
          },
        }
      );
      expect(r.status()).toBeLessThan(300);
      const body = await r.json();
      testCaseId = (body.data ?? body).id;
    });

    test("CASE-12 / CASE-10 — host REST API allows soft-delete of non-empty folder (enforcement is in MCP tool layer, not REST layer)", async ({
      request,
      baseURL,
    }) => {
      let r: Awaited<ReturnType<typeof request.patch>> | undefined;
      await test.step("Soft-delete the non-empty folder via a PATCH update", async () => {
        // The MCP tool testplanit_folders_delete checks case/child counts BEFORE
        // issuing this PATCH and surfaces a CASE-12 structured error if non-empty.
        // At the raw REST layer, the host allows soft-delete regardless of folder contents.
        // This test documents the host contract the MCP tool relies on.
        r = await request.patch(
          `${baseURL}/api/model/repositoryFolders/update`,
          {
            headers: ctx.headers,
            data: { where: { id: testFolderId }, data: { isDeleted: true } },
          }
        );
      });

      await test.step("Verify the host accepts the soft-delete and marks the folder deleted", async () => {
        // Host accepts the soft-delete: the non-empty rule is an MCP tool concern
        expect(r!.status()).toBeLessThan(300);
        const body = await r!.json();
        expect((body.data ?? body).isDeleted).toBe(true);
      });
    });

    test("cleanup — soft-delete the case that was inside the folder", async ({
      request,
      baseURL,
    }) => {
      const r = await request.patch(
        `${baseURL}/api/model/repositoryCases/update`,
        {
          headers: ctx.headers,
          data: { where: { id: testCaseId }, data: { isDeleted: true } },
        }
      );
      expect(r.status()).toBeLessThan(300);
    });
  });
});
