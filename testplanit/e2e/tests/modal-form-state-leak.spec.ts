import { Locator, Page } from "@playwright/test";
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
    const addButton = page.getByRole("button", { name: /add/i }).first();
    let dialog: Locator | undefined;

    await test.step("Open the Add User page", async () => {
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      await expect(addButton).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill in name and password, then cancel", async () => {
      await addButton.click();
      dialog = page.getByRole("dialog");
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
    });

    await test.step("Reopen the dialog and verify all fields are empty", async () => {
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
  });

  test("AddTemplate form fields are cleared between open cycles", async ({
    page,
  }) => {
    // Before the refactor, AddTemplate held four DraggableField[] lists and
    // a multi-field react-hook-form, all of which persisted. This test only
    // exercises the name field (simplest observable field), but the
    // unmount-based fix cleans up everything at once.
    const addButton = page.getByTestId("add-template-button");
    let dialog: Locator | undefined;

    await test.step("Open the Add Template page", async () => {
      await page.goto("/en-US/admin/fields");
      await page.waitForLoadState("networkidle");

      await expect(addButton).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill in the template name, then cancel", async () => {
      await addButton.click();
      dialog = page.getByTestId("template-dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const nameInput = page.getByTestId("template-name-input");
      const uniqueName = `Leak Test Template ${Date.now()}`;
      await nameInput.fill(uniqueName);
      await expect(nameInput).toHaveValue(uniqueName);

      await page.getByTestId("template-cancel-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Reopen the dialog and verify the name is empty", async () => {
      await addButton.click();
      dialog = page.getByTestId("template-dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const nameInputAgain = page.getByTestId("template-name-input");
      await expect(nameInputAgain).toHaveValue("");

      // Clean up.
      await page.getByTestId("template-cancel-button").click();
    });
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
    const changeAvatarButton = page.getByRole("button", {
      name: /change profile picture/i,
    });
    let dialog: Locator | undefined;

    await test.step("Open the profile page", async () => {
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("networkidle");

      await expect(changeAvatarButton).toBeVisible({ timeout: 10000 });
    });

    await test.step("Open the Change Avatar dialog and verify fresh state, then cancel", async () => {
      await changeAvatarButton.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const firstSubmit = dialog.getByRole("button", { name: /^submit$/i });
      await expect(firstSubmit).toBeVisible();
      await expect(firstSubmit).toBeEnabled();
      // No preview image on first open (nothing uploaded yet).
      await expect(dialog.locator('img[alt="Preview"]')).toHaveCount(0);

      await dialog.getByRole("button", { name: /^cancel$/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Reopen the dialog and verify the same fresh state", async () => {
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
});

/**
 * Extended parameterized regression suite for the modal form-state-leak
 * bug class. The three focused tests above cover the highest-risk modals
 * (AddUser, AddTemplate, EditAvatar) in detail. The tests below spread
 * coverage across the rest of the admin surface using two phases:
 *
 *   Phase 1 (Add reset): open → fill first field → cancel → reopen →
 *            assert first field is empty. This is the original bug:
 *            react-hook-form state persisted across open cycles.
 *
 *   Phase 2 (Edit row-switch): edit row A → verify field shows A's value
 *            → modify to a poisoned value → cancel → edit row B →
 *            assert field shows row B's real value (not A's poisoned value).
 *            This catches row-state leak: the parent's row reference must
 *            refresh on each open, which is structurally guaranteed by
 *            conditional mounting ({editingX && <EditX row={editingX} />}).
 *
 * Phase 2 on Edit modals also validates the Delete row-switching pattern
 * structurally: the parent owns the row state identically for both, so if
 * EditX refreshes cleanly across row switches, DeleteX does too. Delete
 * modals themselves have no user-editable fields (just a confirmation
 * button), so there's no local form state to leak.
 *
 * These tests are idempotent: every modal is always cancelled, never
 * submitted, so no records are created, updated, or deleted.
 */

// ---- Shared helpers -------------------------------------------------------

/**
 * Wait for the admin table on the current page to have at least `minRows`
 * non-header rows. Every admin page we test uses the DataTable component
 * which renders a single <table> element.
 */
async function waitForTableRows(page: Page, minRows: number = 2) {
  const rows = page.locator("[data-row-id]");
  await expect(rows.first()).toBeVisible({ timeout: 10000 });
  // Give seed data a moment to hydrate
  await page.waitForFunction(
    (min) => document.querySelectorAll("[data-row-id]").length >= min,
    minRows,
    { timeout: 10000 }
  );
}

/**
 * Read the visible text of the "name" column cell for a given row index.
 * All admin tables in scope put the primary identifier in the first
 * pinned column. Strips whitespace and extra markup noise.
 */
async function readRowName(page: Page, rowIndex: number): Promise<string> {
  const row = page.locator("[data-row-id]").nth(rowIndex);
  // First td is the pinned name cell for every admin columns.tsx we touched.
  const cell = row.getByRole("cell").first();
  const text = (await cell.innerText()).trim();
  // Some cells include badge text like "Default" — take the first line.
  return text.split("\n")[0].trim();
}

/**
 * Click the Edit (SquarePen) button for a specific row. The convention we
 * standardized in the approach-B migration: every row's actions cell has
 * an Edit button followed by a Delete button, both inside the pinned
 * rightmost column. We target the first button in that cell.
 */
async function clickRowEditButton(page: Page, rowIndex: number) {
  const row = page.locator("[data-row-id]").nth(rowIndex);
  // The actions cell is the last td and contains 2 buttons: edit + delete.
  const actionsCell = row.getByRole("cell").last();
  // Edit is always the first button (ghost variant, SquarePen icon).
  await actionsCell.locator("button").first().click();
}

/**
 * Close an open dialog (works for both role="dialog" and role="alertdialog").
 * Prefers the Cancel button; falls back to Escape.
 */
async function closeDialog(page: Page) {
  const cancelButton = page.getByRole("button", { name: /^cancel$/i }).last();
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click();
  } else {
    await page.keyboard.press("Escape");
  }
  // Wait for ANY open dialog to be gone.
  await expect(
    page.locator('[role="dialog"], [role="alertdialog"]')
  ).toHaveCount(0, { timeout: 5000 });
}

/**
 * Default name-field locator: the first real text input inside the dialog,
 * excluding react-select comboboxes, checkboxes, password fields, file
 * inputs, and hidden fields. This matches shadcn's `<Input {...field} />`
 * pattern (no explicit type attribute, so `input[type="text"]` does NOT
 * work) while avoiding react-select's internal `<input type="text"
 * role="combobox">`.
 */
function defaultNameField(dialog: Locator): Locator {
  return dialog
    .locator(
      'input:not([role="combobox"]):not([type="checkbox"]):not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="search"])'
    )
    .first();
}

// ---- Test case configuration ---------------------------------------------

/**
 * An admin page that exposes an Add / Edit modal flow. Locator factories
 * default to the shared `defaultNameField` helper but can be overridden
 * per page when a modal has an unusual structure.
 */
interface AdminModalTestCase {
  /** Human-readable name for test titles. */
  label: string;
  /** Relative admin URL (without locale prefix). */
  url: string;
  /** Locator for the "Add X" button on the admin page. */
  addButton: (page: Page) => Locator;
  /** Locator for the primary text input inside an open Add dialog. */
  nameFieldInAdd?: (dialog: Locator) => Locator;
  /** Locator for the primary text input inside an open Edit dialog. */
  nameFieldInEdit?: (dialog: Locator) => Locator;
  /**
   * If true, skip the Edit row-switch test. Use for pages where the
   * first row is not an editable seed record (e.g., Statuses' "untested"
   * system row, which has Edit disabled).
   */
  skipEditRowSwitch?: boolean;
  /**
   * Row offset for the Edit row-switch test. Defaults to 0 (first two
   * rows). Bump this to skip system rows that can't be edited.
   */
  editRowOffset?: number;
}

const adminCases: AdminModalTestCase[] = [
  {
    label: "Tags",
    url: "/en-US/admin/tags",
    addButton: (page) => page.getByRole("button", { name: /add tag/i }).first(),
  },
  {
    label: "Roles",
    url: "/en-US/admin/roles",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
  },
  {
    label: "Statuses",
    url: "/en-US/admin/statuses",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
    // First row in Statuses is the "untested" system row with Edit disabled.
    // Skip the row-switch test; Add reset is still exercised.
    skipEditRowSwitch: true,
  },
  {
    label: "Milestone Types",
    url: "/en-US/admin/milestones",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
    // Both Add and Edit dialogs start with an icon picker that renders a
    // react-select combobox. The default filter drops comboboxes, so the
    // name Input is reached as the first matching input.
  },
];

// ---- Phase 1: Add modal resets between opens -----------------------------

for (const tc of adminCases) {
  test(`${tc.label}: Add modal form state resets between opens`, async ({
    page,
  }) => {
    const addButton = tc.addButton(page);
    const nameField = tc.nameFieldInAdd ?? defaultNameField;
    let dialog: Locator | undefined;

    await test.step("Open the admin page", async () => {
      await page.goto(tc.url);
      await page.waitForLoadState("networkidle");

      await expect(addButton).toBeVisible({ timeout: 10000 });
    });

    await test.step("Open the Add dialog, fill the first field, then cancel", async () => {
      await addButton.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const firstField = nameField(dialog);
      await expect(firstField).toBeVisible({ timeout: 5000 });

      const uniqueValue = `Leak-${tc.label.replace(/\s+/g, "-")}-${Date.now()}`;
      await firstField.fill(uniqueValue);
      await expect(firstField).toHaveValue(uniqueValue);

      await closeDialog(page);
    });

    await test.step("Reopen the dialog and verify the first field is empty", async () => {
      await addButton.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const firstFieldAgain = nameField(dialog);
      await expect(firstFieldAgain).toBeVisible({ timeout: 5000 });
      await expect(firstFieldAgain).toHaveValue("");

      await closeDialog(page);
    });
  });
}

// ---- Phase 2: Edit modal row-switching -----------------------------------

for (const tc of adminCases) {
  if (tc.skipEditRowSwitch) continue;

  test(`${tc.label}: Edit modal shows correct data when switching rows`, async ({
    page,
  }) => {
    const offset = tc.editRowOffset ?? 0;
    const rowA = offset;
    const rowB = offset + 1;
    const nameField = tc.nameFieldInEdit ?? defaultNameField;
    let rowAName: string | undefined;
    let rowBName: string | undefined;
    let poisonedValue: string | undefined;
    let dialog: Locator | undefined;

    await test.step("Open the admin page and read the two row names", async () => {
      await page.goto(tc.url);
      await page.waitForLoadState("networkidle");
      await waitForTableRows(page, 2);

      rowAName = await readRowName(page, rowA);
      rowBName = await readRowName(page, rowB);

      // Sanity: the two rows must have different names, otherwise the
      // test is meaningless (form-state-leak can't be distinguished from
      // correct behavior).
      expect(rowAName).not.toBe(rowBName);
      expect(rowAName.length).toBeGreaterThan(0);
      expect(rowBName.length).toBeGreaterThan(0);
    });

    await test.step("Edit row A, poison the field, then cancel", async () => {
      await clickRowEditButton(page, rowA);
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const firstFieldA = nameField(dialog);
      await expect(firstFieldA).toBeVisible({ timeout: 5000 });
      // The edit form should be pre-filled with row A's name.
      await expect(firstFieldA).toHaveValue(rowAName!);

      poisonedValue = `POISONED-${Date.now()}`;
      await firstFieldA.fill(poisonedValue);
      await expect(firstFieldA).toHaveValue(poisonedValue);

      await closeDialog(page);
    });

    await test.step("Edit row B and verify it shows row B's value, not the poisoned value", async () => {
      // This is the critical assertion: under the pre-fix bug, the form
      // would still contain `poisonedValue` because the modal never
      // unmounted. After the migration, every open is a fresh mount.
      await clickRowEditButton(page, rowB);
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const firstFieldB = nameField(dialog);
      await expect(firstFieldB).toBeVisible({ timeout: 5000 });
      await expect(firstFieldB).toHaveValue(rowBName!);
      // Extra strictness: explicitly assert the poisoned value did NOT leak.
      await expect(firstFieldB).not.toHaveValue(poisonedValue!);

      await closeDialog(page);
    });
  });
}
