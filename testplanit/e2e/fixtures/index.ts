import { test as base, expect } from "@playwright/test";
import { ApiHelper } from "./api.fixture";

/**
 * Extended test fixtures for TestPlanIt E2E tests
 */
export interface TestFixtures {
  /** API helper for creating/cleaning test data */
  api: ApiHelper;
  /** Default project ID to use for tests */
  projectId: number;
  /** Admin user ID for tests that need to navigate to admin profile */
  adminUserId: string;
}

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<TestFixtures>({
  // Default project ID (can be overridden per test)
  projectId: 1,

  // API helper fixture with automatic cleanup
  api: async ({ request, baseURL }, use) => {
    const api = new ApiHelper(request, baseURL || "http://localhost:3000");

    // Provide the API helper to the test
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(api);

    // Cleanup after test
    await api.cleanup();
  },

  // Admin user ID fixture - fetches the admin user's ID from the API
  adminUserId: async ({ request, baseURL }, use) => {
    const response = await request.get(
      `${baseURL || "http://localhost:3000"}/api/model/user/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: {
              access: "ADMIN",
              isDeleted: false,
            },
            select: { id: true },
            orderBy: { createdAt: "asc" }, // Get the first admin user created
          }),
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch admin user ID: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // The API may return { data: {...} } or { data: null } or just the data directly
    const userId = result.data?.id || result.id;

    if (!userId) {
      throw new Error(`No admin user found in database. Response: ${JSON.stringify(result)}`);
    }

    await use(userId);
  },
});

// Re-export expect for convenience
export { expect };
