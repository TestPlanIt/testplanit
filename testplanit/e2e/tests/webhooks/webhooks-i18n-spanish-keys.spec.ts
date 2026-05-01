import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  seedInboundConfig,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * Spanish locale i18n smoke (F-01).
 *
 * Workflow under test: the webhook admin surface — Inbound, Outbound, and
 * Deliveries tabs, plus the Add chooser, outbound create form, and the
 * Re-enable / Delete AlertDialog confirms — renders in Spanish when the URL
 * is prefixed with `/es-ES/...` (next-intl `localePrefix: "always"` so the
 * URL prefix wins over the NEXT_LOCALE cookie that the auth fixture sets to
 * en-US).
 *
 * This is a DETERMINISTIC i18n key-coverage smoke: it does NOT evaluate
 * translation quality, only that
 *   1. expected-translated values from `messages/es-ES.json` render on the
 *      page (guarantees keys exist + are wired); and
 *   2. no missing-key marker (`MISSING_MESSAGE`, raw key paths like
 *      `projects.settings.webhooks.foo`) leaks into the rendered DOM.
 *
 * Asserted strings are read from `messages/es-ES.json` at test start so
 * Crowdin updates don't break the spec. We pick high-signal multi-word
 * strings that appear on each surface (tab labels, AlertDialog titles +
 * bodies, health badge labels) — covering enough surfaces to catch a
 * missed key on a single rendered subtree without needing to assert every
 * key. Generic single-word labels ("Nombre" / "URL") are intentionally
 * skipped because their en-US originals collide with too many unrelated
 * UI surfaces to make the absent-text assertion meaningful.
 *
 * Coverage:
 *   - Inbound tab (Add button + chooser title/description)
 *   - Outbound tab (Add button + create form labels + submit/cancel verbs)
 *   - Outbound DISABLED card (health badge + Re-enable AlertDialog + Delete
 *     AlertDialog)
 *   - Deliveries tab filter bar (status select + reset button + status
 *     options dropdown)
 *
 * One DISABLED outbound config is seeded so the re-enable affordance is
 * reachable without driving the auto-disable transition through health.ts.
 * The Deliveries tab is rendered against an empty deliveries list (no
 * seeded rows) — the filter-bar i18n surface is the value, not the table.
 */

const MESSAGES_DIR = path.join(__dirname, "../../../messages");

interface WebhookMessages {
  inboundTab: string;
  outboundTab: string;
  deliveriesTab: string;
  inboundChooserTitle: string;
  inboundChooserDescription: string;
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
  // Path: projects.settings.webhooks
  const projects = parsed.projects as Record<string, unknown>;
  const settings = projects.settings as Record<string, unknown>;
  const webhooks = settings.webhooks as Record<string, unknown>;
  const healthBadge = webhooks.healthBadge as Record<string, string>;
  return {
    inboundTab: webhooks.inboundTab as string,
    outboundTab: webhooks.outboundTab as string,
    deliveriesTab: webhooks.deliveriesTab as string,
    inboundChooserTitle: webhooks.inboundChooserTitle as string,
    inboundChooserDescription: webhooks.inboundChooserDescription as string,
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

/**
 * next-intl v4 missing-key markers. v4 throws/logs `MISSING_MESSAGE` in
 * dev and renders the dotted key path as fallback in production. Either
 * pattern leaking into the DOM means a key is unwired or absent from the
 * locale JSON.
 */
const MISSING_KEY_PATTERNS: RegExp[] = [
  /MISSING_MESSAGE/,
  /\bprojects\.settings\.webhooks\.[a-zA-Z]+\b/,
];

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook admin surface — Spanish (es-ES) i18n key coverage (F-01)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let outboundConfigId: string;
  const es = loadMessages("es-ES");
  const en = loadMessages("en-US");

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E i18n ES ${uniqueId}`);
    prisma = new PrismaClient();

    // Seed one outbound config in DISABLED health so the re-enable button +
    // its AlertDialog become reachable without driving the auto-disable
    // transition. The card also exposes the delete button + AlertDialog,
    // covering the AlertDialog locale surface from F-01's expected list.
    const seeded = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/i18n-es/outbound",
      name: "E2E Spanish Outbound",
    });
    outboundConfigId = seeded.configId;
    await prisma.webhookConfig.update({
      where: { id: outboundConfigId },
      data: {
        endpointHealth: "DISABLED",
        consecutiveFailureCount: 10,
        lastFailureAt: new Date(),
      },
    });

    // Seed an inbound GITHUB config so the inbound tab has both a chooser
    // (when Add is clicked) and an existing config card to render the
    // health badge / send-test / rotate / delete affordances.
    await seedInboundConfig(prisma, {
      projectId,
      adapterType: "GITHUB",
    });
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin viewing /es-ES/projects/settings/{id}/webhooks sees Spanish copy across Inbound, Outbound, and Deliveries tabs and no missing-key markers leak into the DOM", async ({
    page,
    baseURL,
  }) => {
    // ─── 1. Inbound tab ──────────────────────────────────────────────
    await page.goto(`${baseURL}/es-ES/projects/settings/${projectId}/webhooks`);
    await expect(page.getByTestId("webhook-config-form")).toBeVisible({
      timeout: 15_000,
    });

    // Tab triggers carry Spanish labels (URL prefix wins over en-US cookie).
    await expect(page.getByTestId("webhooks-tab-inbound")).toContainText(
      es.inboundTab
    );
    await expect(page.getByTestId("webhooks-tab-outbound")).toContainText(
      es.outboundTab
    );
    await expect(page.getByTestId("webhooks-tab-deliveries")).toContainText(
      es.deliveriesTab
    );

    // Inbound Add button + open chooser → chooser title/description in Spanish.
    const addInbound = page.getByTestId("webhook-inbound-add-button");
    await expect(addInbound).toContainText(es.inboundAddButton);
    await addInbound.click();
    const chooser = page.getByTestId("webhook-inbound-chooser");
    await expect(chooser).toBeVisible();
    await expect(chooser).toContainText(es.inboundChooserTitle);
    await expect(chooser).toContainText(es.inboundChooserDescription);

    // Cancel back to the card list — the GitHub seed shows a card.
    await page.getByTestId("webhook-inbound-chooser-cancel").click();

    // The DOM that just rendered must not carry missing-key markers OR
    // the English original of the chooser title (which would mean es-ES
    // fell back to en-US).
    await assertNoMissingKeyMarkers(page);
    await expectAbsentText(page, en.inboundChooserTitle);

    // ─── 2. Outbound tab ─────────────────────────────────────────────
    await page.getByTestId("webhooks-tab-outbound").click();
    await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("webhook-outbound-add-button")).toContainText(
      es.outboundAddButton
    );

    // Open the outbound create form so the form labels render. We assert the
    // distinctive multi-word strings (title + subscriptions header + submit
    // verb); generic single-word labels like "Nombre"/"URL" are skipped
    // because their en-US originals ("Name"/"URL") collide with too many
    // unrelated UI surfaces to make the en-fallback assertion meaningful.
    await page.getByTestId("webhook-outbound-add-button").click();
    const outboundForm = page.getByTestId("webhook-outbound-create-form");
    await expect(outboundForm).toBeVisible();
    await expect(outboundForm).toContainText(es.outboundCreateTitle);
    await expect(outboundForm).toContainText(
      es.outboundCreateSubscriptionsTitle
    );
    await expect(
      page.getByTestId("webhook-outbound-create-submit")
    ).toContainText(es.outboundCreateSubmit);
    await expect(
      page.getByTestId("webhook-outbound-create-cancel")
    ).toContainText(es.outboundCreateCancel);
    await page.getByTestId("webhook-outbound-create-cancel").click();

    // The seeded DISABLED card carries Re-enable + Delete buttons in Spanish.
    const outboundCard = page.getByTestId(
      `webhook-outbound-card-${outboundConfigId}`
    );
    await expect(outboundCard).toBeVisible();
    const healthBadge = page.getByTestId(
      `webhook-health-badge-${outboundConfigId}`
    );
    await expect(healthBadge).toContainText(es.healthDisabled);

    // Re-enable AlertDialog — title + body in Spanish.
    const reEnableButton = page.getByTestId(
      `webhook-reenable-button-${outboundConfigId}`
    );
    await expect(reEnableButton).toContainText(es.reEnable);
    await reEnableButton.click();
    const reEnableDialog = page.getByTestId("webhook-reenable-dialog");
    await expect(reEnableDialog).toBeVisible();
    await expect(reEnableDialog).toContainText(es.reEnableConfirmTitle);
    await expect(reEnableDialog).toContainText(es.reEnableConfirm);
    await page.getByTestId("webhook-reenable-dialog-cancel").click();

    // Delete AlertDialog on the same card. The outbound form mounts its own
    // delete-dialog testid (separate from the inbound form's, which uses
    // `webhook-delete-dialog`).
    await page
      .getByTestId(`webhook-outbound-delete-button-${outboundConfigId}`)
      .click();
    const deleteDialog = page.getByTestId("webhook-outbound-delete-dialog");
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText(es.outboundDeleteConfirmTitle);
    await expect(deleteDialog).toContainText(es.outboundDeleteConfirm);
    await page.getByTestId("webhook-outbound-delete-dialog-cancel").click();

    await assertNoMissingKeyMarkers(page);
    await expectAbsentText(page, en.outboundCreateTitle);
    await expectAbsentText(page, en.reEnableConfirmTitle);

    // ─── 3. Deliveries tab ───────────────────────────────────────────
    await page.getByTestId("webhooks-tab-deliveries").click();
    await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
      timeout: 10_000,
    });

    // Filter bar: status select labels + reset button in Spanish.
    await expect(
      page.getByTestId("webhook-deliveries-filter-status")
    ).toContainText(es.filterStatusAll);
    await expect(
      page.getByTestId("webhook-deliveries-reset-top")
    ).toContainText(es.filterReset);

    // Open the status filter and assert the Spanish "Failed" option label.
    await page.getByTestId("webhook-deliveries-filter-status").click();
    await expect(
      page.getByRole("option", { name: es.filterStatusFailed })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await assertNoMissingKeyMarkers(page);
    await expectAbsentText(page, en.filterReset);
    await expectAbsentText(page, en.deliveriesTab);
  });
});

/**
 * Assert no next-intl missing-key marker leaks into the rendered HTML. Run
 * after each tab/dialog render so a regression is pinned to a specific
 * surface, not lost across the whole spec.
 */
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

/**
 * Assert a specific English-original string does NOT appear on the page.
 * Catches the "Crowdin sync failed for this key, fell back to en-US" case
 * that wouldn't trigger MISSING_MESSAGE (next-intl returns the en-US value
 * silently when configured with a fallback locale). This spec is run
 * against `messages/es-ES.json`'s expected values, so the en-US literal of
 * the same key MUST NOT appear except where en-US and es-ES legitimately
 * share text (e.g. "URL", brand names — those are not in the assertion list).
 */
async function expectAbsentText(
  page: import("@playwright/test").Page,
  englishOriginal: string
): Promise<void> {
  // Use page.locator with text= and assert the count is 0. innerText would
  // miss attribute-rendered strings; getByText scope is ideal for visible
  // copy, which is what this test cares about.
  const count = await page.getByText(englishOriginal, { exact: true }).count();
  expect(
    count,
    `English-original "${englishOriginal}" rendered on Spanish page — locale fallback or missing translation`
  ).toBe(0);
}
