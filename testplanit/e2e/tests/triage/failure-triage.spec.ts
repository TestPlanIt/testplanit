import { expect, test } from "../../fixtures";

/**
 * Failure Triage E2E
 *
 * Covers:
 * - Admin > Root Causes: seeded catalogue, add, edit, delete
 * - A JUnit import with failures is grouped into a signature by the
 *   failure-triage worker; the signature shows up on the project's
 *   Failure Triage page and on its own page
 * - Manual classification from the catalogue (classified-by line)
 * - Quarantine from the signature page, the quarantine list, release
 *
 * The worker runs in the background (globalSetup spawns `pnpm workers`),
 * so signature assertions poll the API until the row exists.
 */

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const junitWithFailures = (
  tag: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Checkout ${tag}" tests="3" failures="2" errors="0" time="4.0">
    <testcase classname="checkout.Cart" name="adds item ${tag}" time="1.0"/>
    <testcase classname="checkout.Cart" name="applies coupon ${tag}" time="1.5">
      <failure message="AssertionError: expected total 42 to equal 40">AssertionError: expected total 42 to equal 40
    at Object.&lt;anonymous&gt; (tests/checkout/cart.spec.ts:88:12)
    at runTest (tests/helpers/run.ts:12:3)</failure>
    </testcase>
    <testcase classname="checkout.Cart" name="removes item ${tag}" time="1.5">
      <failure message="AssertionError: expected total 42 to equal 40">AssertionError: expected total 42 to equal 40
    at Object.&lt;anonymous&gt; (tests/checkout/cart.spec.ts:88:12)
    at runTest (tests/helpers/run.ts:12:3)</failure>
    </testcase>
  </testsuite>
</testsuites>`;

function parseSseEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      // not JSON
    }
  }
  return events;
}

async function importJUnit(
  request: import("@playwright/test").APIRequestContext,
  projectId: number,
  name: string,
  xml: string
): Promise<number> {
  const response = await request.post(`/api/test-results/import`, {
    multipart: {
      files: {
        name: "results.xml",
        mimeType: "application/xml",
        buffer: Buffer.from(xml),
      },
      format: "junit",
      projectId: String(projectId),
      name,
    },
  });
  expect(response.status()).toBe(200);
  const events = parseSseEvents(await response.text());
  const final = [...events].reverse().find((e) => e.complete || e.error);
  expect(final?.error, JSON.stringify(final)).toBeUndefined();
  return final!.testRunId as number;
}

async function waitForSignature(
  request: import("@playwright/test").APIRequestContext,
  projectId: number
): Promise<{ id: number; title: string; caseCount: number }> {
  const q = encodeURIComponent(
    JSON.stringify({
      where: { projectId },
      select: { id: true, title: true, caseCount: true },
    })
  );
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `/api/model/failureSignature/findFirst?q=${q}`
        );
        if (!res.ok()) return null;
        const body = await res.json();
        return body.data?.caseCount >= 2 ? body.data : null;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] }
    )
    .not.toBeNull();
  const res = await request.get(`/api/model/failureSignature/findFirst?q=${q}`);
  return (await res.json()).data;
}

// ---------------------------------------------------------------------------
// Admin catalogue
// ---------------------------------------------------------------------------

test.describe("Failure Triage - classification catalogue", () => {
  test("Admin sees the seeded classifications and can add, edit and delete one", async ({
    page,
    request,
  }) => {
    const name = `E2E Class ${uid()}`;
    const renamed = `${name} renamed`;

    await test.step("Open the Root Causes admin page", async () => {
      await page.goto("/en-US/admin/root-causes");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("root-causes-page-title")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("The seeded catalogue is listed", async () => {
      const list = page.getByTestId("admin-root-causes-table");
      for (const seeded of [
        "Product bug",
        "Test bug",
        "Environment",
        "Flaky",
      ]) {
        await expect(list.getByText(seeded, { exact: true })).toBeVisible({
          timeout: 10_000,
        });
      }
    });

    await test.step("Add a root cause", async () => {
      await page.getByTestId("failure-classification-add").click();
      const form = page.getByTestId("failure-classification-form");
      await expect(form).toBeVisible({ timeout: 5_000 });
      await form.getByTestId("failure-classification-name").fill(name);
      await form
        .getByTestId("failure-classification-description")
        .fill("Fixture data is missing or stale.");
      await form.getByTestId("failure-classification-submit").click();
      await expect(form).toBeHidden({ timeout: 10_000 });
      await expect(
        page
          .getByTestId("admin-root-causes-table")
          .getByText(name, { exact: true })
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Edit it", async () => {
      const row = page.locator("tr").filter({ hasText: name }).first();
      await row.getByTestId("failure-classification-edit").click();
      const form = page.getByTestId("failure-classification-form");
      await expect(form).toBeVisible({ timeout: 5_000 });
      await form.getByTestId("failure-classification-name").fill(renamed);
      await form.getByTestId("failure-classification-submit").click();
      await expect(form).toBeHidden({ timeout: 10_000 });
      await expect(
        page
          .getByTestId("admin-root-causes-table")
          .getByText(renamed, { exact: true })
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Delete it", async () => {
      const row = page.locator("tr").filter({ hasText: renamed }).first();
      await row.getByTestId("failure-classification-delete").click();
      await page.getByTestId("failure-classification-delete-confirm").click();
      await expect(
        page
          .getByTestId("admin-root-causes-table")
          .getByText(renamed, { exact: true })
      ).toBeHidden({ timeout: 10_000 });

      const res = await request.get(
        `/api/model/failureClassification/findFirst?q=${encodeURIComponent(
          JSON.stringify({ where: { name: renamed } })
        )}`
      );
      expect((await res.json()).data?.isDeleted).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Signature flow
// ---------------------------------------------------------------------------

test.describe("Failure Triage - signatures and quarantine", () => {
  test("Imported failures are grouped, classified by hand and quarantined", async ({
    page,
    request,
    api,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    let projectId = 0;
    let signature: { id: number; title: string; caseCount: number };

    await test.step("Create a project and import failing results", async () => {
      projectId = await api.createProject(`E2E Triage ${tag}`);
      await importJUnit(
        request,
        projectId,
        `Triage run ${tag}`,
        junitWithFailures(tag)
      );
    });

    await test.step("The worker groups both failures into one signature", async () => {
      signature = await waitForSignature(request, projectId);
      expect(signature.caseCount).toBe(2);
    });

    await test.step("The signature is listed on the Failure Triage page", async () => {
      await page.goto(`/en-US/projects/triage/${projectId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("triage-page-header")).toBeVisible({
        timeout: 10_000,
      });
      const link = page.getByTestId("triage-signature-link").first();
      await expect(link).toBeVisible({ timeout: 15_000 });
      await link.click();
      await expect(page.getByTestId("triage-signature-title")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Set a classification from the catalogue", async () => {
      await page.getByTestId("triage-classification-select").click();
      await page.getByRole("option", { name: /Test bug/ }).click();
      await expect(page.getByTestId("triage-classified-by")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByTestId("triage-classification-badge").first()
      ).toContainText("Test bug");
    });

    await test.step("Quarantine one affected case from its row", async () => {
      const rows = page.locator('[data-testid^="triage-affected-case-"]');
      await expect(rows.first()).toBeVisible({ timeout: 10_000 });
      await rows.first().getByTestId("triage-quarantine-case-button").click();
      const dialog = page.getByTestId("quarantine-dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByTestId("quarantine-reason").fill("Known coupon bug");
      await dialog.getByTestId("quarantine-confirm").click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await expect(
        page.getByTestId("triage-quarantined-badge").first()
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("The quarantine list shows the case and releases it", async () => {
      await page.goto(`/en-US/projects/triage/${projectId}/quarantine`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("quarantine-page-header")).toBeVisible({
        timeout: 10_000,
      });
      const row = page.locator('[data-testid^="quarantine-row-"]').first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText("Known coupon bug");
      await row.getByTestId("quarantine-release-button").click();
      await page.getByTestId("quarantine-release-confirm").click();
      await expect(row).toBeHidden({ timeout: 10_000 });

      const res = await request.get(
        `/api/model/caseQuarantine/count?q=${encodeURIComponent(
          JSON.stringify({ where: { projectId } })
        )}`
      );
      expect((await res.json()).data).toBe(0);
    });
  });
});
