import { expect, test as base, type Page, type Route } from "@playwright/test";
import { ApiHelper } from "./api.fixture";

/**
 * Stub every always-on SSE stream with HTTP 204 so each EventSource stops
 * reconnecting and `waitForLoadState("networkidle")` can fire. The app opens
 * several long-lived streams that otherwise keep a network request open
 * indefinitely and prevent the network from ever going idle:
 *
 *   - NotificationBell  → /api/notifications/stream (every authenticated page)
 *   - useTestRunLiveStream → /api/test-runs/{id}/stream and
 *                            /api/projects/{id}/test-runs/stream (run views)
 *   - issueUpdateStreamManager → /api/issues/stream (any page showing issues)
 *
 * One-shot streams (LLM generation, imports, exports) are NOT stubbed — they
 * complete and close on their own, so they don't block networkidle.
 *
 * The shared `page` fixture below auto-applies this. Tests that create their
 * own contexts via `browser.newContext()` must call this helper on each
 * manually-created page — fixture route handlers don't propagate to
 * manually-created contexts.
 *
 * Tests that want real SSE behavior on the page (e.g. dedicated SSE coverage
 * tests) should not call this and can `unroute` if needed.
 */
export async function stubLiveStreams(page: Page): Promise<void> {
  const fulfill204 = (route: Route) => route.fulfill({ status: 204, body: "" });
  await page.route(/\/api\/notifications\/stream/, fulfill204);
  await page.route(/\/api\/test-runs\/[^/]+\/stream/, fulfill204);
  await page.route(/\/api\/projects\/[^/]+\/test-runs\/stream/, fulfill204);
  await page.route(/\/api\/issues\/stream/, fulfill204);
}

/**
 * Back-compat alias. Prefer `stubLiveStreams`; this name is kept so existing
 * manually-created-context call sites keep working (and now also benefit from
 * the broader stubbing).
 */
export const stubBellSSE = stubLiveStreams;

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
  // Auto-apply the SSE stubs to the fixture's `page`. See stubLiveStreams
  // above for rationale. Manually-created contexts must call it themselves.
  page: async ({ page }, use, testInfo) => {
    await stubLiveStreams(page);

    // Diagnostic capture (opt-in via DIAG_E2E=on): surface problems that never
    // fail an assertion — browser console errors/warnings, uncaught page
    // exceptions, and 5xx responses — to stdout, tagged with the test title and
    // prefixed for grepping. Server-side DB/ORM errors already appear on the
    // [WebServer] stream, so a single captured run log holds both sides.
    if (process.env.DIAG_E2E === "on") {
      const tag = testInfo.titlePath.join(" › ");
      const oneLine = (s: string) =>
        s.replace(/\s+/g, " ").trim().slice(0, 600);
      page.on("console", (msg) => {
        const t = msg.type();
        if (t === "error" || t === "warning") {
          console.log(`[E2E-CONSOLE:${t}] ${tag} | ${oneLine(msg.text())}`);
        }
      });
      page.on("pageerror", (err) => {
        console.log(`[E2E-PAGEERROR] ${tag} | ${oneLine(err.message)}`);
      });
      page.on("response", (res) => {
        if (res.status() >= 500) {
          console.log(`[E2E-HTTP5xx] ${tag} | ${res.status()} ${res.url()}`);
        }
      });
    }

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
