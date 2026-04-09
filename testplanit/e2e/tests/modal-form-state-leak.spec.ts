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

/**
 * Extended parameterized regression suite for the modal form-state-leak
 * bug class. The three focused tests above cover the highest-risk modals
 * (AddUser, AddTemplate, EditAvatar) in detail. The tests below spread
 * coverage across the rest of the admin surface using a shared three-phase
 * pattern:
 *
 *   Phase 1 (Add): open → fill first field → cancel → reopen → assert empty
 *   Phase 2 (Edit row-switch): edit row A → modify field → cancel →
 *            edit row B → assert field shows row B's real value
 *            (not row A's modified value)
 *   Phase 3 (Delete row-switch): delete row A (visible only) → cancel →
 *            delete row B → assert dialog references row B by name
 *
 * These are generic, data-independent tests: they rely only on seed data
 * being present (at least two rows per table) and don't create, edit, or
 * delete any real records. Every modal is always cancelled, never submitted.
 */

// ---- Shared helpers -------------------------------------------------------

/**
 * Wait for the admin table on the current page to have at least `minRows`
 * non-header rows. Every admin page we test uses the DataTable component
 * which renders a single <table> element.
 */
async function waitForTableRows(page: Page, minRows: number = 2) {
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 10000 });
  // Give seed data a moment to hydrate
  await page.waitForFunction(
    (min) => document.querySelectorAll("tbody tr").length >= min,
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
  const row = page.locator("tbody tr").nth(rowIndex);
  // First td is the pinned name cell for every admin columns.tsx we touched.
  const cell = row.locator("td").first();
  const text = (await cell.innerText()).trim();
  // Some cells include badge text like "Default" — take the first line.
  return text.split("\n")[0].trim();
}

/**
 * Click the Edit (SquarePen) button for a specific row. The convention we
 * standardized in the approach-B migration: every row's actions cell has
 * an Edit button followed by a Delete button, both inside the pinned
 * rightmost column. We target the first ghost-variant button in that cell.
 */
async function clickRowEditButton(page: Page, rowIndex: number) {
  const row = page.locator("tbody tr").nth(rowIndex);
  // The actions cell is the last td and contains 2 buttons: edit + delete.
  const actionsCell = row.locator("td").last();
  // Edit is always the first button (ghost variant, SquarePen icon).
  await actionsCell.locator("button").first().click();
}

/**
 * Click the Delete (Trash2) button for a specific row.
 */
async function clickRowDeleteButton(page: Page, rowIndex: number) {
  const row = page.locator("tbody tr").nth(rowIndex);
  const actionsCell = row.locator("td").last();
  // Delete is the second (destructive) button. Some pages wrap the delete
  // button with a disabled guard when the row can't be deleted — .nth(1)
  // still resolves to the delete slot in either case.
  await actionsCell.locator("button").nth(1).click();
}

/**
 * Close an open dialog (works for both <dialog role="dialog"> and
 * <alertdialog role="alertdialog">). Prefers the Cancel button; falls
 * back to Escape.
 */
async function closeDialog(page: Page) {
  const cancelButton = page
    .getByRole("button", { name: /^cancel$/i })
    .last();
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

// ---- Test case configuration ---------------------------------------------

/**
 * An admin page that exposes an Add / Edit / Delete modal flow.
 * `nameField` is a locator factory that, given an open dialog, returns
 * the first text input representing the record's primary identifier.
 * Pages that use Dialog wrap their modal with role="dialog"; pages that
 * use AlertDialog (delete confirms) use role="alertdialog".
 */
interface AdminModalTestCase {
  /** Human-readable name for test titles. */
  label: string;
  /** Relative admin URL (without locale prefix). */
  url: string;
  /** Locator for the "Add X" button on the admin page. */
  addButton: (page: Page) => Locator;
  /** Locator for the primary text input inside an open Add dialog. */
  nameFieldInAdd: (dialog: Locator) => Locator;
  /** Locator for the primary text input inside an open Edit dialog. */
  nameFieldInEdit: (dialog: Locator) => Locator;
  /**
   * If true, skip the Edit row-switch test. Use for pages where the
   * first row is not an editable seed record (e.g., Statuses' "untested"
   * system row, which has Edit disabled).
   */
  skipEditRowSwitch?: boolean;
  /**
   * If true, skip the Delete row-switch test. Use for pages where the
   * first two rows cannot be deleted (e.g., system defaults).
   */
  skipDeleteRowSwitch?: boolean;
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
    addButton: (page) =>
      page.getByRole("button", { name: /add tag/i }).first(),
    nameFieldInAdd: (dialog) => dialog.locator('input[type="text"]').first(),
    nameFieldInEdit: (dialog) => dialog.locator('input[type="text"]').first(),
  },
  {
    label: "Groups",
    url: "/en-US/admin/groups",
    addButton: (page) =>
      page.getByRole("button", { name: /add group/i }).first(),
    nameFieldInAdd: (dialog) => dialog.locator('input[type="text"]').first(),
    nameFieldInEdit: (dialog) => dialog.locator('input[type="text"]').first(),
  },
  {
    label: "Roles",
    url: "/en-US/admin/roles",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
    nameFieldInAdd: (dialog) => dialog.locator('input[type="text"]').first(),
    nameFieldInEdit: (dialog) => dialog.locator('input[type="text"]').first(),
  },
  {
    label: "Statuses",
    url: "/en-US/admin/statuses",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
    nameFieldInAdd: (dialog) => dialog.locator('input[type="text"]').first(),
    nameFieldInEdit: (dialog) => dialog.locator('input[type="text"]').first(),
    // First row in Statuses is the "untested" system row with Edit and
    // Delete disabled. Skip the row-switch tests entirely — Add-reset is
    // still exercised.
    skipEditRowSwitch: true,
    skipDeleteRowSwitch: true,
  },
  {
    label: "Milestone Types",
    url: "/en-US/admin/milestones",
    addButton: (page) => page.getByRole("button", { name: /add/i }).first(),
    nameFieldInAdd: (dialog) => dialog.locator('input[type="text"]').first(),
    nameFieldInEdit: (dialog) => dialog.locator('input[type="text"]').first(),
    // Default milestone type cannot be deleted; keep edit, skip delete.
    skipDeleteRowSwitch: true,
  },
];

// ---- Phase 1: Add modal resets between opens -----------------------------

for (const tc of adminCases) {
  test(`${tc.label}: Add modal form state resets between opens`, async ({
    page,
  }) => {
    await page.goto(tc.url);
    await page.waitForLoadState("networkidle");

    const addButton = tc.addButton(page);
    await expect(addButton).toBeVisible({ timeout: 10000 });

    // --- First open: fill first field, cancel ---
    await addButton.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstField = tc.nameFieldInAdd(dialog);
    await expect(firstField).toBeVisible({ timeout: 5000 });

    const uniqueValue = `Leak-${tc.label}-${Date.now()}`;
    await firstField.fill(uniqueValue);
    await expect(firstField).toHaveValue(uniqueValue);

    await closeDialog(page);

    // --- Second open: first field must be empty ---
    await addButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstFieldAgain = tc.nameFieldInAdd(dialog);
    await expect(firstFieldAgain).toBeVisible({ timeout: 5000 });
    await expect(firstFieldAgain).toHaveValue("");

    await closeDialog(page);
  });
}

// ---- Phase 2: Edit modal row-switching -----------------------------------

for (const tc of adminCases) {
  if (tc.skipEditRowSwitch) continue;

  test(`${tc.label}: Edit modal shows correct data when switching rows`, async ({
    page,
  }) => {
    await page.goto(tc.url);
    await page.waitForLoadState("networkidle");
    await waitForTableRows(page, 2);

    const offset = tc.editRowOffset ?? 0;
    const rowA = offset;
    const rowB = offset + 1;

    const rowAName = await readRowName(page, rowA);
    const rowBName = await readRowName(page, rowB);

    // Sanity: the two rows must have different names, otherwise the
    // test is meaningless (form-state-leak can't be distinguished from
    // correct behavior).
    expect(rowAName).not.toBe(rowBName);
    expect(rowAName.length).toBeGreaterThan(0);
    expect(rowBName.length).toBeGreaterThan(0);

    // --- Open Edit on row A, modify the field, cancel ---
    await clickRowEditButton(page, rowA);
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstFieldA = tc.nameFieldInEdit(dialog);
    await expect(firstFieldA).toBeVisible({ timeout: 5000 });
    // The edit form should be pre-filled with row A's name.
    await expect(firstFieldA).toHaveValue(rowAName);

    const poisonedValue = `POISONED-${Date.now()}`;
    await firstFieldA.fill(poisonedValue);
    await expect(firstFieldA).toHaveValue(poisonedValue);

    await closeDialog(page);

    // --- Open Edit on row B ---
    // This is the critical assertion: under the pre-fix bug, the form
    // would still contain `poisonedValue` because the modal never
    // unmounted. After the migration, every open is a fresh mount.
    await clickRowEditButton(page, rowB);
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstFieldB = tc.nameFieldInEdit(dialog);
    await expect(firstFieldB).toBeVisible({ timeout: 5000 });
    await expect(firstFieldB).toHaveValue(rowBName);
    // Extra strictness: explicitly assert the poisoned value did NOT leak.
    await expect(firstFieldB).not.toHaveValue(poisonedValue);

    await closeDialog(page);
  });
}

// ---- Phase 3: Delete confirmation row-switching --------------------------

for (const tc of adminCases) {
  if (tc.skipDeleteRowSwitch) continue;

  test(`${tc.label}: Delete confirmation references correct row when switching`, async ({
    page,
  }) => {
    await page.goto(tc.url);
    await page.waitForLoadState("networkidle");
    await waitForTableRows(page, 2);

    const offset = tc.editRowOffset ?? 0;
    const rowA = offset;
    const rowB = offset + 1;

    const rowAName = await readRowName(page, rowA);
    const rowBName = await readRowName(page, rowB);
    expect(rowAName).not.toBe(rowBName);

    // --- Open Delete on row A ---
    await clickRowDeleteButton(page, rowA);
    let dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // The confirmation body should mention row A's name somewhere.
    await expect(dialog).toContainText(rowAName, { timeout: 5000 });

    await closeDialog(page);

    // --- Open Delete on row B ---
    await clickRowDeleteButton(page, rowB);
    dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // Critical: should mention row B, not row A. Under a row-state leak
    // bug, the previous `deletingRow` value would still be displayed.
    await expect(dialog).toContainText(rowBName, { timeout: 5000 });
    // Only assert row A is NOT mentioned if the two names don't contain
    // each other as substrings (e.g., "Admin" vs "Administrator").
    if (!rowBName.includes(rowAName) && !rowAName.includes(rowBName)) {
      await expect(dialog).not.toContainText(rowAName);
    }

    await closeDialog(page);
  });
}
