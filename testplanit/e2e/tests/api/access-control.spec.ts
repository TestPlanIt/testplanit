import { expect, test } from "../../fixtures/index";
import type { BrowserContext } from "@playwright/test";

/**
 * Access Control E2E Tests
 *
 * Verifies that the ZenStack access control policies are correctly enforced
 * through the REST API:
 *
 * - ACL-01: Admin user has full CRUD access to all models
 * - ACL-02: Regular project member can read but not delete projects
 * - ACL-03: User with NO_ACCESS permission sees empty data on reads
 * - ACL-04: Unauthenticated requests are rejected with 422
 * - ACL-05: Role-based area permissions deny writes when canAddEdit is false
 *
 * Critical: ZenStack's 403 responses are remapped to 422 by the route handler
 * at app/api/model/[...path]/route.ts to prevent nginx ingress from replacing
 * the JSON body with an HTML error page. Tests must assert 422, NOT 403.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Access Control - Admin Full Access (ACL-01)", () => {
  let projectId: number;
  let caseId: number;

  test("admin can create a project", async ({ api }) => {
    const name = `ACL Admin Project ${Date.now()}`;
    projectId = await api.createProject(name);
    expect(projectId).toBeGreaterThan(0);
  });

  test("admin can read projects", async ({ request, baseURL }) => {
    const readResponse = await request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: projectId },
          }),
        },
      }
    );

    expect(readResponse.status()).toBe(200);
    const result = await readResponse.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe(projectId);
  });

  test("admin can update a project", async ({ request, baseURL }) => {
    const newName = `ACL Admin Project Updated ${Date.now()}`;

    const updateResponse = await request.patch(
      `${baseURL}/api/model/projects/update`,
      {
        data: {
          where: { id: projectId },
          data: { name: newName },
        },
      }
    );

    expect(updateResponse.status()).toBe(200);

    // Verify the update took effect
    const findResponse = await request.get(
      `${baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: projectId } }),
        },
      }
    );
    expect(findResponse.status()).toBe(200);
    const result = await findResponse.json();
    expect(result.data.name).toBe(newName);
  });

  test("admin can read RepositoryCases in project", async ({
    request,
    baseURL,
    api,
  }) => {
    // Create a case in the project (requires projectId, rootFolderId, name)
    const rootFolderId = await api.getRootFolderId(projectId);
    caseId = await api.createTestCase(projectId, rootFolderId, `ACL Case ${Date.now()}`);
    expect(caseId).toBeGreaterThan(0);

    // Read back via findMany
    const readResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { projectId },
          }),
        },
      }
    );

    expect(readResponse.status()).toBe(200);
    const result = await readResponse.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });

  test("admin can read TestRuns", async ({ request, baseURL }) => {
    // Read TestRuns — data may be empty but must not return 422
    const readResponse = await request.get(
      `${baseURL}/api/model/testRuns/findMany`,
      {
        params: {
          q: JSON.stringify({}),
        },
      }
    );

    expect(readResponse.status()).toBe(200);
    const result = await readResponse.json();
    // Data may be empty array — that's fine, no access denial
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("admin can soft-delete a project", async ({ api, request, baseURL }) => {
    // Soft-delete the project (fire-and-forget — PATCH returns 422 RESULT_NOT_READABLE
    // after setting isDeleted:true because the post-update policy check denies reading
    // the deleted record back, which is expected ZenStack v3 behavior)
    await api.deleteProject(projectId);

    // Give the delete a moment to propagate
    await new Promise((r) => setTimeout(r, 300));

    // Soft-deleted projects are invisible via ZenStack's @@deny('all', isDeleted)
    const findManyResponse = await request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { id: projectId } }),
        },
      }
    );

    expect(findManyResponse.status()).toBe(200);
    const result = await findManyResponse.json();
    expect(result.data).toHaveLength(0);
  });
});

test.describe("Access Control - Unauthenticated Rejection (ACL-04)", () => {
  // NOTE: ZenStack's @@deny('all', !auth()) behavior for read operations:
  // - findMany returns 200 with empty data array (policy silently filters all records)
  // - findFirst returns 200 with null data (same silent filter)
  // - Mutation operations (create/update/delete) return 422 (403 remapped by route handler)
  // This was empirically verified — the research doc flagged this as an open question.

  test("unauthenticated findMany on projects returns empty data", async ({
    browser,
    baseURL,
  }) => {
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const response = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          params: { q: JSON.stringify({}) },
        }
      );
      // ZenStack @@deny silently filters all records for unauthenticated reads
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(0);
    } finally {
      await unauthCtx.close();
    }
  });

  test("unauthenticated findFirst on repositoryCases returns null data", async ({
    browser,
    baseURL,
  }) => {
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const response = await unauthCtx.request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: { q: JSON.stringify({}) },
        }
      );
      // ZenStack @@deny silently filters all records for unauthenticated reads
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.data).toBeNull();
    } finally {
      await unauthCtx.close();
    }
  });

  test("unauthenticated create on projects returns 422", async ({
    browser,
    baseURL,
  }) => {
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const response = await unauthCtx.request.post(
        `${baseURL}/api/model/projects/create`,
        {
          data: {
            data: { name: `Unauth Project ${Date.now()}` },
          },
        }
      );
      // Mutation without auth → ZenStack 403 → remapped to 422 by route handler
      expect(response.status()).toBe(422);
    } finally {
      await unauthCtx.close();
    }
  });
});

test.describe("Access Control - Member Read/No-Delete (ACL-02)", () => {
  let memberCtx: BrowserContext;
  let projectId: number;
  let memberEmail: string;
  let memberUserId: string;

  test.beforeAll(async ({ browser, baseURL, api }) => {
    // Create a regular USER-access member
    memberEmail = `acl-member-${Date.now()}@example.com`;
    const memberResult = await api.createUser({
      name: "ACL Member",
      email: memberEmail,
      password: "password123",
      access: "USER",
    });
    memberUserId = memberResult.data.id;

    // Create a test project via admin (defaults to GLOBAL_ROLE access type)
    projectId = await api.createProject(`ACL-02 Project ${Date.now()}`);

    // Sign in as the member user in a new browser context (no storageState = no session).
    // The extraHTTPHeaders ensure API requests are classified as same-origin browser requests
    // by the proxy middleware (which checks Sec-Fetch-Site to distinguish browser vs external API calls).
    memberCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: {
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const memberPage = await memberCtx.newPage();
    await memberPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await memberPage.getByTestId("email-input").fill(memberEmail);
    await memberPage.getByTestId("password-input").fill("password123");
    await memberPage.locator('button[type="submit"]').first().click();
    await memberPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    await memberPage.close();
  });

  test.afterAll(async ({ api }) => {
    await api.deleteProject(projectId);
    await api.deleteUser(memberUserId);
    await memberCtx.close();
  });

  test("member can read projects", async ({ baseURL }) => {
    // Projects default to GLOBAL_ROLE access type — any USER with a role can read
    const response = await memberCtx.request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { id: projectId } }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe(projectId);
  });

  test("member cannot soft-delete project", async ({ baseURL }) => {
    // Soft-delete requires Documentation.canDelete in role — seeded 'user' role has canDelete: false
    const response = await memberCtx.request.patch(
      `${baseURL}/api/model/projects/update`,
      {
        data: {
          where: { id: projectId },
          data: { isDeleted: true },
        },
      }
    );

    // ZenStack access denial → 403 → remapped to 422 by route handler
    expect(response.status()).toBe(422);
  });
});

test.describe("Access Control - NO_ACCESS Denial (ACL-03)", () => {
  let noAccessCtx: BrowserContext;
  let projectId: number;
  let noAccessEmail: string;
  let noAccessUserId: string;

  test.beforeAll(async ({ browser, baseURL, api, request }) => {
    // Create a NO_ACCESS test user
    noAccessEmail = `acl-noaccess-${Date.now()}@example.com`;
    const userResult = await api.createUser({
      name: "ACL NoAccess",
      email: noAccessEmail,
      password: "password123",
      access: "USER",
    });
    noAccessUserId = userResult.data.id;

    // Create a test project via admin
    projectId = await api.createProject(`ACL-03 Project ${Date.now()}`);

    // Admin creates an explicit NO_ACCESS permission record for this user+project
    const permResponse = await request.post(
      `${baseURL}/api/model/userProjectPermission/create`,
      {
        data: {
          data: {
            userId: noAccessUserId,
            projectId,
            accessType: "NO_ACCESS",
          },
        },
      }
    );
    expect(permResponse.status()).toBe(201);

    // Sign in as the NO_ACCESS user in a new browser context (no storageState = no session).
    // extraHTTPHeaders ensures API requests are treated as same-origin browser requests by middleware.
    noAccessCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: {
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const noAccessPage = await noAccessCtx.newPage();
    await noAccessPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await noAccessPage.getByTestId("email-input").fill(noAccessEmail);
    await noAccessPage.getByTestId("password-input").fill("password123");
    await noAccessPage.locator('button[type="submit"]').first().click();
    await noAccessPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    await noAccessPage.close();
  });

  test.afterAll(async ({ api }) => {
    await api.deleteProject(projectId);
    await api.deleteUser(noAccessUserId);
    await noAccessCtx.close();
  });

  test("NO_ACCESS user sees empty projects list", async ({ baseURL }) => {
    // NO_ACCESS triggers @@deny('read', ...) — ZenStack silently filters records
    // Returns 200 with empty array, NOT 422
    const response = await noAccessCtx.request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { id: projectId } }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  test("NO_ACCESS user sees empty repositoryCases", async ({ baseURL }) => {
    // RepositoryCases inherits NO_ACCESS from project — silently filtered
    const response = await noAccessCtx.request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { projectId } }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});

test.describe("Access Control - Role-Based Area Permissions (ACL-05)", () => {
  let restrictedCtx: BrowserContext;
  let projectId: number;
  let caseId: number;
  let restrictedEmail: string;
  let repositoryId: number;
  let rootFolderId: number;
  let templateId: number;
  let stateId: number;
  let restrictedUserId: string;
  let restrictedRoleId: number;

  test.beforeAll(async ({ browser, baseURL, api, request }) => {
    // 1. Create a custom role with no TestCaseRepository edit access
    //    (The seeded 'user' role has canAddEdit: true — we need a different role)
    const roleResp = await request.post(
      `${baseURL}/api/model/roles/create`,
      {
        data: {
          data: { name: `ReadOnly-${Date.now()}`, isDefault: false },
        },
      }
    );
    expect(roleResp.status()).toBe(201);
    const roleResult = await roleResp.json();
    restrictedRoleId = roleResult.data.id;

    // 2. Create a RolePermission with canAddEdit: false for TestCaseRepository
    const rpResp = await request.post(
      `${baseURL}/api/model/rolePermission/create`,
      {
        data: {
          data: {
            roleId: restrictedRoleId,
            area: "TestCaseRepository",
            canAddEdit: false,
            canDelete: false,
            canClose: false,
          },
        },
      }
    );
    expect(rpResp.status()).toBe(201);

    // 3. Create a restricted USER whose global account role is the restricted role.
    //    This ensures the GLOBAL_ROLE fallback policy uses the restricted role (canAddEdit: false)
    //    rather than the default 'user' role (which has canAddEdit: true for TestCaseRepository).
    restrictedEmail = `acl-restricted-${Date.now()}@example.com`;
    const userResult = await api.createUser({
      name: "ACL Restricted",
      email: restrictedEmail,
      password: "password123",
      access: "USER",
      roleId: restrictedRoleId,
    });
    restrictedUserId = userResult.data.id;

    // 4. Create a test project via admin
    projectId = await api.createProject(`ACL-05 Project ${Date.now()}`);

    // 5. Assign the restricted user to the project with SPECIFIC_ROLE using the restricted role
    const permResp = await request.post(
      `${baseURL}/api/model/userProjectPermission/create`,
      {
        data: {
          data: {
            userId: restrictedUserId,
            projectId,
            accessType: "SPECIFIC_ROLE",
            roleId: restrictedRoleId,
          },
        },
      }
    );
    expect(permResp.status()).toBe(201);

    // 6. Fetch IDs needed for RepositoryCase creation attempt
    rootFolderId = await api.getRootFolderId(projectId);

    const repoResp = await request.get(
      `${baseURL}/api/model/repositories/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { projectId } }),
        },
      }
    );
    const repoResult = await repoResp.json();
    repositoryId = repoResult.data.id;

    const templateResp = await request.get(
      `${baseURL}/api/model/templates/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { isDefault: true, isDeleted: false } }),
        },
      }
    );
    const templateResult = await templateResp.json();
    templateId = templateResult.data.id;

    const stateResp = await request.get(
      `${baseURL}/api/model/workflows/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false, projects: { some: { projectId } } },
          }),
        },
      }
    );
    const stateResult = await stateResp.json();
    stateId = stateResult.data.id;

    // 7. Create a case via admin for the update test
    caseId = await api.createTestCase(projectId, rootFolderId, `ACL-05 Case ${Date.now()}`);

    // 8. Sign in as the restricted user in a new browser context.
    //    extraHTTPHeaders ensures API requests are treated as same-origin browser requests.
    restrictedCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: {
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const restrictedPage = await restrictedCtx.newPage();
    await restrictedPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await restrictedPage.getByTestId("email-input").fill(restrictedEmail);
    await restrictedPage.getByTestId("password-input").fill("password123");
    await restrictedPage.locator('button[type="submit"]').first().click();
    await restrictedPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    await restrictedPage.close();
  });

  test.afterAll(async ({ api, request, baseURL }) => {
    await api.deleteProject(projectId);
    await api.deleteUser(restrictedUserId);
    // Hard-delete the custom role (non-default roles can be deleted by admin)
    await request
      .delete(`${baseURL}/api/model/roles/delete`, {
        data: { where: { id: restrictedRoleId } },
      })
      .catch(() => {});
    await restrictedCtx.close();
  });

  test("restricted user can read RepositoryCases", async ({ baseURL }) => {
    // SPECIFIC_ROLE access with canAddEdit: false still allows reads
    const response = await restrictedCtx.request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { projectId } }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("restricted user cannot create RepositoryCase", async ({ baseURL }) => {
    // RepositoryCases create requires role.rolePermissions[area == 'TestCaseRepository' && canAddEdit]
    // The restricted user's role has canAddEdit: false — expect 422
    const response = await restrictedCtx.request.post(
      `${baseURL}/api/model/repositoryCases/create`,
      {
        data: {
          data: {
            name: `Unauthorized Case ${Date.now()}`,
            order: 0,
            automated: false,
            isArchived: false,
            isDeleted: false,
            currentVersion: 1,
            source: "MANUAL",
            project: { connect: { id: projectId } },
            repository: { connect: { id: repositoryId } },
            folder: { connect: { id: rootFolderId } },
            template: { connect: { id: templateId } },
            state: { connect: { id: stateId } },
            creator: { connect: { id: restrictedUserId } },
          },
        },
      }
    );

    // ZenStack access denial → 403 → remapped to 422 by route handler
    expect(response.status()).toBe(422);
  });

  test("restricted user cannot update RepositoryCase", async ({ baseURL }) => {
    // Update also requires TestCaseRepository canAddEdit — expect 422
    const response = await restrictedCtx.request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: { name: `Updated Name ${Date.now()}` },
        },
      }
    );

    // ZenStack access denial → 403 → remapped to 422 by route handler
    expect(response.status()).toBe(422);
  });
});

test.describe("Access Control - GLOBAL_ROLE Steps Permission (ACL-06)", () => {
  let memberCtx: BrowserContext;
  let projectId: number;
  let caseId: number;
  let memberEmail: string;
  let memberUserId: string;

  test.beforeAll(async ({ browser, baseURL, api }) => {
    // Create a regular USER-access member with the default "user" role
    memberEmail = `acl-steps-${Date.now()}@example.com`;

    // Look up the default role (seeded as "user")
    const rolesResponse = await api["request"].get(
      `${baseURL}/api/model/roles/findFirst?q=${encodeURIComponent(
        JSON.stringify({ where: { isDefault: true } })
      )}`
    );
    const defaultRole = await rolesResponse.json();
    const defaultRoleId = defaultRole?.data?.id;

    const memberResult = await api.createUser({
      name: "ACL Steps Member",
      email: memberEmail,
      password: "password123",
      access: "USER",
      ...(defaultRoleId ? { roleId: defaultRoleId } : {}),
    });
    memberUserId = memberResult.data.id;

    // Create a project (defaults to GLOBAL_ROLE access type — any USER with a role can access)
    projectId = await api.createProject(`ACL-06 Steps Project ${Date.now()}`);

    // Create a test case via admin for the member to add steps to
    const rootFolderId = await api.getRootFolderId(projectId);
    caseId = await api.createTestCase(
      projectId,
      rootFolderId,
      `ACL-06 Case ${Date.now()}`
    );

    // Sign in as the member user
    memberCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: {
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const memberPage = await memberCtx.newPage();
    await memberPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await memberPage.getByTestId("email-input").fill(memberEmail);
    await memberPage.getByTestId("password-input").fill("password123");
    await memberPage.locator('button[type="submit"]').first().click();
    await memberPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    await memberPage.close();
  });

  test.afterAll(async ({ api }) => {
    await api.deleteProject(projectId);
    await api.deleteUser(memberUserId);
    await memberCtx.close();
  });

  test("GLOBAL_ROLE member can create a Step on a RepositoryCase", async ({
    baseURL,
  }) => {
    // This tests the fix: GLOBAL_ROLE users could create RepositoryCases
    // but were denied creating Steps due to missing permission paths
    const response = await memberCtx.request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Test step" }],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Expected result" }],
                },
              ],
            }),
            order: 0,
            isDeleted: false,
          },
        },
      }
    );

    if (response.status() !== 201) {
      const errorBody = await response.json().catch(() => null);
      console.error("Step create failed:", response.status(), JSON.stringify(errorBody));
      console.error("Step create caseId:", caseId, "memberUserId:", memberUserId);
      // Log member's auth status
      const whoami = await memberCtx.request.get(`${baseURL}/api/auth/session`);
      console.error("Member session:", await whoami.text());
    }
    expect(response.status()).toBe(201);
    const result = await response.json();
    expect(result.data.id).toBeGreaterThan(0);
    expect(result.data.testCaseId).toBe(caseId);
  });

  test("GLOBAL_ROLE member can update a Step", async ({ baseURL }) => {
    // First create a step
    const createResponse = await memberCtx.request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Original step" }],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Original result" }],
                },
              ],
            }),
            order: 1,
            isDeleted: false,
          },
        },
      }
    );

    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const stepId = created.data.id;

    // Now update the step
    const updateResponse = await memberCtx.request.patch(
      `${baseURL}/api/model/steps/update`,
      {
        data: {
          where: { id: stepId },
          data: {
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Updated step" }],
                },
              ],
            }),
          },
        },
      }
    );

    expect(updateResponse.status()).toBe(200);
  });

  test("GLOBAL_ROLE member can soft-delete a Step", async ({ baseURL }) => {
    // Create a step to delete
    const createResponse = await memberCtx.request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Step to delete" }],
                },
              ],
            }),
            order: 2,
            isDeleted: false,
          },
        },
      }
    );

    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const stepId = created.data.id;

    // Soft-delete the step
    const deleteResponse = await memberCtx.request.patch(
      `${baseURL}/api/model/steps/update`,
      {
        data: {
          where: { id: stepId },
          data: { isDeleted: true },
        },
      }
    );

    expect(deleteResponse.status()).toBe(200);
  });
});
