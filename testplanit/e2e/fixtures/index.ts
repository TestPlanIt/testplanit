import { expect, test as base, type Page } from "@playwright/test";
import { ApiHelper } from "./api.fixture";

/**
 * Stub the bell's SSE stream with HTTP 204 so EventSource stops reconnecting
 * and `waitForLoadState("networkidle")` can fire. The NotificationBell mounts
 * on every authenticated page and would otherwise keep one network request
 * open indefinitely.
 *
 * The shared `page` fixture below auto-applies this. Tests that create their
 * own contexts via `browser.newContext()` must call this helper on each
 * manually-created page — fixture route handlers don't propagate to
 * manually-created contexts.
 *
 * Tests that want real SSE behavior on the page (e.g. dedicated SSE coverage
 * tests) should not call this and can `unroute` if needed.
 */
export async function stubBellSSE(page: Page): Promise<void> {
  await page.route("**/api/notifications/stream", (route) =>
    route.fulfill({ status: 204, body: "" })
  );
}

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
  // Auto-apply the SSE stub to the fixture's `page`. See stubBellSSE above
  // for rationale. Manually-created contexts must call stubBellSSE themselves.
  page: async ({ page }, use) => {
    await stubBellSSE(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },

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
      throw new Error(
        `Failed to fetch admin user ID: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();

    // The API may return { data: {...} } or { data: null } or just the data directly
    const userId = result.data?.id || result.id;

    if (!userId) {
      throw new Error(
        `No admin user found in database. Response: ${JSON.stringify(result)}`
      );
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(userId);
  },
});

// Re-export expect and common Playwright types for convenience
export { expect };
export type { APIRequestContext } from "@playwright/test";
