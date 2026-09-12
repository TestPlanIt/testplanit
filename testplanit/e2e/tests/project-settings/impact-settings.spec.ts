import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { mockImpactApi } from "../../utils/impact-mocks";

/**
 * Impact project settings (/projects/settings/[projectId]/impact).
 *
 * - The Settings section of the project menu links to the page.
 * - The enable switch persists `projects.impactEnabled`.
 * - Connecting a repository writes a ProjectCodeRepositoryConfig with
 *   purpose IMPACT — and leaves the QuickScript binding (purpose
 *   QUICKSCRIPT) untouched — then the branch combobox (fed by the mocked
 *   branches route) replaces the free-text input, the Linked Tickets switch
 *   persists `issueScanEnabled`, and Disconnect removes the row.
 */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Expand the collapsed Settings accordion in the project menu (same
 * approach as project-menu-settings.spec.ts).
 */
async function expandSettingsSection(page: Page) {
  const settingsSection = page.getByTestId("project-menu-section-settings");
  await expect(settingsSection).toBeVisible({ timeout: 10000 });

  const impactLink = page.locator("#settings-impact-link");
  if (!(await impactLink.isVisible({ timeout: 1000 }).catch(() => false))) {
    await settingsSection.getByRole("button", { name: "Settings" }).click();
    await expect(impactLink).toBeVisible({ timeout: 5000 });
  }
}

async function fetchRepoConfig(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  purpose: "IMPACT" | "QUICKSCRIPT"
): Promise<{
  id: number;
  repositoryId: number;
  branch: string | null;
  purpose: string;
  issueScanEnabled: boolean;
} | null> {
  const res = await request.get(
    `${baseURL}/api/model/projectCodeRepositoryConfig/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { projectId, purpose },
          select: {
            id: true,
            repositoryId: true,
            branch: true,
            purpose: true,
            issueScanEnabled: true,
          },
        }),
      },
    }
  );
  return (await res.json()).data ?? null;
}

async function fetchImpactEnabled(
  request: APIRequestContext,
  baseURL: string,
  projectId: number
): Promise<boolean | undefined> {
  const res = await request.get(`${baseURL}/api/model/projects/findFirst`, {
    params: {
      q: JSON.stringify({
        where: { id: projectId },
        select: { impactEnabled: true },
      }),
    },
  });
  return (await res.json()).data?.impactEnabled;
}

test.describe("Impact project settings", () => {
  test("the Settings menu links to the Impact page", async ({ page, api }) => {
    const projectId = await api.createProject(`E2E Impact Menu ${uid()}`);

    await test.step("Open the project overview and expand Settings", async () => {
      await page.goto(`/en-US/projects/overview/${projectId}`);
      await page.waitForLoadState("networkidle");
      await expandSettingsSection(page);
    });

    await test.step("The Impact link navigates to the settings page", async () => {
      const impactLink = page.locator("#settings-impact-link");
      await expect(impactLink).toBeVisible();
      await impactLink.click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/settings/${projectId}/impact`)
      );
      await expect(page.getByTestId("impact-enabled-toggle")).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("the enable switch persists impactEnabled", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(`E2E Impact Toggle ${uid()}`);
    const base = baseURL || "http://localhost:3000";

    await test.step("Open the Impact settings page (off by default)", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/impact`);
      const toggle = page.getByTestId("impact-enabled-toggle");
      await expect(toggle).toBeVisible({ timeout: 15000 });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
    });

    await test.step("Switching it on writes impactEnabled = true", async () => {
      await page.getByTestId("impact-enabled-toggle").click();
      await expect
        .poll(() => fetchImpactEnabled(request, base, projectId), {
          timeout: 15000,
        })
        .toBe(true);
      await expect(page.getByTestId("impact-enabled-toggle")).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    await test.step("Switching it off writes impactEnabled = false", async () => {
      await page.getByTestId("impact-enabled-toggle").click();
      await expect
        .poll(() => fetchImpactEnabled(request, base, projectId), {
          timeout: 15000,
        })
        .toBe(false);
    });
  });

  test("connects a repository for Impact only, picks a branch, and disconnects", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const base = baseURL || "http://localhost:3000";
    const projectId = await api.createProject(`E2E Impact Connect ${ts}`);
    const repoName = `E2E Impact Repo ${ts}`;
    const repositoryId = await api.createCodeRepository(repoName);

    // The branches route is the only provider-backed call this page makes
    // (once a config exists); everything else is model-API CRUD.
    await mockImpactApi(page, { configuredBranch: "main" });

    await test.step("Pick the repository and type a branch (no config yet, so a plain input)", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/impact`);
      const repositorySelect = page.getByTestId("impact-repository-select");
      await expect(repositorySelect).toBeVisible({ timeout: 15000 });
      await repositorySelect.click();
      await page
        .getByRole("option", { name: new RegExp(escapeRegExp(repoName)) })
        .click();
      await expect(repositorySelect).toContainText(repoName);

      const branchInput = page.getByTestId("impact-branch-input");
      await expect(branchInput).toBeVisible();
      await branchInput.fill("main");
    });

    await test.step("Save creates a purpose=IMPACT config", async () => {
      await page.getByTestId("impact-save").click();
      await expect
        .poll(
          async () =>
            (await fetchRepoConfig(request, base, projectId, "IMPACT"))?.branch,
          { timeout: 15000 }
        )
        .toBe("main");
      const config = await fetchRepoConfig(request, base, projectId, "IMPACT");
      expect(config?.repositoryId).toBe(repositoryId);
      expect(config?.purpose).toBe("IMPACT");
      api.trackCodeRepositoryConfig(config!.id);
    });

    await test.step("The branch combobox replaces the input and lists the mocked branches", async () => {
      const combobox = page.getByTestId("impact-branch-combobox");
      await expect(combobox).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("impact-branch-input")).toHaveCount(0);

      const trigger = combobox.getByRole("combobox");
      await expect(trigger).toContainText("main");
      await trigger.click();
      await page.getByRole("option", { name: /develop/ }).click();
      await expect(trigger).toContainText("develop");

      await page.getByTestId("impact-save").click();
      await expect
        .poll(
          async () =>
            (await fetchRepoConfig(request, base, projectId, "IMPACT"))?.branch,
          { timeout: 15000 }
        )
        .toBe("develop");
    });

    await test.step("The Linked Tickets switch is on by default and persists off", async () => {
      const ticketSwitch = page.getByTestId("impact-issue-scan-enabled");
      await expect(ticketSwitch).toBeVisible({ timeout: 15000 });
      await expect(ticketSwitch).toHaveAttribute("aria-checked", "true");
      expect(
        (await fetchRepoConfig(request, base, projectId, "IMPACT"))
          ?.issueScanEnabled
      ).toBe(true);

      await ticketSwitch.click();
      await expect(ticketSwitch).toHaveAttribute("aria-checked", "false");
      await page.getByTestId("impact-save").click();
      await expect
        .poll(
          async () =>
            (await fetchRepoConfig(request, base, projectId, "IMPACT"))
              ?.issueScanEnabled,
          { timeout: 15000 }
        )
        .toBe(false);
    });

    await test.step("Regression: the QuickScript page shows no connected repository", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/quickscript`);
      await expect(page.getByTestId("quickscript-enabled-toggle")).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByRole("button", { name: "Disconnect Repository" })
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("combobox")
          .filter({ hasText: "Select a code repository..." })
      ).toBeVisible();
      expect(
        await fetchRepoConfig(request, base, projectId, "QUICKSCRIPT")
      ).toBeNull();
    });

    await test.step("Disconnect removes the Impact config", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/impact`);
      const disconnectButton = page.getByTestId("impact-disconnect-button");
      await expect(disconnectButton).toBeVisible({ timeout: 15000 });
      await disconnectButton.click();
      await page.getByTestId("impact-disconnect-confirm").click();
      await expect
        .poll(() => fetchRepoConfig(request, base, projectId, "IMPACT"), {
          timeout: 15000,
        })
        .toBeNull();
      await expect(page.getByTestId("impact-disconnect-button")).toHaveCount(0);
    });
  });
});
