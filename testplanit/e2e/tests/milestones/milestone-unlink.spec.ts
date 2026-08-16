import { createRawDbClient } from "~/lib/rawDbClient";

import { ApiHelper } from "../../fixtures/api.fixture";
import { expect, test } from "../../fixtures";

/**
 * E2E coverage for the milestone manual-unlink flow (HOOK-03).
 *
 * A synced (Jira-linked) milestone can be manually unlinked from its
 * MilestoneSourceBadge dropdown. Unlinking converts it to a local milestone
 * via convertMilestoneToLocal(reason="manual_unlink"): it sets `detachedAt`,
 * writes `externalState = "manual_unlink"`, keeps `externalId`/`integrationId`
 * non-null, flips SYNCED issue links to MANUAL, and — per D-11 — renders NO
 * residual badge afterwards.
 *
 * The tracker-owned fields (`externalId`, `integrationId`, `externalKind`,
 * `externalState`, `externalUrl`) are `@deny`-locked in schema.zmodel, so the
 * policy-enforced model API cannot seed a SYNCED milestone. We seed those
 * fields through the raw ZenStack client (no policy), mirroring how the
 * webhook specs seed policy-locked rows.
 */
test.describe("Milestone manual unlink", () => {
  let db: ReturnType<typeof createRawDbClient>;

  test.beforeAll(() => {
    db = createRawDbClient();
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  /**
   * Create a project + a JIRA integration, then flip a fresh milestone to the
   * actively-synced state so the source badge renders its admin dropdown.
   */
  async function seedSyncedMilestone(
    api: ApiHelper,
    label: string
  ): Promise<{ projectId: number; milestoneId: number }> {
    const projectId = await api.createProject(`${label} project`);
    const milestoneId = await api.createMilestone(
      projectId,
      `${label} milestone`
    );
    const integrationId = await api.setupProjectIssueIntegration(
      projectId,
      "JIRA"
    );

    await db.milestones.update({
      where: { id: milestoneId },
      data: {
        integrationId,
        externalId: "10001",
        externalKind: "ITERATION",
        externalState: "active",
        externalUrl:
          "https://jira.example.com/secure/RapidBoard.jspa?rapidView=39&sprint=4053",
        detachedAt: null,
      },
    });

    return { projectId, milestoneId };
  }

  test("unlinking a synced milestone converts it to local", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const { projectId, milestoneId } = await seedSyncedMilestone(
      api,
      `Unlink ${ts}`
    );

    await test.step("Open the synced milestone's detail page", async () => {
      await page.goto(`/en-US/projects/milestones/${projectId}/${milestoneId}`);
      await page.waitForLoadState("load");
      await expect(page.getByTestId("milestone-source-badge")).toBeVisible();
    });

    await test.step("Open the badge menu and start unlinking", async () => {
      // The badge sits in a header that re-renders as page queries land, so
      // a single click can be swallowed mid-re-render (dispatched between
      // Playwright's hit-test and the mouse events) and the menu never
      // opens. Only click the badge while the menu is closed — clicking it
      // with the menu open would toggle it shut again.
      const unlinkItem = page.getByTestId("milestone-source-menu-unlink");
      await expect(async () => {
        if (!(await unlinkItem.isVisible().catch(() => false))) {
          await page
            .getByTestId("milestone-source-badge")
            .click({ timeout: 2000 });
        }
        await expect(unlinkItem).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 15000 });
      await unlinkItem.click();

      // The consequences-confirm AlertDialog appears.
      await expect(page.getByText("Unlink milestone?")).toBeVisible();
      await expect(
        page.getByTestId("milestone-source-unlink-confirm")
      ).toBeVisible();
    });

    await test.step("Confirm and assert the unlink POST succeeds", async () => {
      const unlinkResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/milestones/${milestoneId}/unlink`) &&
          res.request().method() === "POST"
      );
      await page.getByTestId("milestone-source-unlink-confirm").click();
      const res = await unlinkResponse;
      expect(res.status()).toBe(200);
    });

    await test.step("Badge disappears (D-11: no residual badge)", async () => {
      await expect(page.getByTestId("milestone-source-badge")).toBeHidden();
    });

    await test.step("Milestone row is now detached and manually unlinked", async () => {
      const milestone = await api.getMilestone(milestoneId);
      expect(milestone.externalState).toBe("manual_unlink");
      expect(milestone.detachedAt).not.toBeNull();
      // integrationId is deliberately retained so re-import can re-link.
      expect(milestone.integrationId).not.toBeNull();
    });
  });

  test("cancelling the unlink dialog leaves the milestone synced", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const { projectId, milestoneId } = await seedSyncedMilestone(
      api,
      `UnlinkCancel ${ts}`
    );

    let unlinkPosted = false;
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes(`/api/milestones/${milestoneId}/unlink`)
      ) {
        unlinkPosted = true;
      }
    });

    await test.step("Open the detail page and the unlink dialog", async () => {
      await page.goto(`/en-US/projects/milestones/${projectId}/${milestoneId}`);
      await page.waitForLoadState("load");
      await page.getByTestId("milestone-source-badge").click();
      await page.getByTestId("milestone-source-menu-unlink").click();
      await expect(
        page.getByTestId("milestone-source-unlink-cancel")
      ).toBeVisible();
    });

    await test.step("Cancel dismisses the dialog without unlinking", async () => {
      await page.getByTestId("milestone-source-unlink-cancel").click();
      await expect(page.getByText("Unlink milestone?")).toBeHidden();
      // Badge is still the synced badge; no unlink call fired.
      await expect(page.getByTestId("milestone-source-badge")).toBeVisible();
      expect(unlinkPosted).toBe(false);
    });

    await test.step("Milestone row is still synced", async () => {
      const milestone = await api.getMilestone(milestoneId);
      expect(milestone.externalState).toBe("active");
      expect(milestone.detachedAt).toBeNull();
    });
  });
});
