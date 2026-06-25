import fs from "node:fs";
import { createRawDbClient } from "~/lib/rawDbClient";
import path from "node:path";



import { expect, test } from "../../fixtures/index";
import {
  seedInboundConfig,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * French locale i18n smoke (F-02).
 *
 * Sister of `webhooks-i18n-spanish-keys.spec.ts` — same surface, same
 * assertion shape, different locale. Driven against fr-FR by overriding
 * the auth fixture's NEXT_LOCALE=en-US cookie to `fr-FR` before the
 * first navigation; proxy.ts redirects when the URL prefix doesn't match
 * the cookie, so cookie + URL must agree. See the Spanish sister spec
 * for the full rationale.
 *
 * Why a separate spec rather than a parameterised pair: the two locales
 * have independent failure modes (a key can be missing in fr-FR while
 * present in es-ES, or vice versa). Running one block per locale gives
 * separate test lines + separate failure surfaces in the Playwright report.
 *
 * Coverage matches F-01 — see webhooks-i18n-spanish-keys.spec.ts for the
 * surface inventory + the rationale for which strings are asserted vs
 * skipped.
 */

const MESSAGES_DIR = path.join(__dirname, "../../../messages");

interface WebhookMessages {
  inboundTab: string;
  outboundTab: string;
  deliveriesTab: string;
  inboundAddButton: string;
  outboundAddButton: string;
  outboundCreateTitle: string;
  outboundCreateSubscriptionsTitle: string;
  outboundCreateSubmit: string;
  outboundCreateCancel: string;
  outboundDeleteConfirmTitle: string;
  outboundDeleteConfirm: string;
  filterStatusAll: string;
  filterStatusFailed: string;
  filterReset: string;
  reEnable: string;
  reEnableConfirmTitle: string;
  reEnableConfirm: string;
  healthDisabled: string;
}

function loadMessages(locale: "en-US" | "es-ES" | "fr-FR"): WebhookMessages {
  const raw = fs.readFileSync(
    path.join(MESSAGES_DIR, `${locale}.json`),
    "utf-8"
  );
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const projects = parsed.projects as Record<string, unknown>;
  const settings = projects.settings as Record<string, unknown>;
  const webhooks = settings.webhooks as Record<string, unknown>;
  const healthBadge = webhooks.healthBadge as Record<string, string>;
  return {
    inboundTab: webhooks.inboundTab as string,
    outboundTab: webhooks.outboundTab as string,
    deliveriesTab: webhooks.deliveriesTab as string,
    inboundAddButton: webhooks.inboundAddButton as string,
    outboundAddButton: webhooks.outboundAddButton as string,
    outboundCreateTitle: webhooks.outboundCreateTitle as string,
    outboundCreateSubscriptionsTitle:
      webhooks.outboundCreateSubscriptionsTitle as string,
    outboundCreateSubmit: webhooks.outboundCreateSubmit as string,
    outboundCreateCancel: webhooks.outboundCreateCancel as string,
    outboundDeleteConfirmTitle: webhooks.outboundDeleteConfirmTitle as string,
    outboundDeleteConfirm: webhooks.outboundDeleteConfirm as string,
    filterStatusAll: webhooks.filterStatusAll as string,
    filterStatusFailed: webhooks.filterStatusFailed as string,
    filterReset: webhooks.filterReset as string,
    reEnable: webhooks.reEnable as string,
    reEnableConfirmTitle: webhooks.reEnableConfirmTitle as string,
    reEnableConfirm: webhooks.reEnableConfirm as string,
    healthDisabled: healthBadge.DISABLED,
  };
}

const MISSING_KEY_PATTERNS: RegExp[] = [
  /MISSING_MESSAGE/,
  /\bprojects\.settings\.webhooks\.[a-zA-Z]+\b/,
];

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook admin surface — French (fr-FR) i18n key coverage (F-02)", () => {
  let projectId: number;
  let db: ReturnType<typeof createRawDbClient>;
  let outboundConfigId: string;
  const fr = loadMessages("fr-FR");
  const en = loadMessages("en-US");

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E i18n FR ${uniqueId}`);
    db = createRawDbClient();

    const seeded = await seedOutboundConfig(db, {
      projectId,
      url: "https://example.com/i18n-fr/outbound",
      name: "E2E French Outbound",
    });
    outboundConfigId = seeded.configId;
    await db.webhookConfig.update({
      where: { id: outboundConfigId },
      data: {
        endpointHealth: "DISABLED",
        consecutiveFailureCount: 10,
        lastFailureAt: new Date(),
      },
    });

    await seedInboundConfig(db, {
      projectId,
      adapterType: "GITHUB",
    });
  });

  test.afterAll(async () => {
    if (db) await db.$disconnect();
  });

  test("admin viewing /fr-FR/projects/settings/{id}/webhooks sees French copy across Inbound, Outbound, and Deliveries tabs and no missing-key markers leak into the DOM", async ({
    page,
    baseURL,
  }) => {
    await test.step("Switch the session locale to French", async () => {
      // Override the auth fixture's NEXT_LOCALE=en-US cookie so proxy.ts
      // does not redirect /fr-FR/... back to /en-US/... before the page
      // renders. proxy.ts:379 reads NEXT_LOCALE and redirects when the URL
      // prefix doesn't match the cookie, so cookie + URL must agree.
      await page.context().addCookies([
        {
          name: "NEXT_LOCALE",
          value: "fr-FR",
          url: baseURL,
        },
      ]);
    });

    await test.step("View the Inbound tab in French", async () => {
      await page.goto(
        `${baseURL}/fr-FR/projects/settings/${projectId}/webhooks`
      );
      await expect(page.getByTestId("webhook-config-form")).toBeVisible({
        timeout: 15_000,
      });

      // Verify the product fix in `app/layout.tsx` (see PR for v0.23.0): the
      // root layout now resolves <html lang> from `getLocale()` instead of
      // hardcoding "en". Asserting fr-FR here gives a fast, specific failure
      // if the layout regresses or the cookie override didn't take effect.
      await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");

      await expect(page.getByTestId("webhooks-tab-inbound")).toContainText(
        fr.inboundTab
      );
      await expect(page.getByTestId("webhooks-tab-outbound")).toContainText(
        fr.outboundTab
      );
      await expect(page.getByTestId("webhooks-tab-deliveries")).toContainText(
        fr.deliveriesTab
      );

      const addInbound = page.getByTestId("webhook-inbound-add-button");
      await expect(addInbound).toContainText(fr.inboundAddButton);
      // The 1:1 inbound model gates Add on the project's active issue
      // integration. With no integration assigned (i18n test scope is
      // string coverage, not flow coverage) the button is disabled and
      // clicking it has no effect; we don't drive a creation flow here.

      await assertNoMissingKeyMarkers(page);
    });

    await test.step("View the Outbound tab in French", async () => {
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByTestId("webhook-outbound-add-button")
      ).toContainText(fr.outboundAddButton);

      await page.getByTestId("webhook-outbound-add-button").click();
      const outboundForm = page.getByTestId("webhook-outbound-create-form");
      await expect(outboundForm).toBeVisible();
      await expect(outboundForm).toContainText(fr.outboundCreateTitle);
      await expect(outboundForm).toContainText(
        fr.outboundCreateSubscriptionsTitle
      );
      await expect(
        page.getByTestId("webhook-outbound-create-submit")
      ).toContainText(fr.outboundCreateSubmit);
      await expect(
        page.getByTestId("webhook-outbound-create-cancel")
      ).toContainText(fr.outboundCreateCancel);
      await page.getByTestId("webhook-outbound-create-cancel").click();

      const outboundCard = page.getByTestId(
        `webhook-outbound-card-${outboundConfigId}`
      );
      await expect(outboundCard).toBeVisible();
      const healthBadge = page.getByTestId(
        `webhook-health-badge-${outboundConfigId}`
      );
      await expect(healthBadge).toContainText(fr.healthDisabled);

      const reEnableButton = page.getByTestId(
        `webhook-reenable-button-${outboundConfigId}`
      );
      await expect(reEnableButton).toContainText(fr.reEnable);
      await reEnableButton.click();
      const reEnableDialog = page.getByTestId("webhook-reenable-dialog");
      await expect(reEnableDialog).toBeVisible();
      await expect(reEnableDialog).toContainText(fr.reEnableConfirmTitle);
      await expect(reEnableDialog).toContainText(fr.reEnableConfirm);
      await page.getByTestId("webhook-reenable-dialog-cancel").click();

      await page
        .getByTestId(`webhook-outbound-delete-button-${outboundConfigId}`)
        .click();
      const deleteDialog = page.getByTestId("webhook-outbound-delete-dialog");
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toContainText(fr.outboundDeleteConfirmTitle);
      await expect(deleteDialog).toContainText(fr.outboundDeleteConfirm);
      await page.getByTestId("webhook-outbound-delete-dialog-cancel").click();

      await assertNoMissingKeyMarkers(page);
      await expectAbsentText(page, en.outboundCreateTitle);
      await expectAbsentText(page, en.reEnableConfirmTitle);
    });

    await test.step("View the Deliveries tab in French", async () => {
      await page.getByTestId("webhooks-tab-deliveries").click();
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: 10_000,
      });

      await expect(
        page.getByTestId("webhook-deliveries-filter-status")
      ).toContainText(fr.filterStatusAll);
      await expect(
        page.getByTestId("webhook-deliveries-reset-top")
      ).toContainText(fr.filterReset);

      await page.getByTestId("webhook-deliveries-filter-status").click();
      await expect(
        page.getByRole("option", { name: fr.filterStatusFailed })
      ).toBeVisible();
      await page.keyboard.press("Escape");

      await assertNoMissingKeyMarkers(page);
      await expectAbsentText(page, en.filterReset);
      await expectAbsentText(page, en.deliveriesTab);
    });
  });
});

async function assertNoMissingKeyMarkers(
  page: import("@playwright/test").Page
): Promise<void> {
  const html = await page.content();
  for (const pattern of MISSING_KEY_PATTERNS) {
    expect(
      html,
      `next-intl marker matched ${pattern} — a webhook key is missing or unwired in this locale's messages JSON`
    ).not.toMatch(pattern);
  }
}

async function expectAbsentText(
  page: import("@playwright/test").Page,
  englishOriginal: string
): Promise<void> {
  const count = await page.getByText(englishOriginal, { exact: true }).count();
  expect(
    count,
    `English-original "${englishOriginal}" rendered on French page — locale fallback or missing translation`
  ).toBe(0);
}
