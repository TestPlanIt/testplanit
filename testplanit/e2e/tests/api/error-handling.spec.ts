import { expect, test } from "../../fixtures/index";

/**
 * Error Handling E2E Tests
 *
 * Verifies that ZenStack v3 returns identifiable error responses for common
 * database constraint violations and validation errors:
 *
 * - ERR-01: Unique constraint violation returns non-200 with identifiable error message
 * - ERR-02: Foreign key violation returns non-200 with identifiable error message
 * - ERR-03: Missing required fields returns non-200 with identifiable validation error
 * - ERR-04: findFirst for nonexistent ID returns 200 with null data (no crash)
 *
 * ZenStack v3 error format:
 * - DB-level errors (unique/FK violations): status 500, body { error: { message: "..." } }
 * - Connect-not-found (P2025): ZenStack 404 → route handler remaps to 422
 * - Access policy denial: ZenStack 403 → route handler remaps to 422
 * - Not-found reads: status 200 with null data (silent filter, no error)
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Error Handling - ZenStack v3 Error Format", () => {
  test("ERR-01: duplicate unique field returns non-200 with identifiable error message", async ({
    api,
    request,
    baseURL,
  }) => {
    const projectName = `ERR Unique ${Date.now()}`;
    let userId: string | undefined;

    await test.step("Create a project to establish a unique name", async () => {
      await api.createProject(projectName);
    });

    await test.step("Fetch the current user's ID from the session", async () => {
      const sessionResponse = await request.get(`${baseURL}/api/auth/session`);
      expect(sessionResponse.ok()).toBe(true);
      const session = await sessionResponse.json();
      userId = session?.user?.id;
      expect(userId).toBeTruthy();
    });

    await test.step("Attempt a duplicate project and assert a unique-constraint error", async () => {
      // Attempt to create a second project with the same name
      const dupeResponse = await request.post(
        `${baseURL}/api/model/projects/create`,
        {
          data: {
            data: {
              name: projectName,
              isDeleted: false,
              createdBy: userId,
            },
          },
        }
      );

      // ZenStack v3 returns 500 for DB-level unique constraint violations
      expect(dupeResponse.status()).not.toBe(200);
      const body = await dupeResponse.json();

      // The error message must contain identifiable text for unique constraint violations
      const errorMessage =
        body?.error?.message || body?.message || JSON.stringify(body);
      expect(errorMessage).toMatch(/duplicate key|unique constraint/i);
    });
  });

  test("ERR-02: nonexistent foreign key returns non-200 with identifiable error message", async ({
    request,
    baseURL,
  }) => {
    let fkResponse: Awaited<ReturnType<typeof request.post>> | undefined;

    await test.step("Create a case with nonexistent foreign keys", async () => {
      // Attempt to create a RepositoryCase with nonexistent IDs
      // ZenStack P2025 (connected record not found) returns 404, remapped to 422 by route handler
      fkResponse = await request.post(
        `${baseURL}/api/model/repositoryCases/create`,
        {
          data: {
            data: {
              name: `FK Test Case ${Date.now()}`,
              order: 0,
              automated: false,
              isArchived: false,
              isDeleted: false,
              currentVersion: 1,
              source: "MANUAL",
              project: { connect: { id: 999999 } },
              repository: { connect: { id: 999999 } },
              folder: { connect: { id: 999999 } },
              template: { connect: { id: 999999 } },
              state: { connect: { id: 999999 } },
            },
          },
        }
      );
    });

    await test.step("Assert a foreign-key / not-found error is returned", async () => {
      // ZenStack P2025 (connect not found) → 404 → route handler remaps to 422
      expect(fkResponse!.status()).not.toBe(200);
      const body = await fkResponse!.json();

      // The error must be identifiable as a foreign key / not-found error
      const errorMessage =
        body?.error?.message || body?.message || JSON.stringify(body);
      expect(errorMessage).toMatch(
        /foreign key|not found|connect|not exist|P2025/i
      );
    });
  });

  test("ERR-03: missing required fields returns non-200 with identifiable validation error", async ({
    request,
    baseURL,
  }) => {
    let validationResponse:
      Awaited<ReturnType<typeof request.post>> | undefined;

    await test.step("Create a case with empty data", async () => {
      // Attempt to create a RepositoryCase with empty data
      validationResponse = await request.post(
        `${baseURL}/api/model/repositoryCases/create`,
        {
          data: {
            data: {},
          },
        }
      );
    });

    await test.step("Assert a validation / required-field error is returned", async () => {
      // Missing required fields must return a non-200 status
      expect(validationResponse!.status()).not.toBe(200);
      const body = await validationResponse!.json();

      // The error must be identifiable as a validation / required-field error
      const errorMessage =
        body?.error?.message || body?.message || JSON.stringify(body);
      expect(errorMessage).toMatch(
        /required|missing|invalid|validation|null constraint|not-null/i
      );
    });
  });

  test("ERR-04: findFirst for nonexistent record ID returns 200 with null data", async ({
    request,
    baseURL,
  }) => {
    await test.step("Read a nonexistent project and assert 200 with null data", async () => {
      // Attempt to read a project with a nonexistent ID
      const findResponse = await request.get(
        `${baseURL}/api/model/projects/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: 999999 } }),
          },
        }
      );

      // ZenStack v3 returns 200 with null data for not-found reads (silent filter)
      // This confirms ZenStack does NOT crash or return 500 for missing records
      expect(findResponse.status()).toBe(200);
      const body = await findResponse.json();
      expect(body.data).toBeNull();
    });
  });
});
