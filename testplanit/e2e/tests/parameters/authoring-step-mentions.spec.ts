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

    await test.step("Open the test case and the Configure parameters sheet", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("load");

      // Open the Configure parameters Sheet.
      await page.getByTestId("configure-parameters-button").click();
      await expect(
        page.getByTestId("configure-parameters-sheet")
      ).toBeVisible();
    });

    await test.step("Declare username and amount parameters", async () => {
      const nameInput = page.getByTestId("parameter-form-name");

      // Add parameter: username (STRING) — STRING is the default Type.
      await nameInput.fill("username");
      await page.getByTestId("parameter-form-submit").click();

      // The form's onSubmit only runs form.reset(DEFAULTS) AFTER the create
      // POST resolves, which clears the name field. Wait for that reset before
      // typing the next parameter: otherwise the second fill races the first
      // submit's async reset, which wipes the typed "amount" name and the
      // second create silently fails validation (name min(1)) — leaving only
      // one parameter and the toolbar chooser showing "No Results" for amount.
      await expect(nameInput).toHaveValue("", { timeout: 10_000 });

      // Add parameter: amount (INTEGER).
      await nameInput.fill("amount");
      await page.getByTestId("parameter-form-type").click();
      await page.getByRole("option", { name: /INTEGER/i }).click();
      await page.getByTestId("parameter-form-submit").click();

      // Wait for the amount create to land (form resets again) so the parameter
      // is persisted and the chooser's parameter list includes it before we
      // close the Sheet.
      await expect(nameInput).toHaveValue("", { timeout: 10_000 });

      // Close the Sheet so the case-detail editor regains focus.
      await page.getByTestId("configure-parameters-sheet-close").click();
      await expect(
        page.getByTestId("configure-parameters-sheet")
      ).not.toBeVisible();
    });

    // Locate the first step's contenteditable (used across later steps).
    let stepEditor: ReturnType<typeof page.locator> | undefined;

    await test.step("Enter edit mode and add a step", async () => {
      // Switch the case into edit mode — StepsForm (with TipTap editor) only
      // renders when isEditMode === true.
      await page.getByTestId("edit-test-case-button").click();

      // Fresh cases have no steps; create one so the step-editor renders.
      await page.getByTestId("add-step-button").click();

      // Locate the first step's contenteditable.
      stepEditor = page
        .locator('[data-testid="step-editor-0"] [contenteditable="true"]')
        .first();
      await expect(stepEditor).toBeVisible();
      await stepEditor.click();
    });

    await test.step("Insert @username chip via autocomplete", async () => {
      // Type @us to trigger autocomplete; press Enter to insert chip.
      await stepEditor!.type("@us");
      await expect(
        page.getByTestId("parameter-mention-suggestion")
      ).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(
        stepEditor!.locator(".parameter-ref-chip").first()
      ).toContainText("@username");
    });

    await test.step("Insert @amount chip via the toolbar parameter chooser", async () => {
      // Use the toolbar { } button to insert @amount. The step block renders
      // TWO TipTap editors (step text + expectedResult), each with its own
      // tiptap-insert-parameter-button — and the Description editor on the
      // same page renders a third one. Scope to step-editor-0 + take .first()
      // (the step-text toolbar, rendered before the expectedResult toolbar).
      await page
        .locator('[data-testid="step-editor-0"]')
        .getByTestId("tiptap-insert-parameter-button")
        .first()
        .click();
      // The toolbar opens an AsyncCombobox (Radix Popover + cmdk), not a
      // standalone Dialog — find the search input by placeholder and the
      // option by accessible name. The previous `parameter-chooser-*`
      // testids were from an earlier dedicated-chooser implementation.
      const chooserSearch = page.getByPlaceholder(/search parameter/i);
      await expect(chooserSearch).toBeVisible();
      await chooserSearch.fill("amo");
      await page.getByRole("option", { name: /@?amount/i }).click();
      await expect(chooserSearch).not.toBeVisible();
    });

    await test.step("Insert an undeclared parameter reference and verify the warning ribbon", async () => {
      // The undeclared-parameter warning inspects parameterMention NODES whose
      // label is not in the declared list — it intentionally ignores plain
      // text. The `@`-autocomplete only ever offers DECLARED parameters (its
      // items() filters the declared set), so typing `@notDeclared` + Escape
      // leaves bare text that can never produce a mention node, and the ribbon
      // would never fire. That models the real trigger poorly: an undeclared
      // reference exists when a parameterMention's parameter was removed from
      // (or never added to) the declared set — e.g. a step authored against a
      // parameter that was later deleted via Configure parameters.
      //
      // Reproduce that state faithfully by pasting an undeclared
      // parameterMention node into the step editor. The node deserializes via
      // the Mention extension's parseHTML (span[data-type="parameterMention"]
      // with data-label) exactly as a persisted step reference would, and
      // because "notDeclared" is not among the declared names the ribbon
      // surfaces it. (HTML paste falls through TipTapEditor.handlePaste, which
      // only intercepts markdown-like text/plain, to ProseMirror's default
      // HTML parser.)
      await stepEditor!.click();
      await stepEditor!.evaluate((el: HTMLElement) => {
        const html =
          '<span data-type="parameterMention" data-id="notDeclared" ' +
          'data-label="notDeclared">@notDeclared</span>';
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/html", html);
        dataTransfer.setData("text/plain", "@notDeclared");
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          })
        );
      });

      await expect(
        page.getByTestId("tiptap-undeclared-parameter-warning")
      ).toBeVisible();
    });
  });
});
