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
});

// Re-export expect for convenience
export { expect };
