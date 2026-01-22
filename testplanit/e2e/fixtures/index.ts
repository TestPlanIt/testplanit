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
            where: { email: "admin@example.com" },
            select: { id: true },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch admin user ID");
    }

    const result = await response.json();
    if (!result.data) {
      throw new Error("Admin user not found");
    }

    await use(result.data.id);
  },
});

// Re-export expect for convenience
export { expect };
