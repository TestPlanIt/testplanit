import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  MOCK_PINNED_FILE,
  mockCodePinsApi,
  mockImpactApi,
} from "../../utils/impact-mocks";

/**
 * The Code Pins panel on a test case (/projects/repository/[p]/[c]).
 *
 * The panel renders only when the project has Impact on AND an IMPACT
 * repository config. The file picker's `files` route is mocked; pin creation
 * is intercepted and persisted through the model API so the route's
 * provider anchoring never runs (see mockCodePinsApi).
 */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function fetchPinDeleted(
  request: APIRequestContext,
  baseURL: string,
  pinId: number
): Promise<boolean | undefined> {
  const res = await request.get(
    `${baseURL}/api/model/repositoryCaseCodePin/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { id: pinId },
          select: { isDeleted: true },
        }),
      },
    }
  );
  return (await res.json()).data?.isDeleted;
}

/** The CodePinsPanel gate query (impactEnabled + the IMPACT config). */
function waitForPanelGate(page: Page) {
  return page.waitForResponse(
    (res) => {
      if (!res.url().includes("/api/model/projects/findFirst")) return false;
      try {
        return decodeURIComponent(res.url()).includes("codeRepositoryConfigs");
      } catch {
        return false;
      }
    },
    { timeout: 20000 }
  );
}

test.describe("Code Pins panel", () => {
  test("lists a seeded pin, adds a whole-file pin through the dialog, and removes it", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const base = baseURL || "http://localhost:3000";
    const projectId = await api.createProject(`E2E Code Pins ${ts}`);
    await api.enableImpact(projectId);
    const repoName = `E2E Pins Repo ${ts}`;
    const repositoryId = await api.createCodeRepository(repoName);
    const config = await api.createImpactConfig(projectId, repositoryId, {
      branch: "main",
    });
    const folderId = await api.createFolder(projectId, `Pins Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Pinned case ${ts}`
    );
    const seeded = await api.createCodePin(caseId, config.id, {
      kind: "RANGE",
      filePath: "src/checkout/totals.ts",
      startLine: 10,
      endLine: 20,
    });

    await mockImpactApi(page, { configuredBranch: "main" });
    const pinsApi = await mockCodePinsApi(page, {
      persist: (targetCaseId, body) =>
        api.createCodePin(targetCaseId, body.configId, {
          kind: body.kind,
          filePath: body.filePath,
          startLine: body.startLine,
          endLine: body.endLine,
          symbol: body.symbol,
          note: body.note,
        }),
    });

    const panel = page.getByTestId("case-code-pins");

    await test.step("The panel names the repository and shows the seeded pin", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await expect(panel).toBeVisible({ timeout: 20000 });
      const repository = panel.getByTestId("case-code-pins-repository");
      await expect(repository).toContainText(repoName);
      await expect(repository).toContainText("main");

      const seededRow = panel.getByTestId(`case-code-pin-${seeded.id}`);
      await expect(seededRow).toBeVisible({ timeout: 15000 });
      await expect(seededRow).toContainText("src/checkout/totals.ts");
      await expect(
        panel.getByTestId(`case-code-pin-location-${seeded.id}`)
      ).toHaveText("L10–L20");
    });

    let createdId = 0;
    await test.step("Add a whole-file pin from the mocked file list", async () => {
      await panel.getByTestId("case-code-pins-add").click();
      const dialog = page.getByTestId("code-pin-dialog");
      await expect(dialog).toBeVisible({ timeout: 10000 });

      const fileKind = dialog.getByTestId("code-pin-kind-FILE");
      await fileKind.click();
      await expect(fileKind).toHaveAttribute("data-state", "on");
      await expect(dialog.getByTestId("code-pin-submit")).toBeDisabled();

      await dialog.getByTestId("code-pin-file-combobox").click();
      await page.getByRole("option", { name: MOCK_PINNED_FILE }).click();
      await expect(dialog.getByTestId("code-pin-file-combobox")).toContainText(
        MOCK_PINNED_FILE
      );
      await expect(dialog.getByTestId("code-pin-files-status")).toContainText(
        "3 files cached"
      );

      await dialog.getByTestId("code-pin-submit").click();
      await expect(dialog).toBeHidden({ timeout: 10000 });

      expect(pinsApi.creates).toHaveLength(1);
      expect(pinsApi.creates[0]).toMatchObject({
        caseId,
        body: { configId: config.id, kind: "FILE", filePath: MOCK_PINNED_FILE },
      });
      createdId = pinsApi.created[0].id;
    });

    await test.step("The new pin is listed as a manual whole-file pin", async () => {
      const row = panel.getByTestId(`case-code-pin-${createdId}`);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row).toContainText(MOCK_PINNED_FILE);
      await expect(
        panel.getByTestId(`case-code-pin-source-${createdId}`)
      ).toBeVisible();
      await expect(
        panel.getByTestId(`case-code-pin-remove-${createdId}`)
      ).toBeEnabled();
      expect(await fetchPinDeleted(request, base, createdId)).toBe(false);
    });

    await test.step("Remove it through the confirm popover", async () => {
      await panel.getByTestId(`case-code-pin-remove-${createdId}`).click();
      await page
        .getByTestId(`case-code-pin-remove-confirm-${createdId}`)
        .click();
      await expect(panel.getByTestId(`case-code-pin-${createdId}`)).toHaveCount(
        0,
        { timeout: 15000 }
      );
      await expect
        .poll(() => fetchPinDeleted(request, base, createdId), {
          timeout: 15000,
        })
        .toBe(true);
      await expect(
        panel.getByTestId(`case-code-pin-${seeded.id}`)
      ).toBeVisible();
    });
  });

  test("is absent while Impact is off for the project", async ({
    page,
    api,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Code Pins Off ${ts}`);
    const folderId = await api.createFolder(projectId, `Pins Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Unpinned case ${ts}`
    );

    const gate = waitForPanelGate(page);
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await gate;

    // The result history sits below the panel's slot, so once it is on the
    // page the case view has laid out its sections.
    await expect(page.locator("#result-history")).toBeAttached({
      timeout: 20000,
    });
    await expect(page.getByTestId("case-code-pins")).toHaveCount(0);
  });
});
