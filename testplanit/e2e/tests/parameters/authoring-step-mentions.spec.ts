import { expect, test } from "../../fixtures";

/**
 * E2E spec — PARAM-04: parameter authoring + step mentions
 *
 * - Declare 2 parameters via the Configure parameters Sheet
 * - Type `@us` in the Steps editor → autocomplete shows
 * - Press Enter → @username chip rendered
 * - Click the toolbar `{ }` button → chooser Dialog opens
 * - Search `amo` → click amount → @amount chip inserted
 * - Type `@undeclared` → undeclared warning ribbon visible
 */
test.describe("Parameters - authoring + step mentions @parameters", () => {
  test("declare parameters and insert chips via autocomplete + toolbar", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Param Authoring ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "Authoring");
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      "Param Authoring Case"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");

    // Open the Configure parameters Sheet.
    await page.getByTestId("configure-parameters-button").click();
    await expect(page.getByTestId("configure-parameters-sheet")).toBeVisible();

    // Add parameter: username (STRING) — STRING is the default Type.
    await page.getByTestId("parameter-form-name").fill("username");
    await page.getByTestId("parameter-form-submit").click();

    // Add parameter: amount (INTEGER).
    await page.getByTestId("parameter-form-name").fill("amount");
    await page.getByTestId("parameter-form-type").click();
    await page.getByRole("option", { name: /INTEGER/i }).click();
    await page.getByTestId("parameter-form-submit").click();

    // Close the Sheet so the case-detail editor regains focus.
    await page.getByTestId("configure-parameters-sheet-close").click();
    await expect(
      page.getByTestId("configure-parameters-sheet")
    ).not.toBeVisible();

    // Switch the case into edit mode (assumes existing edit affordance).
    const editButton = page
      .locator('[data-testid="edit-case-button"]')
      .or(page.getByRole("button", { name: /^Edit$/ }))
      .first();
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
    }

    // Locate the first step's contenteditable.
    const stepEditor = page
      .locator('[data-testid="step-editor-0"] [contenteditable="true"]')
      .first();
    await expect(stepEditor).toBeVisible();
    await stepEditor.click();

    // Type @us to trigger autocomplete; press Enter to insert chip.
    await stepEditor.type("@us");
    await expect(
      page.getByTestId("parameter-mention-suggestion")
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      stepEditor.locator(".parameter-ref-chip").first()
    ).toContainText("@username");

    // Use the toolbar { } button to insert @amount.
    await page.getByTestId("tiptap-insert-parameter-button").click();
    await expect(page.getByTestId("parameter-chooser-dialog")).toBeVisible();
    await page.getByTestId("parameter-chooser-search-input").fill("amo");
    await page.getByTestId("parameter-chooser-item-amount").click();
    await expect(
      page.getByTestId("parameter-chooser-dialog")
    ).not.toBeVisible();

    // Type an undeclared @foo — warning ribbon should surface below the editor.
    await stepEditor.click();
    await stepEditor.type(" @notDeclared");
    // Dismiss the autocomplete that appears for unknown prefix.
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId("tiptap-undeclared-parameter-warning")
    ).toBeVisible();
  });
});
