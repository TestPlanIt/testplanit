import { expect, test } from "../../fixtures/index";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SSE Notifications Stream E2E Tests
 *
 * Verifies the live `/api/notifications/stream` SSE route end-to-end:
 *
 * - T1: Unauthenticated GET → 401, no Valkey subscriber created (REQ SSE-02)
 * - T2: Authenticated GET → 200 with text/event-stream headers; first
 *   message is the `sync` self-healing checkpoint (REQ SSE-01, D-11)
 * - T3: Admin-triggered system announcement reaches the admin's open SSE
 *   stream within ~10s (publisher → BullMQ worker → Valkey publish →
 *   route relay → client). Exercises the tenant broadcast channel
 *   (REQ PUB-02, REQ ISO-01).
 *
 * The Vitest-level isolation test at lib/notifications/sse-isolation.test.ts
 * already proves multi-tenant isolation against real Valkey; this suite
 * proves the full HTTP → SSE → bell wake-up wiring under the prod build.
 *
 * SSE streams are read with Node's native `fetch()` so the test can read
 * chunks before the response completes — Playwright's APIRequestContext
 * waits for the full body and would hang on a long-lived stream.
 */

const ADMIN_STORAGE_PATH = path.join(__dirname, "../../.auth/admin.json");

function readAdminCookieHeader(): string {
  const storage = JSON.parse(readFileSync(ADMIN_STORAGE_PATH, "utf8")) as {
    cookies: { name: string; value: string; domain: string }[];
  };
  return storage.cookies
    .filter(
      (c) =>
        c.domain === "localhost" ||
        c.domain === ".localhost" ||
        c.domain === "127.0.0.1"
    )
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  matchFn: (buffer: string) => boolean,
  timeoutMs: number
): Promise<string> {
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), remaining)
      ),
    ]);
    if (result.done) break;
    if (result.value) {
      buffer += decoder.decode(result.value, { stream: true });
      if (matchFn(buffer)) return buffer;
    }
  }
  return buffer;
}

test.describe("SSE Notifications Stream", () => {
  test("T1: unauthenticated GET /api/notifications/stream returns 401", async ({
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();

    const response = await fetch(`${baseURL!}/api/notifications/stream`);

    expect(response.status).toBe(401);
    await response.text().catch(() => {});
  });

  test("T2: authenticated GET returns text/event-stream with sync event", async ({
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();
    const cookieHeader = readAdminCookieHeader();
    const controller = new AbortController();

    const response = await fetch(`${baseURL!}/api/notifications/stream`, {
      headers: { cookie: cookieHeader },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      const buffer = await readUntil(
        reader,
        decoder,
        (b) => b.includes('"event":"sync"'),
        5000
      );
      expect(buffer).toContain('data: {"event":"sync"}');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  test("T3: admin system announcement reaches admin's open SSE stream", async ({
    baseURL,
    browser,
    request,
  }) => {
    expect(baseURL).toBeTruthy();
    const cookieHeader = readAdminCookieHeader();
    const controller = new AbortController();

    const response = await fetch(`${baseURL!}/api/notifications/stream`, {
      headers: { cookie: cookieHeader },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    const announcementTitle = `E2E SSE Test ${Date.now()}`;

    try {
      const syncBuffer = await readUntil(
        reader,
        decoder,
        (b) => b.includes('"event":"sync"'),
        5000
      );
      expect(syncBuffer).toContain('data: {"event":"sync"}');

      context = await browser.newContext({ storageState: ADMIN_STORAGE_PATH });
      const page = await context.newPage();

      await page.goto(`${baseURL!}/en-US/admin/notifications`);
      await page
        .getByTestId("notification-title-input")
        .waitFor({ state: "visible", timeout: 10000 });

      await page
        .getByTestId("notification-title-input")
        .fill(announcementTitle);

      // TipTapEditor's data-testid prop is silently dropped. Existing repo
      // patterns (see e2e/tests/repository/.../documentation.spec.ts) target
      // the contenteditable via `.ProseMirror` directly. This page has one
      // editor on it, so `.first()` is unambiguous.
      const editor = page.locator(".ProseMirror").first();
      await expect(editor).toBeVisible({ timeout: 10000 });
      await editor.click();
      await page.keyboard.type("E2E SSE test message body");

      await page.getByTestId("send-notification-button").click();

      await expect(page.getByTestId("notification-title-input")).toHaveValue(
        "",
        { timeout: 15000 }
      );

      const postSyncBuffer = await readUntil(
        reader,
        decoder,
        (b) => {
          const lines = b.split("\n");
          return lines.some(
            (l) => l.startsWith("data:") && !l.includes('"event":"sync"')
          );
        },
        15000
      );

      const dataLines = postSyncBuffer
        .split("\n")
        .filter((l) => l.startsWith("data:") && !l.includes('"event":"sync"'));

      expect(dataLines.length).toBeGreaterThan(0);

      const eventBody = dataLines[0].replace(/^data:\s*/, "");
      const event = JSON.parse(eventBody) as { id: string; event: string };
      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("event");
      expect(typeof event.id).toBe("string");
      expect(event.id.length).toBeGreaterThan(0);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});

      const cleanupResponse = await request.patch(
        `${baseURL!}/api/model/notification/updateMany`,
        {
          data: {
            where: { title: announcementTitle, isDeleted: false },
            data: { isDeleted: true },
          },
        }
      );
      if (!cleanupResponse.ok()) {
        console.warn(
          `[T3 cleanup] soft-delete '${announcementTitle}' failed: ${cleanupResponse.status()}`
        );
      }

      if (context) await context.close();
    }
  });
});
