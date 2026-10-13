import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Automated Execution project settings (/projects/settings/[projectId]/automation).
 *
 * - The Settings section of the project menu links to the page.
 * - A generic-webhook target can be created; its signing secret is revealed
 *   once; it can be verified, disabled, and deleted.
 *
 * Generic targets need no repository, so the whole flow runs against the
 * local stub server. The E2E server allow-lists 127.0.0.1 for outbound
 * requests (ALLOWED_PRIVATE_HOSTS in .env.e2e).
 */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function expandSettingsSection(page: Page) {
  const settingsSection = page.getByTestId("project-menu-section-settings");
  await expect(settingsSection).toBeVisible({ timeout: 10000 });
  const link = page.locator("#settings-automation-link");
  if (!(await link.isVisible({ timeout: 1000 }).catch(() => false))) {
    await settingsSection.getByRole("button", { name: "Settings" }).click();
    await expect(link).toBeVisible({ timeout: 5000 });
  }
}

test.describe("Automated Execution project settings", () => {
  let stub: StubServerHandle;

  test.beforeAll(async () => {
    stub = await startStubServer();
  });

  test.afterAll(async () => {
    await stub?.close();
  });

  test("the Settings menu links to the Automated Execution page", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(`E2E Automation Menu ${uid()}`);

    await page.goto(`/en-US/projects/overview/${projectId}`);
    await page.waitForLoadState("load");
    await expandSettingsSection(page);

    await page.locator("#settings-automation-link").click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${projectId}/automation`)
    );
    await expect(page.getByTestId("automation-targets-section")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("automation-targets-empty")).toBeVisible();
  });

  test("creates, verifies, disables and deletes a generic webhook target", async ({
    page,
    api,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Automation Target ${ts}`);
    const targetName = `Stub CI ${ts}`;

    await test.step("Open the page and the create dialog", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/automation`);
      await expect(page.getByTestId("automation-targets-section")).toBeVisible({
        timeout: 15000,
      });
      await page.getByTestId("automation-target-create-button").click();
      await expect(page.getByTestId("automation-target-dialog")).toBeVisible();
    });

    await test.step("Fill in a generic webhook target", async () => {
      await page.getByTestId("automation-target-name-input").fill(targetName);
      await page.getByTestId("automation-target-provider-select").click();
      await page.getByRole("option", { name: "Generic webhook" }).click();
      await page
        .getByTestId("automation-target-webhook-url-input")
        .fill(`${stub.url}/hooks/testplanit`);
      await page.getByTestId("automation-target-input-add").click();
      await page.getByTestId("automation-target-input-key-0").fill("ENV");
      await page.getByTestId("automation-target-input-value-0").fill("staging");
      await page.getByTestId("automation-target-submit").click();
    });

    await test.step("The signing secret is revealed once", async () => {
      const box = page.getByTestId("automation-target-revealed-secret-box");
      await expect(box).toBeVisible({ timeout: 15000 });
      const secret = await page
        .getByTestId("automation-target-revealed-secret")
        .innerText();
      expect(secret.trim().length).toBeGreaterThanOrEqual(32);
      await page.getByTestId("automation-target-secret-done").click();
      await expect(box).toBeHidden();
    });

    const card = page
      .locator('[data-testid^="automation-target-card-"]')
      .first();
    let targetId = "";
    await test.step("The target card shows the provider and URL", async () => {
      await expect(card).toBeVisible();
      await expect(card).toContainText(targetName);
      await expect(card).toContainText("Generic webhook");
      await expect(card).toContainText(`${stub.url}/hooks/testplanit`);
      targetId = (await card.getAttribute("data-testid"))!.replace(
        "automation-target-card-",
        ""
      );
    });

    await test.step("Verify reports the URL as acceptable", async () => {
      await page
        .getByTestId(`automation-target-test-button-${targetId}`)
        .click();
      const result = page.getByTestId(
        `automation-target-test-result-${targetId}`
      );
      await expect(result).toBeVisible({ timeout: 15000 });
      await expect(result).toContainText(/verified/i);
    });

    await test.step("Disabling the target dims the card", async () => {
      const toggle = page.getByTestId(
        `automation-target-enabled-toggle-${targetId}`
      );
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false", {
        timeout: 15000,
      });
    });

    await test.step("Deleting the target returns to the empty state", async () => {
      await page
        .getByTestId(`automation-target-delete-button-${targetId}`)
        .click();
      await expect(
        page.getByTestId("automation-target-delete-dialog")
      ).toBeVisible();
      await page.getByTestId("automation-target-delete-confirm").click();
      await expect(page.getByTestId("automation-targets-empty")).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
