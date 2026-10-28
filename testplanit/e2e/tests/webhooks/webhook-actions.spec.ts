import type { Locator, Page } from "@playwright/test";
import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";
import { createRawDbClient } from "~/lib/rawDbClient";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedExecutionTarget,
  seedInboundConfig,
  seedRepositoryWebhook,
  softDeleteExecutionTarget,
} from "../../fixtures/webhooks-seed";

/**
 * Inbound webhook Actions (projects/settings/[projectId]/webhooks).
 *
 * - The wizard's Code repository source creates one Create test run rule
 *   per event switched on; the card lists them, each never run yet.
 * - Add, edit, enable/disable, delete and drag-reorder rules; every change
 *   survives a reload.
 * - A rule's "Execute automated cases" option needs an enabled execution
 *   target; deleting the chosen target flags the rule and the dialog.
 * - A Create test run rule's test case filters are edited with the
 *   repository's filter bar, listed on the rule and stored on it.
 * - An issue tracker webhook lists its Import issues rule; a status rule
 *   can't be saved until it names a status, and saves its filter. A
 *   Generate Test Cases with AI rule needs an active AI model and saves
 *   its drafting options.
 * - A delivery the rules handled without acting reads as succeeded, not
 *   failed, on the Deliveries tab.
 * - The seeded System user is badged and locked on the admin Users page.
 *
 * Repository connections come from the `api` fixture (cleaned up with the
 * file); webhook configs and rules are seeded straight to the database for
 * every scenario but the wizard one, and cascade away with the connection.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ROW_SELECTOR = '[data-testid^="webhook-action-row-"]';

async function createRepositoryConnection(
  api: ApiHelper,
  label: string
): Promise<{ projectId: number; connectionId: number }> {
  const projectId = await api.createProject(`E2E Webhook Actions ${label}`);
  const repositoryId = await api.createCodeRepository(
    `E2E Actions Repo ${label}`
  );
  const connection = await api.createImpactConfig(projectId, repositoryId, {
    branch: "main",
  });
  return { projectId, connectionId: connection.id };
}

async function openWebhooksPage(page: Page, projectId: number) {
  await page.goto(`/en-US/projects/settings/${projectId}/webhooks`);
  await expect(page.getByTestId("webhook-config-form")).toBeVisible({
    timeout: 15000,
  });
}

function actionsSection(page: Page, configId: string): Locator {
  return page.getByTestId(`webhook-actions-${configId}`);
}

async function rowOrder(section: Locator): Promise<string[]> {
  return section
    .locator(ROW_SELECTOR)
    .evaluateAll((rows) =>
      rows.map((row) =>
        (row.getAttribute("data-testid") ?? "").replace(
          "webhook-action-row-",
          ""
        )
      )
    );
}

test.describe("Inbound webhook actions", () => {
  let db: ReturnType<typeof createRawDbClient>;

  test.beforeAll(() => {
    db = createRawDbClient();
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("the wizard creates one Create test run action per event switched on", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Wizard ${uid()}`
    );
    const card = page.getByTestId(
      `webhook-inbound-card-repository-${connectionId}`
    );

    await test.step("Add a Code repository webhook with pull requests and pushes on", async () => {
      await openWebhooksPage(page, projectId);
      await page.getByTestId("webhook-inbound-add-button").click();
      const wizard = page.getByTestId("webhook-inbound-wizard");
      await expect(wizard).toBeVisible();
      await wizard.getByTestId("webhook-wizard-source-repository").click();
      await wizard.getByTestId("webhook-wizard-next").click();

      await expect(
        wizard.getByTestId("webhook-wizard-repository-details")
      ).toBeVisible();
      await expect(
        wizard.getByTestId("webhook-wizard-event-pull-request")
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        wizard.getByTestId("webhook-wizard-event-push")
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        wizard.getByTestId("webhook-wizard-event-branch-push")
      ).toHaveAttribute("aria-checked", "false");

      await wizard.getByTestId("webhook-create-button").click();
      await expect(
        wizard.getByTestId("webhook-inbound-revealed-box")
      ).toBeVisible({ timeout: 15000 });
      await wizard.getByTestId("webhook-reveal-done-button").click();
      await expect(wizard).toBeHidden();
    });

    await test.step("The card lists exactly the two actions, never run", async () => {
      await expect(card).toBeVisible({ timeout: 15000 });
      const rows = card.locator(ROW_SELECTOR);
      await expect(rows).toHaveCount(2);

      await expect(rows.nth(0)).toContainText("Pull requests");
      await expect(rows.nth(0)).toContainText("Create Test Run");
      await expect(rows.nth(1)).toContainText("Pushes to main");
      await expect(rows.nth(1)).toContainText("Create Test Run");

      const lastRuns = card.locator('[data-testid^="webhook-action-last-"]');
      await expect(lastRuns).toHaveCount(2);
      await expect(lastRuns.nth(0)).toContainText("Never");
      await expect(lastRuns.nth(1)).toContainText("Never");
    });

    await test.step("The rules are stored in that order", async () => {
      const config = await db.webhookConfig.findFirst({
        where: { codeRepositoryConfigId: connectionId, direction: "INBOUND" },
        select: {
          actions: {
            orderBy: { order: "asc" },
            select: { trigger: true, action: true, isEnabled: true },
          },
        },
      });
      expect(config?.actions).toEqual([
        { trigger: "CODE_PULL_REQUEST", action: "CREATE_RUN", isEnabled: true },
        { trigger: "CODE_PUSH", action: "CREATE_RUN", isEnabled: true },
      ]);
    });
  });

  test("adding an action validates the minimum score and lists the new rule", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Add ${uid()}`
    );
    const { configId } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [{ trigger: "CODE_PULL_REQUEST" }],
    });
    const section = actionsSection(page, configId);
    const dialog = page.getByTestId("webhook-action-dialog");

    await test.step("Open Add and choose Pushes to other branches", async () => {
      await openWebhooksPage(page, projectId);
      await expect(section.locator(ROW_SELECTOR)).toHaveCount(1);
      await section.getByTestId("webhook-action-add").click();
      await expect(dialog).toBeVisible();

      await dialog.getByTestId("webhook-action-trigger").click();
      await page
        .getByRole("option", { name: "Pushes to other branches" })
        .click();
      await expect(dialog.getByTestId("webhook-action-trigger")).toContainText(
        "Pushes to other branches"
      );
      await expect(dialog.getByTestId("webhook-action-type")).toContainText(
        "Create Test Run"
      );
    });

    await test.step("A score above 100 shows an error and keeps the dialog open", async () => {
      await dialog.getByTestId("webhook-action-min-score").fill("150");
      await dialog.getByTestId("webhook-action-save").click();
      await expect(
        page
          .locator("[data-sonner-toast]")
          .filter({ hasText: "Enter a whole number from 0 to 100" })
      ).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(section.locator(ROW_SELECTOR)).toHaveCount(1);
    });

    await test.step("A valid score saves the rule with its badge", async () => {
      await dialog.getByTestId("webhook-action-min-score").fill("70");
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();

      const rows = section.locator(ROW_SELECTOR);
      await expect(rows).toHaveCount(2);
      const added = rows.filter({ hasText: "Pushes to other branches" });
      await expect(added).toContainText("Create Test Run");
      await expect(added).toContainText("Minimum impact score: 70");
    });

    await test.step("The rule is stored after the existing one", async () => {
      const saved = await db.webhookAction.findMany({
        where: { webhookConfigId: configId },
        orderBy: { order: "asc" },
        select: { trigger: true, options: true },
      });
      expect(saved.map((row) => row.trigger)).toEqual([
        "CODE_PULL_REQUEST",
        "CODE_BRANCH_PUSH",
      ]);
      expect(saved[1].options).toMatchObject({ minScore: 70 });
    });
  });

  test("editing an action updates its minimum score", async ({ page, api }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Edit ${uid()}`
    );
    const {
      configId,
      actionIds: [actionId],
    } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [{ trigger: "CODE_PULL_REQUEST", options: { minScore: 70 } }],
    });
    const section = actionsSection(page, configId);
    const row = section.getByTestId(`webhook-action-row-${actionId}`);
    const dialog = page.getByTestId("webhook-action-dialog");

    await test.step("The row shows the saved score", async () => {
      await openWebhooksPage(page, projectId);
      await expect(row).toContainText("Minimum impact score: 70");
    });

    await test.step("Change the score to 40 and save", async () => {
      await row.getByTestId(`webhook-action-edit-${actionId}`).click();
      await expect(dialog).toBeVisible();
      const score = dialog.getByTestId("webhook-action-min-score");
      await expect(score).toHaveValue("70");
      await score.fill("40");
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText("Minimum impact score: 40");
      await expect(row).not.toContainText("Minimum impact score: 70");
    });

    await test.step("Reopening shows the saved values", async () => {
      await row.getByTestId(`webhook-action-edit-${actionId}`).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("webhook-action-trigger")).toContainText(
        "Pull requests"
      );
      await expect(dialog.getByTestId("webhook-action-min-score")).toHaveValue(
        "40"
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      const saved = await db.webhookAction.findUnique({
        where: { id: actionId },
        select: { options: true },
      });
      expect(saved?.options).toMatchObject({ minScore: 40 });
    });
  });

  test("an action's test case filters are shown, edited with the repository's filter bar and saved", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Filters ${uid()}`
    );
    const {
      actionIds: [actionId],
    } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [
        {
          trigger: "CODE_PULL_REQUEST",
          options: {
            caseFilter: [
              { dimension: "automated", operator: "is", values: [1] },
            ],
          },
        },
      ],
    });
    const row = page.getByTestId(`webhook-action-row-${actionId}`);
    const dialog = page.getByTestId("webhook-action-dialog");

    await test.step("The row names the saved filter", async () => {
      await openWebhooksPage(page, projectId);
      await expect(row).toContainText("Automation: Is Automated");
    });

    await test.step("Add a Parameterized filter in the dialog and save", async () => {
      await row.getByTestId(`webhook-action-edit-${actionId}`).click();
      await expect(dialog).toBeVisible();
      const filters = dialog.getByTestId("webhook-action-case-filter");
      await expect(
        filters.getByTestId("filter-chip-automated-is")
      ).toBeVisible();

      await filters.getByTestId("filter-bar-add").click();
      await page.getByTestId("filter-dimension-option-parameterized").click();
      await expect(
        filters.getByTestId("filter-chip-parameterized-is")
      ).toBeVisible();
      // The new chip opens its editor; clicking the title closes it.
      await dialog.getByText("Edit action").click();
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();

      await expect(row).toContainText("Automation: Is Automated");
      await expect(row).toContainText("Parameterization: Is Parameterized");
      const saved = await db.webhookAction.findUnique({
        where: { id: actionId },
        select: { options: true },
      });
      expect(saved?.options).toEqual({
        caseFilter: [
          { dimension: "automated", operator: "is", values: [1] },
          { dimension: "parameterized", operator: "is", values: [1] },
        ],
      });
    });

    await test.step("Remove the Automation filter and save", async () => {
      await row.getByTestId(`webhook-action-edit-${actionId}`).click();
      await expect(dialog).toBeVisible();
      const filters = dialog.getByTestId("webhook-action-case-filter");
      await filters.getByTestId("filter-chip-automated-is-remove").click();
      await expect(
        filters.getByTestId("filter-chip-automated-is")
      ).toBeHidden();
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();

      await expect(row).not.toContainText("Automation: Is Automated");
      await expect(row).toContainText("Parameterization: Is Parameterized");
      const saved = await db.webhookAction.findUnique({
        where: { id: actionId },
        select: { options: true },
      });
      expect(saved?.options).toEqual({
        caseFilter: [
          { dimension: "parameterized", operator: "is", values: [1] },
        ],
      });
    });
  });

  test("the enable switch turns an action off and stays off after reload", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Toggle ${uid()}`
    );
    const {
      actionIds: [actionId],
    } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [{ trigger: "CODE_PUSH" }],
    });
    const toggle = page.getByTestId(`webhook-action-enabled-${actionId}`);

    await openWebhooksPage(page, projectId);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await expect
      .poll(
        async () =>
          (
            await db.webhookAction.findUnique({
              where: { id: actionId },
              select: { isEnabled: true },
            })
          )?.isEnabled
      )
      .toBe(false);

    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "false", {
      timeout: 15000,
    });
  });

  test("deleting an action asks for confirmation and removes the row", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Delete ${uid()}`
    );
    const {
      configId,
      actionIds: [keptId, deletedId],
    } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [{ trigger: "CODE_PULL_REQUEST" }, { trigger: "CODE_PUSH" }],
    });
    const section = actionsSection(page, configId);

    await openWebhooksPage(page, projectId);
    await expect(section.locator(ROW_SELECTOR)).toHaveCount(2);

    await section.getByTestId(`webhook-action-delete-${deletedId}`).click();
    const confirm = page.getByTestId("webhook-action-delete-dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByTestId("webhook-action-delete-confirm").click();
    await expect(confirm).toBeHidden();

    await expect(
      section.getByTestId(`webhook-action-row-${deletedId}`)
    ).toHaveCount(0);
    await expect(
      section.getByTestId(`webhook-action-row-${keptId}`)
    ).toBeVisible();

    await page.reload();
    await expect(section.locator(ROW_SELECTOR)).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(
      section.getByTestId(`webhook-action-row-${keptId}`)
    ).toBeVisible();
    expect(
      await db.webhookAction.findUnique({ where: { id: deletedId } })
    ).toBeNull();
  });

  test("dragging an action to the top reorders the rules", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Reorder ${uid()}`
    );
    const { configId, actionIds } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [
        { trigger: "CODE_PULL_REQUEST" },
        { trigger: "CODE_PUSH" },
        { trigger: "CODE_BRANCH_PUSH" },
      ],
    });
    const [firstId, secondId, lastId] = actionIds;
    const expected = [lastId, firstId, secondId];
    const section = actionsSection(page, configId);

    await openWebhooksPage(page, projectId);
    await expect(section.locator(ROW_SELECTOR)).toHaveCount(3);
    expect(await rowOrder(section)).toEqual(actionIds);

    await test.step("Drag the last row's handle above the first row", async () => {
      const handle = section.getByTestId(`webhook-action-drag-${lastId}`);
      const topHandle = section.getByTestId(`webhook-action-drag-${firstId}`);
      await handle.scrollIntoViewIfNeeded();
      const from = await handle.boundingBox();
      const to = await topHandle.boundingBox();
      if (!from || !to) throw new Error("Drag handles have no bounding box");

      const startX = from.x + from.width / 2;
      const startY = from.y + from.height / 2;
      const endY = to.y + to.height / 2 - 4;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Past the PointerSensor's 5px activation distance first.
      await page.mouse.move(startX, startY - 10, { steps: 5 });
      await page.mouse.move(startX, endY, { steps: 20 });
      await page.mouse.up();
    });

    await test.step("The new order shows and is saved", async () => {
      await expect.poll(() => rowOrder(section)).toEqual(expected);
      await expect
        .poll(async () =>
          (
            await db.webhookAction.findMany({
              where: { webhookConfigId: configId },
              orderBy: { order: "asc" },
              select: { id: true },
            })
          ).map((row) => row.id)
        )
        .toEqual(expected);
    });

    await test.step("The order survives a reload", async () => {
      await page.reload();
      await expect(section.locator(ROW_SELECTOR)).toHaveCount(3, {
        timeout: 15000,
      });
      expect(await rowOrder(section)).toEqual(expected);
    });
  });

  test("auto-execute needs an enabled target and flags a deleted one", async ({
    page,
    api,
  }) => {
    const { projectId, connectionId } = await createRepositoryConnection(
      api,
      `Execute ${uid()}`
    );
    const {
      configId,
      actionIds: [actionId],
    } = await seedRepositoryWebhook(db, {
      projectId,
      codeRepositoryConfigId: connectionId,
      actions: [{ trigger: "CODE_PULL_REQUEST" }],
    });
    const section = actionsSection(page, configId);
    const row = section.getByTestId(`webhook-action-row-${actionId}`);
    const dialog = page.getByTestId("webhook-action-dialog");
    const executeSwitch = dialog.getByTestId(
      "webhook-action-auto-execute-switch"
    );
    const targetName = `E2E Target ${uid()}`;
    let targetId = 0;

    await test.step("Without a target the option is unavailable", async () => {
      await openWebhooksPage(page, projectId);
      await row.getByTestId(`webhook-action-edit-${actionId}`).click();
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByTestId("webhook-action-auto-execute-no-targets")
      ).toBeVisible();
      await expect(executeSwitch).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    try {
      await test.step("With one enabled target, switching on selects it", async () => {
        targetId = await seedExecutionTarget(db, {
          projectId,
          name: targetName,
          createdById: await api.getCurrentUserId(),
        });
        // The target list is cached per page; a reload fetches the new one.
        await page.reload();
        await expect(row).toBeVisible({ timeout: 15000 });
        await row.getByTestId(`webhook-action-edit-${actionId}`).click();
        await expect(dialog).toBeVisible();
        await expect(executeSwitch).toBeEnabled();
        await expect(
          dialog.getByTestId("webhook-action-auto-execute-no-targets")
        ).toHaveCount(0);

        await executeSwitch.click();
        await expect(executeSwitch).toHaveAttribute("aria-checked", "true");
        await expect(
          dialog.getByTestId("webhook-action-auto-execute-target")
        ).toContainText(targetName);
        await expect(
          dialog.getByTestId("webhook-action-auto-execute-ref")
        ).toBeVisible();

        await dialog.getByTestId("webhook-action-save").click();
        await expect(dialog).toBeHidden();
        await expect(row).toContainText(`Target: ${targetName}`);
        await expect(
          row.getByTestId(`webhook-action-problem-${actionId}`)
        ).toHaveCount(0);

        const saved = await db.webhookAction.findUnique({
          where: { id: actionId },
          select: { options: true },
        });
        expect(saved?.options).toMatchObject({ autoExecute: { targetId } });
      });

      await test.step("Deleting the target flags the rule", async () => {
        await softDeleteExecutionTarget(db, { targetId });
        await page.reload();
        await expect(
          row.getByTestId(`webhook-action-problem-${actionId}`)
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step("The dialog warns the target is gone and disables the option", async () => {
        await row.getByTestId(`webhook-action-edit-${actionId}`).click();
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByTestId("webhook-action-auto-execute-target-missing")
        ).toBeVisible();
        await expect(executeSwitch).toBeDisabled();
        await expect(executeSwitch).toHaveAttribute("aria-checked", "false");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });
    } finally {
      if (targetId) {
        await softDeleteExecutionTarget(db, { targetId }).catch(() => {});
      }
    }
  });
});

test.describe("Issue tracker webhook actions", () => {
  let db: ReturnType<typeof createRawDbClient>;

  test.beforeAll(() => {
    db = createRawDbClient();
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  async function seedTrackerWebhook(api: ApiHelper, label: string) {
    const projectId = await api.createProject(`E2E Tracker Actions ${label}`);
    await api.setupProjectIssueIntegration(projectId, "GITHUB");
    const { configId } = await seedInboundConfig(db, {
      projectId,
      adapterType: "GITHUB",
    });
    const importRule = await db.webhookAction.create({
      data: {
        webhookConfigId: configId,
        projectId,
        order: 0,
        trigger: "ISSUE_EVENT",
        action: "IMPORT_ISSUE",
      },
      select: { id: true },
    });
    return { projectId, configId, importRuleId: importRule.id };
  }

  test("a status rule needs a status, then saves its filter", async ({
    page,
    api,
  }) => {
    const { projectId, configId, importRuleId } = await seedTrackerWebhook(
      api,
      `Status ${uid()}`
    );
    const section = actionsSection(page, configId);
    const dialog = page.getByTestId("webhook-action-dialog");

    await test.step("The card lists the Import issues rule", async () => {
      await openWebhooksPage(page, projectId);
      const row = section.getByTestId(`webhook-action-row-${importRuleId}`);
      await expect(row).toContainText("Any issue event");
      await expect(row).toContainText("Import Issues");
    });

    await test.step("Choose Issue status changes → Create Test Run; Save waits for a status", async () => {
      await section.getByTestId("webhook-action-add").click();
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("webhook-action-trigger").click();
      await page.getByRole("option", { name: "Issue status changes" }).click();
      await dialog.getByTestId("webhook-action-type").click();
      await page.getByRole("option", { name: "Create Test Run" }).click();
      await expect(dialog.getByTestId("webhook-action-type")).toContainText(
        "Create Test Run"
      );
      await expect(dialog.getByTestId("webhook-action-save")).toBeDisabled();
    });

    await test.step("Pick the tracker's closed status and add a label", async () => {
      await dialog.getByRole("combobox", { name: "Statuses" }).click();
      await page.getByRole("option", { name: "closed", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();

      const labels = dialog.getByTestId("webhook-action-labels-values-input");
      await labels.fill("qa");
      await labels.press("Enter");
      await expect(
        dialog.getByTestId("webhook-action-labels-value")
      ).toHaveText("qa");

      await expect(dialog.getByTestId("webhook-action-save")).toBeEnabled();
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();
    });

    await test.step("The rule lists its filter and is stored after the import rule", async () => {
      const added = section
        .locator(ROW_SELECTOR)
        .filter({ hasText: "Issue status changes" });
      await expect(added).toContainText("Create Test Run");
      await expect(added).toContainText("Statuses: closed");
      await expect(added).toContainText("Labels: qa");

      const saved = await db.webhookAction.findMany({
        where: { webhookConfigId: configId },
        orderBy: { order: "asc" },
        select: { trigger: true, action: true, filter: true },
      });
      expect(saved.map((row) => [row.trigger, row.action])).toEqual([
        ["ISSUE_EVENT", "IMPORT_ISSUE"],
        ["ISSUE_STATUS_ENTERED", "CREATE_RUN"],
      ]);
      expect(saved[1].filter).toMatchObject({
        statuses: ["closed"],
        labels: ["qa"],
      });
    });
  });

  // The refusal when no AI model is active is NOT asserted here. `hasActiveLlm`
  // counts ACTIVE LlmIntegration rows install-wide, and 22 call sites across 8
  // spec files create one, so in a fullyParallel suite there is almost always
  // an active model while this test runs — the assertion cannot hold. It is
  // covered where the precondition can be controlled, in
  // app/actions/webhook-actions.test.ts with getProjectReadiness mocked.
  test("a Generate Test Cases with AI rule saves its drafting options", async ({
    page,
    api,
  }) => {
    const { projectId, configId } = await seedTrackerWebhook(
      api,
      `Draft ${uid()}`
    );
    const section = actionsSection(page, configId);
    const dialog = page.getByTestId("webhook-action-dialog");

    await test.step("Choose the AI action and its drafting options", async () => {
      await openWebhooksPage(page, projectId);
      await section.getByTestId("webhook-action-add").click();
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("webhook-action-trigger").click();
      await page.getByRole("option", { name: "Issue created" }).click();
      await dialog.getByTestId("webhook-action-type").click();
      await page
        .getByRole("option", { name: "Generate Test Cases with AI" })
        .click();
      await expect(
        dialog.getByTestId("webhook-action-draft-fields")
      ).toBeVisible();
    });

    await test.step("The rule saves its count", async () => {
      await api.createLlmIntegration(`E2E Draft Model ${uid()}`);
      await dialog.getByTestId("webhook-action-draft-quantity").click();
      await page.getByRole("option", { name: "A few (2-3)" }).click();
      await dialog.getByTestId("webhook-action-save").click();
      await expect(dialog).toBeHidden();

      const added = section
        .locator(ROW_SELECTOR)
        .filter({ hasText: "Generate Test Cases with AI" });
      await expect(added).toContainText("Issue created");
      await expect(added).toContainText(
        "Number of test cases to generate: A few (2-3)"
      );

      const saved = await db.webhookAction.findFirst({
        where: { webhookConfigId: configId, action: "DRAFT_CASES" },
        select: { trigger: true, options: true },
      });
      expect(saved).toEqual({
        trigger: "ISSUE_CREATED",
        options: { quantity: "few", autoGenerateTags: true },
      });
    });
  });

  test("a delivery the rules ignored counts as succeeded, not failed", async ({
    page,
    api,
  }) => {
    const { projectId, configId } = await seedTrackerWebhook(
      api,
      `Deliveries ${uid()}`
    );
    const [ignored] = await seedDeliveries(db, {
      webhookConfigId: configId,
      direction: "INBOUND",
      adapterType: "GITHUB",
      eventType: "issues",
      count: 1,
      statusPattern: "all-failure",
      errorSentinel: "ignored:not_imported",
    });
    const [failed] = await seedDeliveries(db, {
      webhookConfigId: configId,
      direction: "INBOUND",
      adapterType: "GITHUB",
      eventType: "issues",
      count: 1,
      statusPattern: "all-failure",
      errorSentinel: "run:no_workflow",
    });
    const deliveries = (status: string) =>
      page.goto(
        `/en-US/projects/settings/${projectId}/webhooks?tab=deliveries&configIds=${configId}&status=${status}`
      );
    const ignoredRow = page.getByTestId(`webhook-delivery-row-${ignored.id}`);
    const failedRow = page.getByTestId(`webhook-delivery-row-${failed.id}`);

    await test.step("Failed lists only the real failure", async () => {
      await deliveries("failed");
      await expect(failedRow).toBeVisible({ timeout: 15000 });
      await expect(failedRow.getByText("run:no_workflow")).toHaveClass(
        /text-destructive/
      );
      await expect(ignoredRow).toHaveCount(0);
    });

    await test.step("Succeeded lists the ignored delivery, muted", async () => {
      await deliveries("success");
      await expect(ignoredRow).toBeVisible({ timeout: 15000 });
      await expect(ignoredRow.getByText("ignored:not_imported")).toHaveClass(
        /text-muted-foreground/
      );
      await expect(failedRow).toHaveCount(0);
    });
  });
});

test.describe("System user on the admin Users page", () => {
  test("the System user is badged and cannot be edited or toggled", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/users");
    await expect(page.getByTestId("users-page-title")).toBeVisible({
      timeout: 15000,
    });

    const showInactive = page.locator("#active-users-checkbox");
    if ((await showInactive.getAttribute("data-state")) !== "checked") {
      await showInactive.click();
    }
    await expect(showInactive).toHaveAttribute("data-state", "checked");
    await page.getByPlaceholder("Filter users...").fill("System");

    const row = page
      .getByRole("row")
      .filter({ has: page.getByTestId("system-user-badge") });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(row.getByTestId("system-user-badge")).toBeVisible();
    await expect(
      row.getByTestId(`user-active-toggle-${SYSTEM_AUTOMATION_USER_ID}`)
    ).toBeDisabled();

    await row.getByRole("button", { name: "Actions" }).click();
    const edit = page.getByRole("menuitem", { name: "Edit" });
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  });
});
