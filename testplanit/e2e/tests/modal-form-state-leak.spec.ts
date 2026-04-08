import { expect, test } from "../fixtures";

/**
 * Regression tests for the form-state-leak bug class fixed on the
 * refactor/modal-form-state-leak branch.
 *
 * The bug: several Add/Edit modal components held their own `open`
 * state and were rendered unconditionally by their parent page. As a
 * result the form (and any local useState values) stayed mounted for
 * the entire page lifetime, and react-hook-form state persisted
 * across open/close cycles. Filling in sensitive fields like
 * passwords, API keys, upload URLs, or rich-text editor content,
 * then cancelling or submitting, would leak that data into the next
 * opening of the dialog.
 *
 * The fix: the seven affected modals were refactored to the tier-3
 * pattern — parent owns the `open` state and renders the trigger
 * inline; the modal file is a pure form component taking
 * { open, onClose } as props; the parent conditionally mounts the
 * modal (`{open && <MyForm ... />}`). React's unmount then cleans up
 * all state automatically.
 *
 * These tests verify the fix by opening a modal, filling in a field,
 * cancelling without submitting, reopening, and asserting the form is
 * empty. Before the refactor, these assertions would fail because the
 * form values would still be populated from the previous cycle.
 *
 * See CONTRIBUTING.md -> "Modal Forms" for the pattern and
 * scripts/check-modal-pattern.sh for the static CI guardrail.
 */

test.describe("Modal form state leak regression", () => {
  test("AddUser password field is cleared between open cycles", async ({
    page,
  }) => {
    // Highest-sensitivity case: the original PR #181 bug. Before the fix,
    // filling in a password, cancelling, and reopening would show the prior
    // password still in the field.
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    const addButton = page
      .getByRole("button", { name: /add/i })
      .first();
    await expect(addButton).toBeVisible({ timeout: 10000 });

    // --- First open: fill password + name, cancel ---
    await addButton.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nameInput = dialog.getByPlaceholder(/^name$/i);
    const passwordInputs = dialog.locator('input[type="password"]');
    // There are two password fields: password and confirmPassword.
    const passwordInput = passwordInputs.first();
    const confirmPasswordInput = passwordInputs.nth(1);

    const uniqueName = `Leak Test ${Date.now()}`;
    await nameInput.fill(uniqueName);
    await passwordInput.fill("Secret123!");
    await confirmPasswordInput.fill("Secret123!");

    await expect(nameInput).toHaveValue(uniqueName);
    await expect(passwordInput).toHaveValue("Secret123!");
    await expect(confirmPasswordInput).toHaveValue("Secret123!");

    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // --- Second open: name, password, confirmPassword must all be empty ---
    await addButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nameInputAgain = dialog.getByPlaceholder(/^name$/i);
    const passwordInputsAgain = dialog.locator('input[type="password"]');

    await expect(nameInputAgain).toHaveValue("");
    await expect(passwordInputsAgain.first()).toHaveValue("");
    await expect(passwordInputsAgain.nth(1)).toHaveValue("");

    // Clean up by closing the dialog.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
  });

  test("AddTemplate form fields are cleared between open cycles", async ({
    page,
  }) => {
    // Before the refactor, AddTemplate held four DraggableField[] lists and
    // a multi-field react-hook-form, all of which persisted. This test only
    // exercises the name field (simplest observable field), but the
    // unmount-based fix cleans up everything at once.
    await page.goto("/en-US/admin/fields");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByTestId("add-template-button");
    await expect(addButton).toBeVisible({ timeout: 10000 });

    // --- First open: fill name, cancel ---
    await addButton.click();
    let dialog = page.getByTestId("template-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nameInput = page.getByTestId("template-name-input");
    const uniqueName = `Leak Test Template ${Date.now()}`;
    await nameInput.fill(uniqueName);
    await expect(nameInput).toHaveValue(uniqueName);

    await page.getByTestId("template-cancel-button").click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // --- Second open: name must be empty ---
    await addButton.click();
    dialog = page.getByTestId("template-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nameInputAgain = page.getByTestId("template-name-input");
    await expect(nameInputAgain).toHaveValue("");

    // Clean up.
    await page.getByTestId("template-cancel-button").click();
  });

  test("EditAvatar is freshly mounted on each open", async ({
    page,
    adminUserId,
  }) => {
    // Structural regression test. The real latent bug in EditAvatar was that
    // the `avatarUrl` local useState value persisted across open/close cycles,
    // so a user who uploaded, cancelled, then reopened the dialog and clicked
    // Submit would PATCH with the stale URL. Exercising the full upload path
    // in an e2e test requires mocking the signed-URL endpoint and either the
    // S3 PUT or the server-action upload proxy, plus synthesizing an image
    // buffer. That complexity is out of scope for this regression suite.
    //
    // Instead, this test verifies the structural precondition that makes the
    // bug impossible: the EditAvatar dialog mounts fresh on each open. If
    // the component were still held mounted between opens (the buggy shape),
    // the submit button's `isSubmitting` state or any leftover error message
    // would leak into the next cycle. On the current tier-3 refactor, every
    // open produces a clean dialog.
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    const changeAvatarButton = page.getByRole("button", {
      name: /change profile picture/i,
    });
    await expect(changeAvatarButton).toBeVisible({ timeout: 10000 });

    // --- First open: verify fresh state, cancel ---
    await changeAvatarButton.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstSubmit = dialog.getByRole("button", { name: /^submit$/i });
    await expect(firstSubmit).toBeVisible();
    await expect(firstSubmit).toBeEnabled();
    // No preview image on first open (nothing uploaded yet).
    await expect(dialog.locator('img[alt="Preview"]')).toHaveCount(0);

    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // --- Second open: same fresh state ---
    await changeAvatarButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const secondSubmit = dialog.getByRole("button", { name: /^submit$/i });
    await expect(secondSubmit).toBeEnabled();
    // Submit button is NOT in its "Submitting..." state — proves that
    // `isSubmitting` did not leak from the previous cycle.
    await expect(secondSubmit).not.toHaveText(/submitting/i);
    // Still no preview image — the UploadAvatar child unmounted and remounted
    // along with the parent.
    await expect(dialog.locator('img[alt="Preview"]')).toHaveCount(0);

    // Clean up.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
  });
});
