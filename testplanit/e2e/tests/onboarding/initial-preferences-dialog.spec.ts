import type { BrowserContext } from "@playwright/test";

import { expect, stubLiveStreams, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * First-run preferences dialog.
 *
 * `InitialPreferencesDialog` opens over the dashboard for any user whose
 * UserPreferences row still has `hasCompletedInitialPreferencesSetup: false`,
 * and it is deliberately non-dismissable: Escape and outside-click are
 * swallowed, so Save and Keep-defaults are the only ways out.
 *
 * That makes the close path load-bearing. Both handlers mark the flag, refetch
 * the preferences, and then close — and the refetch is what stops the dialog
 * from rendering at all. If the component simply stops rendering while the
 * dialog is still open, Radix never runs its close sequence and the modal's
 * `pointer-events: none` stays on `document.body`: the app looks completely
 * normal and ignores every click until the user reloads.
 *
 * These tests exercise the two exits and then assert the app is actually
 * usable afterwards, which is the part a visibility assertion cannot see.
 */

const USER_PASSWORD = "S3cure!password";

test.describe("Initial preferences dialog", () => {
  const createdUserIds: string[] = [];
  const openedContexts: BrowserContext[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (openedContexts.length) {
      await openedContexts
        .pop()
        ?.close()
        .catch(() => {});
    }
    while (createdUserIds.length) {
      const id = createdUserIds.pop();
      if (id) {
        await request
          .patch(`${url}/api/model/user/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {});
      }
    }
  });

  /**
   * A freshly signed-up user, signed in, sitting on the dashboard with the
   * first-run dialog open. Signup seeds the preferences row with the setup
   * flag off, so nothing extra is needed to trigger it.
   */
  async function signInFreshUser(
    browser: Parameters<typeof signInSecondaryContext>[0],
    url: string,
    api: any,
    label: string
  ) {
    const email = `initial-prefs-${label}@example.com`;
    const user = await api.createUser({
      name: `Initial Prefs ${label}`,
      email,
      password: USER_PASSWORD,
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(user.data.id);

    const ctx = await signInSecondaryContext(
      browser,
      url,
      email,
      USER_PASSWORD
    );
    openedContexts.push(ctx);

    const page = await ctx.newPage();
    await stubLiveStreams(page);
    await page.goto(`${url}/en-US`);
    await page.waitForLoadState("networkidle");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("initial-preferences-form")).toBeVisible();

    return { page, dialog };
  }

  /**
   * The assertion that matters: not "did the dialog disappear" but "can the
   * user do anything". A leaked modal leaves `pointer-events: none` on the
   * body, so every element still renders and reports visible while absorbing
   * clicks.
   */
  async function expectPageInteractive(
    page: Awaited<ReturnType<typeof signInFreshUser>>["page"]
  ) {
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });

    const bodyPointerEvents = await page.evaluate(
      () => getComputedStyle(document.body).pointerEvents
    );
    expect(bodyPointerEvents).not.toBe("none");

    // Drive a real interaction end-to-end rather than trusting the computed
    // style alone — anything that silently swallows the click fails here.
    await page.getByTestId("user-menu-trigger").click({ timeout: 10000 });
    await expect(page.getByTestId("user-menu-content")).toBeVisible({
      timeout: 10000,
    });
  }

  test("Keep defaults closes the dialog and leaves the app usable", async ({
    browser,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { page } = await signInFreshUser(
      browser,
      url,
      api,
      `skip-${Date.now()}`
    );

    await page.getByRole("button", { name: "Keep defaults" }).click();

    await expectPageInteractive(page);

    // The exit has to persist. If the flag doesn't stick, the dialog returns
    // on the next load and the user is asked to set preferences forever.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("initial-preferences-form")).toHaveCount(0, {
      timeout: 15000,
    });

    await page.close();
  });

  test("Save preferences closes the dialog and leaves the app usable", async ({
    browser,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { page } = await signInFreshUser(
      browser,
      url,
      api,
      `save-${Date.now()}`
    );

    // Save with the pre-filled defaults. Changing the locale takes a different
    // exit (a full reload, which would mask a leaked modal), so this leaves
    // every field alone to exercise the in-place close.
    await page.getByRole("button", { name: "Save preferences" }).click();

    await expectPageInteractive(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("initial-preferences-form")).toHaveCount(0, {
      timeout: 15000,
    });

    await page.close();
  });

  test("Save after using the dropdowns leaves the app usable", async ({
    browser,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { page, dialog } = await signInFreshUser(
      browser,
      url,
      api,
      `selects-${Date.now()}`
    );

    // What a real first-run user does, and what saving the pre-filled defaults
    // never exercises: open the selects. Each one is a second dismissable
    // layer stacked on the dialog's, and both take part in the body
    // pointer-events lock. Locale is left alone on purpose — changing it exits
    // through a full page reload, which would paper over a leaked lock.
    // Field order in the form: theme, locale, itemsPerPage, notificationMode,
    // dateFormat, timeFormat, timezone.
    const pickAnotherOption = async (fieldIndex: number) => {
      await dialog.getByRole("combobox").nth(fieldIndex).click();
      await page.getByRole("option").nth(1).click();
      // Radix animates the select closed; let it settle before the next one.
      await expect(page.getByRole("option")).toHaveCount(0, { timeout: 10000 });
    };

    await pickAnotherOption(0); // theme
    await pickAnotherOption(2); // itemsPerPage

    await page.getByRole("button", { name: "Save preferences" }).click();

    await expectPageInteractive(page);
    await page.close();
  });

  test("a stray click on the page behind does not dismiss it", async ({
    browser,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { page, dialog } = await signInFreshUser(
      browser,
      url,
      api,
      `outside-${Date.now()}`
    );

    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();

    await page.close();
  });

  test("the corner close button works", async ({ browser, baseURL, api }) => {
    const url = baseURL!;
    const { page, dialog } = await signInFreshUser(
      browser,
      url,
      api,
      `close-${Date.now()}`
    );

    // DialogContent always renders this X. It used to absorb clicks and do
    // nothing, which — with the footer buttons below the fold on a short
    // viewport — left the dialog looking frozen and a reload the only way out.
    await dialog.getByRole("button", { name: "Close" }).click();

    await expectPageInteractive(page);

    // Closing this way counts as keeping the defaults, so it doesn't come back.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("initial-preferences-form")).toHaveCount(0, {
      timeout: 15000,
    });

    await page.close();
  });

  test("Escape closes it, so a pointer-events lock can never trap the user", async ({
    browser,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { page } = await signInFreshUser(
      browser,
      url,
      api,
      `escape-${Date.now()}`
    );

    await page.keyboard.press("Escape");

    await expectPageInteractive(page);
    await page.close();
  });
});
