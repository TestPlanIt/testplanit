import { expect, test } from "../../fixtures";

/**
 * E2E spec — PARAM-07 invariant: cases with NO parameters are visually unchanged
 *
 * The locked invariant is: a case-detail page for a non-parameterized case
 * sees ZERO observable change vs pre-merge layout EXCEPT for the new
 * "Configure parameters" button (the single sanctioned addition per
 * UI-SPEC Surface A).
 *
 * This spec proves:
 * - Configure parameters button IS visible (the only allowed addition)
 * - Steps editor toolbar does NOT contain `tiptap-insert-parameter-button`
 * - Typing `@anything` does NOT trigger the parameter-mention autocomplete
 * - The undeclared-parameter warning ribbon is NOT rendered
 */
test.describe("Parameters - PARAM-07 invariant @parameters", () => {
  test("case with zero parameters: layout unchanged except Configure button", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create a non-parameterized test case", async () => {
      projectId = await api.createProject(
        `E2E Param Invariant ${Date.now()}`
      );
      folderId = await api.createFolder(projectId, "Invariant");
      caseId = await api.createTestCase(
        projectId,
        folderId,
        "Non-Param Case"
      );
    });

    await test.step("Open the case detail page", async () => {
      await page.goto(`/en-US/projects/repository/${projectId!}/${caseId!}`);
      await page.waitForLoadState("load");
    });

    await test.step("Confirm the Configure parameters button is the only sanctioned addition", async () => {
      // The Configure parameters button IS visible (UI-SPEC Surface A — the
      // only sanctioned addition for editable cases).
      await expect(
        page.getByTestId("configure-parameters-button")
      ).toBeVisible();
    });

    await test.step("Enter edit mode if a separate Edit affordance exists", async () => {
      // Switch into edit mode if the page exposes a separate Edit affordance.
      const editButton = page
        .locator('[data-testid="edit-case-button"]')
        .or(page.getByRole("button", { name: /^Edit$/ }))
        .first();
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
      }
    });

    await test.step("Verify the Steps toolbar has no insert-parameter button", async () => {
      // The Steps editor toolbar must NOT contain the parameter button.
      await expect(
        page.getByTestId("tiptap-insert-parameter-button")
      ).not.toBeVisible();
    });

    await test.step("Verify typing @anything does not trigger the parameter-mention autocomplete", async () => {
      // Typing `@anything` in a step editor must NOT trigger the
      // parameter-mention autocomplete (extension is not mounted when
      // parameters list is empty).
      const stepEditor = page
        .locator('[data-testid="step-editor-0"] [contenteditable="true"]')
        .first();
      if (await stepEditor.isVisible().catch(() => false)) {
        await stepEditor.click();
        await stepEditor.type("@anything");
        await expect(
          page.getByTestId("parameter-mention-suggestion")
        ).not.toBeVisible();
      }
    });

    await test.step("Verify no undeclared-parameter warning ribbon is rendered", async () => {
      // No undeclared-parameter warning ribbon either.
      await expect(
        page.getByTestId("tiptap-undeclared-parameter-warning")
      ).not.toBeVisible();
    });
  });
});
