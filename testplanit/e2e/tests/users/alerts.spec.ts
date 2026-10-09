import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";

/**
 * Alerts (#651).
 *
 * A rule watches a metric; when a recorded result crosses its line the
 * alert worker writes a AlertEvent row, stamps the rule, and queues a
 * ALERT_TRIGGERED notification for every subscriber. The cooldown keeps
 * the same subject from firing twice. Subscribers can leave a rule
 * themselves. The page lists rules with a Notify me switch.
 *
 * All calls send `sec-fetch-site: same-origin` (the proxy blocks header-less
 * calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

async function findMany(
  request: APIRequestContext,
  baseURL: string | undefined,
  model: string,
  query: Record<string, unknown>
): Promise<any[]> {
  const q = encodeURIComponent(JSON.stringify(query));
  const response = await request.get(
    `${baseURL}/api/model/${model}/findMany?q=${q}`,
    { headers: sameOrigin }
  );
  if (!response.ok()) return [];
  const json = await response.json();
  return Array.isArray(json.data) ? json.data : [];
}

test.describe("alerts", () => {
  test.describe.configure({ mode: "serial" });

  let projectId: number;
  let caseId: number;
  let runId: number;
  let testRunCaseId: number;
  let failedId: number;
  let passedId: number;
  let userId: string;
  let ruleId: number;
  let subscriberId: number;
  const ts = Date.now();

  test("a consecutive-failures rule fires once, records an event and notifies its subscriber", async ({
    request,
    baseURL,
    api,
  }) => {
    await test.step("set up a project with one case in one run", async () => {
      projectId = await api.createProject(`E2E Alerts ${ts}`);
      const folderId = await api.createFolder(projectId, `Alerts ${ts}`);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Flaky login ${ts}`
      );
      runId = await api.createTestRun(projectId, `Alert Run ${ts}`);
      testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
      failedId = await api.getStatusId("failed");
      passedId = await api.getStatusId("passed");
      userId = await api.getCurrentUserId();
    });

    await test.step("create the rule and subscribe the current user", async () => {
      const created = await request.post(
        `${baseURL}/api/model/alertRule/create`,
        {
          headers: sameOrigin,
          data: {
            data: {
              name: `Two failures ${ts}`,
              metric: "CONSECUTIVE_FAILURES",
              scopeType: "PROJECT",
              thresholdValue: 2,
              resultSource: "BOTH",
              cooldownMinutes: 60,
              project: { connect: { id: projectId } },
              createdBy: { connect: { id: userId } },
            },
          },
        }
      );
      expect(created.ok(), await created.text()).toBe(true);
      ruleId = (await created.json()).data.id;

      const subscribed = await request.post(
        `${baseURL}/api/model/alertSubscriber/create`,
        {
          headers: sameOrigin,
          data: {
            data: {
              rule: { connect: { id: ruleId } },
              user: { connect: { id: userId } },
            },
          },
        }
      );
      expect(subscribed.ok(), await subscribed.text()).toBe(true);
      subscriberId = (await subscribed.json()).data.id;
    });

    await test.step("one failure is below the line", async () => {
      await api.createTestResult(runId, testRunCaseId, failedId);
      // Give the worker a moment; nothing should fire on a streak of one.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      expect(
        await findMany(request, baseURL, "alertEvent", {
          where: { ruleId },
          select: { id: true },
        })
      ).toHaveLength(0);
    });

    await test.step("the second failure fires the rule", async () => {
      await api.createTestResult(runId, testRunCaseId, failedId);

      // The event row lands before its subscribers are notified, so wait
      // for the notified count rather than for the row alone.
      await expect
        .poll(
          async () =>
            (
              await findMany(request, baseURL, "alertEvent", {
                where: { ruleId, notifiedCount: { gt: 0 } },
                select: { id: true },
              })
            ).length,
          { timeout: 60_000, intervals: [1000, 2000, 3000] }
        )
        .toBe(1);

      const [event] = await findMany(request, baseURL, "alertEvent", {
        where: { ruleId },
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          observedValue: true,
          thresholdValue: true,
          notifiedCount: true,
        },
      });
      expect(event.subjectType).toBe("CASE");
      expect(event.subjectId).toBe(caseId);
      expect(event.observedValue).toBe(2);
      expect(event.thresholdValue).toBe(2);
      expect(event.notifiedCount).toBe(1);

      const [rule] = await findMany(request, baseURL, "alertRule", {
        where: { id: ruleId },
        select: { lastFiredAt: true },
      });
      expect(rule.lastFiredAt).not.toBeNull();
    });

    await test.step("the subscriber receives a ALERT_TRIGGERED notification", async () => {
      await expect
        .poll(
          async () =>
            (
              await findMany(request, baseURL, "notification", {
                where: {
                  userId,
                  type: "ALERT_TRIGGERED",
                  isDeleted: false,
                  relatedEntityType: "AlertEvent",
                },
                select: { id: true, data: true },
              })
            ).filter((n) => n.data?.ruleId === ruleId).length,
          { timeout: 60_000, intervals: [1000, 2000, 3000] }
        )
        .toBe(1);
    });

    await test.step("a third failure inside the cooldown does not fire again", async () => {
      await api.createTestResult(runId, testRunCaseId, failedId);
      await new Promise((resolve) => setTimeout(resolve, 6000));
      expect(
        await findMany(request, baseURL, "alertEvent", {
          where: { ruleId },
          select: { id: true },
        })
      ).toHaveLength(1);
    });

    await test.step("a passing result on a stable case keeps the rule quiet", async () => {
      await api.createTestResult(runId, testRunCaseId, passedId);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(
        await findMany(request, baseURL, "alertEvent", {
          where: { ruleId },
          select: { id: true },
        })
      ).toHaveLength(1);
    });
  });

  test("the page lists the rule and the Notify me switch follows and leaves it", async ({
    page,
  }) => {
    await page.goto(`/users/profile/${userId}/alerts?tab=alerts`);
    await expect(page.getByTestId("alerts-page")).toBeVisible();
    const row = page.getByTestId(`alert-rule-row-${ruleId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Two failures ${ts}`);
    await expect(row.getByTestId("alert-rule-summary")).toContainText(
      "fails 2 times in a row"
    );
    await expect(
      page.getByTestId(`alert-rule-subscribers-${ruleId}`)
    ).toHaveText("1");

    const follow = page.getByTestId(`alert-rule-follow-${ruleId}`);
    await expect(follow).toHaveAttribute("aria-checked", "true");
    await follow.click();
    await expect(follow).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByTestId(`alert-rule-subscribers-${ruleId}`)
    ).toHaveText("0");

    await follow.click();
    await expect(follow).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId(`alert-rule-subscribers-${ruleId}`)
    ).toHaveText("1");

    await page.getByTestId(`alert-rule-history-${ruleId}`).click();
    const history = page.getByTestId("alert-history-dialog");
    await expect(history).toBeVisible();
    await expect(history.locator('[data-testid^="alert-event-"]')).toHaveCount(
      1
    );
  });

  test("the rule dialog creates a rule with the creator subscribed", async ({
    page,
  }) => {
    await page.goto(`/users/profile/${userId}/alerts?tab=alerts`);
    await page.getByTestId("alert-add-rule").click();
    const dialog = page.getByTestId("alert-rule-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("alert-rule-project").click();
    await page.getByTestId(`alert-project-${projectId}`).click();

    await dialog.getByTestId("alert-rule-name").fill(`Nightly pass rate ${ts}`);
    await dialog.getByTestId("alert-rule-metric").click();
    await page.getByTestId("alert-metric-RUN_PASS_RATE_BELOW").click();
    await expect(dialog.getByTestId("alert-rule-live-summary")).toContainText(
      "pass rate is under 90%"
    );
    await dialog.getByTestId("alert-rule-threshold").fill("75");
    await expect(dialog.getByTestId("alert-rule-live-summary")).toContainText(
      "pass rate is under 75%"
    );
    // The creator is in the audience before the rule exists.
    await expect(
      dialog.getByTestId(`alert-member-option-${userId}`).first()
    ).toBeVisible();

    await dialog.getByTestId("alert-rule-submit").click();
    await expect(dialog).toBeHidden();

    const table = page.getByTestId("alerts-table");
    await expect(table).toContainText(`Nightly pass rate ${ts}`);
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (subscriberId) {
      await request.delete(
        `${baseURL}/api/model/alertSubscriber/delete?q=${encodeURIComponent(
          JSON.stringify({ where: { id: subscriberId } })
        )}`,
        { headers: sameOrigin }
      );
    }
  });
});
